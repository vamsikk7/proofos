import { logger } from '../services/logger.ts';
import { serializeError } from '../shared/utils/serialize.ts';
import type { ProofreadIssue } from '../shared/types.ts';
import type { DocumentInfo } from '../shared/messages/issues.ts';
import { GoogleDocsAdapter } from './adapters/google-docs.ts';
import { AdapterError, type DocumentAdapter } from './adapters/adapter.ts';

interface GetTextRequest {
  type: 'proofos:get-document-text';
}

interface ApplyIssuesRequest {
  type: 'proofos:apply-issues';
  payload: { issues: ProofreadIssue[] };
}

export interface AdapterErrorPayload {
  code: string;
  message: string;
}

export type GetTextResponse =
  | { document: DocumentInfo; text: string; error?: undefined }
  | { error: AdapterErrorPayload; document?: undefined; text?: undefined };

interface ApplyIssuesResponse {
  appliedIssueIds: string[];
  failedIssueIds: string[];
}

type IncomingMessage = GetTextRequest | ApplyIssuesRequest;

export class DocController {
  private readonly adapter: DocumentAdapter | null;

  constructor() {
    const candidates: DocumentAdapter[] = [new GoogleDocsAdapter()];
    this.adapter = candidates.find((adapter) => adapter.matches()) ?? null;
  }

  isActive(): boolean {
    return this.adapter !== null;
  }

  async init(): Promise<void> {
    if (!this.adapter) return;
    const ready = await this.adapter.waitForReady();
    if (!ready) {
      logger.info('Document adapter did not become ready before timeout');
      return;
    }
    this.broadcastReady();
    chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
      return this.handleMessage(rawMessage as IncomingMessage, sendResponse);
    });
  }

  private broadcastReady(): void {
    if (!this.adapter) return;
    const document: DocumentInfo = {
      host: this.adapter.host,
      title: this.adapter.getDocumentTitle(),
      url: window.location.href,
      tabId: -1,
    };
    void chrome.runtime
      .sendMessage({ type: 'proofos:content-ready', payload: { document } })
      .catch(() => {});
  }

  private handleMessage(
    message: IncomingMessage,
    sendResponse: (response: unknown) => void
  ): boolean {
    if (!this.adapter) return false;
    if (message.type === 'proofos:get-document-text') {
      void this.handleGetText().then(sendResponse);
      return true;
    }
    if (message.type === 'proofos:apply-issues') {
      void this.handleApplyIssues(message.payload.issues)
        .then(sendResponse)
        .catch((error) => {
          logger.warn({ error: serializeError(error) }, 'applyIssues failed');
          sendResponse({
            appliedIssueIds: [],
            failedIssueIds: message.payload.issues.map((i) => i.id),
          });
        });
      return true;
    }
    return false;
  }

  private async handleGetText(): Promise<GetTextResponse> {
    if (!this.adapter) {
      return { error: { code: 'not-ready', message: 'ProofOS is not active on this page.' } };
    }
    try {
      const text = await this.adapter.getText();
      const document: DocumentInfo = {
        host: this.adapter.host,
        title: this.adapter.getDocumentTitle(),
        url: window.location.href,
        tabId: -1,
      };
      logger.info(
        { chars: text.length, title: document.title, url: document.url },
        'Document text read'
      );
      return { document, text };
    } catch (cause) {
      const code = cause instanceof AdapterError ? cause.code : 'read-failed';
      const message =
        cause instanceof Error ? cause.message : 'Unknown error reading the document.';
      logger.warn(
        { code, message, url: window.location.href, error: serializeError(cause) },
        'Document read failed'
      );
      return { error: { code, message } };
    }
  }

  private async handleApplyIssues(issues: ProofreadIssue[]): Promise<ApplyIssuesResponse> {
    if (!this.adapter) {
      return { appliedIssueIds: [], failedIssueIds: issues.map((i) => i.id) };
    }
    const ordered = [...issues].sort((a, b) => b.startIndex - a.startIndex);
    const applied: string[] = [];
    const failed: string[] = [];
    for (const issue of ordered) {
      try {
        const ok = await this.adapter.applyIssue(issue);
        if (ok) {
          applied.push(issue.id);
        } else {
          failed.push(issue.id);
        }
      } catch (error) {
        logger.info({ err: error, issueId: issue.id }, 'Apply issue failed; skipping');
        failed.push(issue.id);
      }
    }
    return { appliedIssueIds: applied, failedIssueIds: failed };
  }
}
