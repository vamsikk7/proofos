import { logger } from '../../services/logger.ts';
import type { ProofreadIssue } from '../../shared/types.ts';
import { AdapterError, type DocumentAdapter, waitFor } from './adapter.ts';

// Matches the canonical /document/d/{id} as well as multi-account /document/u/N/d/{id}.
const DOC_ID_PATTERN = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/;
const KIX_EDITOR_SELECTOR = '.kix-appview-editor';
const FIND_INPUT_SELECTOR = 'input.docs-findandreplacedialog-input';
const KIX_EVENT_TARGET_SELECTOR = '.docs-texteventtarget-iframe';

// Cap how much of the original snippet we feed into the Find dialog. Google Docs'
// search input rejects very long values and we only need enough context to locate
// the paragraph.
const FIND_QUERY_MAX = 80;

export class GoogleDocsAdapter implements DocumentAdapter {
  readonly host = 'google-docs' as const;

  matches(): boolean {
    return (
      window.location.host === 'docs.google.com' &&
      window.location.pathname.startsWith('/document/') &&
      this.getDocId() !== null
    );
  }

  async waitForReady(timeoutMs = 15_000): Promise<boolean> {
    const editor = await waitFor(() => document.querySelector(KIX_EDITOR_SELECTOR), timeoutMs);
    return Boolean(editor);
  }

  getDocumentTitle(): string {
    const titleInput = document.querySelector<HTMLInputElement>('input.docs-title-input');
    const fromInput = titleInput?.value?.trim();
    if (fromInput) return fromInput;
    return document.title.replace(/ - Google Docs$/, '').trim();
  }

  async getText(): Promise<string> {
    const docId = this.getDocId();
    if (!docId) {
      throw new AdapterError('not-ready', 'Could not determine the Google Doc ID from the URL.');
    }

    // The fetch runs in the service worker because Google Docs' own service worker
    // intercepts fetches that originate from page contexts (including content scripts)
    // and rejects requests it didn't initiate.
    let response: { text?: string; error?: { code: string; message: string } } | undefined;
    try {
      response = (await chrome.runtime.sendMessage({
        type: 'proofos:fetch-doc-text',
        payload: { docId },
      })) as typeof response;
    } catch (cause) {
      logger.warn({ err: cause, docId }, 'SW fetch-doc-text message failed');
      throw new AdapterError('read-failed', 'ProofOS service worker is unreachable.', { cause });
    }

    if (!response) {
      throw new AdapterError('read-failed', 'No response from the ProofOS service worker.');
    }
    if (response.error) {
      throw new AdapterError(
        response.error.code === 'not-ready' ? 'not-ready' : 'read-failed',
        response.error.message
      );
    }
    return response.text ?? '';
  }

  async applyIssue(issue: ProofreadIssue): Promise<boolean> {
    // Read-only mode: copy the suggestion to the clipboard. Synthetic keyboard events
    // don't survive Google Docs' Kix editor (isTrusted: false), so we can't directly
    // edit the doc. Best-effort: open the Find dialog and pre-fill the snippet so
    // the user lands on the right paragraph and can paste over the highlight.
    try {
      await navigator.clipboard.writeText(issue.suggestion);
    } catch (cause) {
      logger.warn({ err: cause, issueId: issue.id }, 'Clipboard write failed');
      throw new AdapterError('apply-failed', 'Could not copy the suggestion to the clipboard.', {
        cause,
      });
    }

    void this.locateInDoc(issue.original).catch((error) => {
      // Locate is purely best-effort; failures don't invalidate the clipboard write.
      logger.info({ err: error, issueId: issue.id }, 'Locate-in-doc skipped');
    });

    return true;
  }

  /**
   * Opens Google Docs' Find dialog (Ctrl/Cmd+F), pre-fills it with `snippet`,
   * and dispatches Enter to jump to the first match. Synthetic events aren't
   * guaranteed to open the dialog (Kix sometimes rejects them), but when they
   * do the snippet lookup works because the Find dialog input is plain DOM.
   */
  private async locateInDoc(snippet: string): Promise<void> {
    const query = snippet.trim().slice(0, FIND_QUERY_MAX);
    if (!query) return;

    const useMeta = /Mac/.test(navigator.platform);
    const eventTarget = this.getEventTarget();
    if (!eventTarget) return;

    dispatchKey(eventTarget, 'f', { ctrl: !useMeta, meta: useMeta });

    const input = await waitFor<HTMLInputElement>(
      () => document.querySelector<HTMLInputElement>(FIND_INPUT_SELECTOR),
      1500
    );
    if (!input) {
      // Find dialog never opened — synthetic Ctrl+F was rejected.
      return;
    }

    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(120);
    dispatchKey(input, 'Enter');
  }

  private getEventTarget(): HTMLElement | null {
    const iframe = document.querySelector<HTMLIFrameElement>(KIX_EVENT_TARGET_SELECTOR);
    const body = iframe?.contentDocument?.body ?? null;
    return body ?? document.body;
  }

  private getDocId(): string | null {
    const match = window.location.pathname.match(DOC_ID_PATTERN);
    return match ? match[1] : null;
  }
}

function dispatchKey(
  el: HTMLElement | Document | Window,
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean } = {}
): void {
  const init: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keypress', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
