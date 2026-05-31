import { logger } from '../services/logger.ts';
import { serializeError } from '../shared/utils/serialize.ts';
import { initializeStorage } from '../shared/utils/storage.ts';
import type {
  ActiveDocumentRequestMessage,
  ActiveDocumentResponseMessage,
  ApplyIssueMessage,
  CancelProofreadMessage,
  DocumentInfo,
  ProofreadError,
  ProofosMessage,
  ProofreadRequestMessage,
  ProofreadResultMessage,
  RunFromContentMessage,
} from '../shared/messages/issues.ts';
import type { ProofreadIssue } from '../shared/types.ts';
import { runHealthCheck, runProofread } from './llm-proxy.ts';

interface TabState {
  document: DocumentInfo | null;
  issues: ProofreadIssue[];
  busy: boolean;
  lastError: ProofreadError | null;
  pendingRequestId: string | null;
  abortController: AbortController | null;
}

const tabStates = new Map<number, TabState>();

function getTabState(tabId: number): TabState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = {
      document: null,
      issues: [],
      busy: false,
      lastError: null,
      pendingRequestId: null,
      abortController: null,
    };
    tabStates.set(tabId, state);
  }
  return state;
}

const BADGE_COLOR = '#dc2626';
const BADGE_TEXT_COLOR = '#ffffff';
const BUSY_BADGE_COLOR = '#facc15';
const BUSY_TEXT_COLOR = '#000000';

async function updateBadge(tabId: number): Promise<void> {
  const state = tabStates.get(tabId);
  const count = state?.issues.length ?? 0;
  const text = count === 0 ? '' : count > 99 ? '99+' : String(count);
  try {
    if (state?.busy) {
      await chrome.action.setBadgeBackgroundColor({ color: BUSY_BADGE_COLOR, tabId });
      if ('setBadgeTextColor' in chrome.action) {
        await chrome.action.setBadgeTextColor({ color: BUSY_TEXT_COLOR, tabId });
      }
      await chrome.action.setBadgeText({ text: text || ' ', tabId });
      return;
    }
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
      if ('setBadgeTextColor' in chrome.action) {
        await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR, tabId });
      }
    }
    await chrome.action.setBadgeText({ text, tabId });
  } catch (error) {
    logger.warn({ error: serializeError(error), tabId }, 'Failed to update badge');
  }
}

function broadcast(message: ProofosMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open; that's fine.
  });
}

async function handleProofreadRequest(message: ProofreadRequestMessage): Promise<void> {
  const { tabId, requestId } = message.payload;
  const state = getTabState(tabId);

  // Cancel any prior in-flight run for this tab.
  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;
  state.pendingRequestId = requestId;
  state.busy = true;
  state.lastError = null;
  await updateBadge(tabId);
  broadcast({ type: 'proofos:busy-state', payload: { tabId, busy: true } });

  let document: DocumentInfo | null = state.document;
  let text = '';
  let readError: ProofreadError | null = null;

  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: 'proofos:get-document-text',
    })) as
      | { document: DocumentInfo; text: string; error?: undefined }
      | { error: { code: string; message: string }; document?: undefined; text?: undefined }
      | null
      | undefined;
    if (!response) {
      readError = {
        code: 'no-document',
        message:
          'ProofOS could not reach the document tab. Open or refresh a Google Doc and try again.',
      };
    } else if ('error' in response && response.error) {
      readError = {
        code: response.error.code === 'not-ready' ? 'no-document' : 'no-text',
        message: response.error.message,
      };
    } else if (response.document) {
      document = response.document;
      text = response.text;
      state.document = document;
    }
  } catch (error) {
    logger.info({ tabId, error: serializeError(error) }, 'Content script unreachable');
    readError = {
      code: 'no-document',
      message:
        'ProofOS content script is not loaded in this tab. Reload the extension and refresh the doc.',
    };
  }

  if (controller.signal.aborted) {
    finishProofread(tabId, requestId, document, [], {
      code: 'aborted',
      message: 'Proofread cancelled.',
    });
    return;
  }

  if (readError) {
    finishProofread(tabId, requestId, document, [], readError);
    return;
  }

  if (!document) {
    finishProofread(tabId, requestId, null, [], {
      code: 'no-document',
      message: 'No supported document found in this tab.',
    });
    return;
  }

  // Reset the per-tab issues snapshot at the start of every run so the badge
  // count and apply-by-id lookups stay in sync with what the side panel sees.
  state.issues = [];

  const result = await runProofread({
    text,
    documentTitle: document.title,
    signal: controller.signal,
    onProgress: (event) => {
      // Append the freshly-discovered issues to the per-tab cache so that an
      // `Apply` click during the run can still resolve the issue by id.
      if (event.newIssues.length > 0) {
        state.issues = [...state.issues, ...event.newIssues];
      }
      void updateBadge(tabId);
      broadcast({
        type: 'proofos:proofread-progress',
        payload: {
          requestId,
          tabId,
          newIssues: event.newIssues,
          completedTasks: event.completedTasks,
          totalTasks: event.totalTasks,
        },
      });
    },
  });
  state.issues = result.issues;
  state.lastError = result.error;
  finishProofread(tabId, requestId, document, result.issues, result.error);
}

function finishProofread(
  tabId: number,
  requestId: string,
  document: DocumentInfo | null,
  issues: ProofreadIssue[],
  error: ProofreadError | null
): void {
  const state = getTabState(tabId);
  if (state.pendingRequestId === requestId) {
    state.pendingRequestId = null;
    state.abortController = null;
  }
  state.busy = false;
  void updateBadge(tabId);
  broadcast({ type: 'proofos:busy-state', payload: { tabId, busy: false } });
  const message: ProofreadResultMessage = {
    type: 'proofos:proofread-result',
    payload: {
      requestId,
      tabId,
      document: document ?? { host: 'unknown', title: '', url: '', tabId },
      issues,
      error,
    },
  };
  broadcast(message);
}

function handleCancelProofread(message: CancelProofreadMessage): void {
  const { tabId, requestId } = message.payload;
  const state = tabStates.get(tabId);
  if (!state || state.pendingRequestId !== requestId) return;
  state.abortController?.abort();
}

async function handleApplyIssue(message: ApplyIssueMessage): Promise<void> {
  const { tabId, issueId, requestId } = message.payload;
  const state = getTabState(tabId);
  const issue = state.issues.find((i) => i.id === issueId);
  if (!issue) {
    broadcast({
      type: 'proofos:apply-result',
      payload: {
        requestId,
        tabId,
        issueIds: [issueId],
        appliedIssueIds: [],
        error: { code: 'unknown', message: 'Issue no longer exists. Re-run proofread.' },
      },
    });
    return;
  }

  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: 'proofos:apply-issues',
      payload: { issues: [issue] },
    })) as { appliedIssueIds: string[] } | undefined;
    const applied = response?.appliedIssueIds ?? [];
    broadcast({
      type: 'proofos:apply-result',
      payload: {
        requestId,
        tabId,
        issueIds: [issueId],
        appliedIssueIds: applied,
        error: null,
      },
    });
  } catch (cause) {
    logger.warn({ err: cause, tabId, issueId }, 'Apply request failed');
    broadcast({
      type: 'proofos:apply-result',
      payload: {
        requestId,
        tabId,
        issueIds: [issueId],
        appliedIssueIds: [],
        error: {
          code: 'unknown',
          message: 'Could not reach the document. Refresh the tab and try again.',
        },
      },
    });
  }
}

function handleActiveDocumentRequest(
  message: ActiveDocumentRequestMessage,
  sendResponse: (response: ActiveDocumentResponseMessage) => void
): void {
  const tabId = message.payload.tabId;
  const state = tabStates.get(tabId);
  sendResponse({
    type: 'proofos:active-document',
    payload: { tabId, document: state?.document ?? null },
  });
}

function handleContentReady(
  message: RunFromContentMessage,
  sender: chrome.runtime.MessageSender
): void {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') return;
  const state = getTabState(tabId);
  state.document = { ...message.payload.document, tabId };
  broadcast({
    type: 'proofos:active-document',
    payload: { tabId, document: state.document },
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await initializeStorage();
  logger.info({ reason: details?.reason }, 'ProofOS installed');
  try {
    chrome.contextMenus.create({
      id: 'proofos-check',
      title: 'Proofread with ProofOS',
      contexts: ['page', 'selection', 'editable'],
      documentUrlPatterns: ['https://docs.google.com/*'],
    });
  } catch (error) {
    logger.warn({ error: serializeError(error) }, 'Context menu creation failed');
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'proofos-check' || !tab?.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    logger.warn({ error: serializeError(error), tabId: tab.id }, 'Side panel open failed');
  }
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as ProofosMessage;
  switch (message.type) {
    case 'proofos:proofread-request':
      void handleProofreadRequest(message);
      return false;
    case 'proofos:cancel-proofread':
      handleCancelProofread(message);
      return false;
    case 'proofos:apply-issue':
      void handleApplyIssue(message);
      return false;
    case 'proofos:get-active-document':
      handleActiveDocumentRequest(message, sendResponse);
      return true;
    case 'proofos:content-ready':
      handleContentReady(message, sender);
      return false;
    default: {
      const rawType = (rawMessage as { type?: string })?.type;
      if (rawType === 'proofos:test-connection') {
        runHealthCheck()
          .then((health) => sendResponse(health))
          .catch((error) =>
            sendResponse({
              ok: false,
              detail: error instanceof Error ? error.message : 'Unknown error',
            })
          );
        return true;
      }
      if (rawType === 'proofos:fetch-doc-text') {
        const docId = (rawMessage as { payload?: { docId?: string } })?.payload?.docId ?? '';
        fetchDocText(docId)
          .then((result) => sendResponse(result))
          .catch((error) => {
            logger.warn({ err: error, docId }, 'fetch-doc-text crashed');
            sendResponse({
              error: {
                code: 'read-failed',
                message: error instanceof Error ? error.message : 'Unknown fetch error.',
              },
            });
          });
        return true;
      }
      return false;
    }
  }
});

async function fetchDocText(
  docId: string
): Promise<{ text: string; error?: undefined } | { error: { code: string; message: string } }> {
  if (!docId) {
    return { error: { code: 'not-ready', message: 'Missing document ID.' } };
  }
  const url = `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`;
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch (cause) {
    logger.warn({ err: cause, url }, 'SW export fetch rejected');
    return { error: { code: 'read-failed', message: 'Could not reach docs.google.com.' } };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      error: {
        code: 'read-failed',
        message:
          'Google Docs refused the request — make sure you are signed in and have access to this document.',
      },
    };
  }
  if (!response.ok) {
    return {
      error: {
        code: 'read-failed',
        message: `Google Docs export returned HTTP ${response.status}.`,
      },
    };
  }

  const raw = await response.text();
  const cleaned = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();
  if (!cleaned) {
    return {
      error: { code: 'read-failed', message: 'Google Docs returned an empty document.' },
    };
  }
  return { text: cleaned };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const state = tabStates.get(tabId);
  state?.abortController?.abort();
  tabStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    const state = tabStates.get(tabId);
    state?.abortController?.abort();
    tabStates.delete(tabId);
    void updateBadge(tabId);
  }
});

if ('setPanelBehavior' in chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
