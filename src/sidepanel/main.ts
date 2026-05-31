import './style.css';

import { logger } from '../services/logger.ts';
import type {
  ApplyResultMessage,
  BusyStateUpdateMessage,
  DocumentInfo,
  ProofosMessage,
  ProofreadError,
  ProofreadProgressMessage,
  ProofreadResultMessage,
} from '../shared/messages/issues.ts';
import type { ProofreadIssue } from '../shared/types.ts';
import { IssuesTab } from './components/issues-tab.ts';
import { RulesTab } from './components/rules-tab.ts';
import { SettingsTab } from './components/settings-tab.ts';
import { loadRules } from '../shared/rules/store.ts';
import type { Rule } from '../shared/rules/types.ts';
import { escapeHtml } from './util/diff.ts';

type TabKey = 'issues' | 'rules' | 'settings';

interface SidePanelState {
  tabId: number | null;
  document: DocumentInfo | null;
  issues: ProofreadIssue[];
  appliedIds: Set<string>;
  dismissedIds: Set<string>;
  busy: boolean;
  error: ProofreadError | null;
  hasRun: boolean;
  lastCopiedId: string | null;
  pendingRequestId: string | null;
  progress: { completed: number; total: number } | null;
  enabledRules: Rule[];
}

const state: SidePanelState = {
  tabId: null,
  document: null,
  issues: [],
  appliedIds: new Set(),
  dismissedIds: new Set(),
  busy: false,
  error: null,
  hasRun: false,
  lastCopiedId: null,
  pendingRequestId: null,
  progress: null,
  enabledRules: [],
};

const root = document.getElementById('app');
if (!root) {
  throw new Error('App root not found');
}

root.innerHTML = `
  <header class="app-header">
    <h1>ProofOS</h1>
  </header>
  <div class="app-doc" id="docInfo">No document detected yet.</div>
  <div class="tab-bar" role="tablist">
    <button role="tab" data-tab="issues" aria-selected="true">Issues</button>
    <button role="tab" data-tab="rules" aria-selected="false">Rules</button>
    <button role="tab" data-tab="settings" aria-selected="false">Settings</button>
  </div>
  <div class="tab-panels">
    <section id="tab-issues" class="tab-panel active" role="tabpanel"></section>
    <section id="tab-rules" class="tab-panel" role="tabpanel"></section>
    <section id="tab-settings" class="tab-panel" role="tabpanel"></section>
  </div>
`;

const docInfoEl = root.querySelector('#docInfo') as HTMLElement;
const tabBar = root.querySelector('.tab-bar') as HTMLElement;

const issuesTab = new IssuesTab(root.querySelector('#tab-issues') as HTMLElement, {
  onRunProofread: () => requestProofread(),
  onCancelProofread: () => requestCancel(),
  onApplyIssue: (issueId) => requestApply(issueId),
  onDismissIssue: (issueId) => dismissIssue(issueId),
});
const rulesTab = new RulesTab(root.querySelector('#tab-rules') as HTMLElement);
const settingsTab = new SettingsTab(
  root.querySelector('#tab-settings') as HTMLElement,
  async () => {
    const response = (await chrome.runtime.sendMessage({ type: 'proofos:test-connection' })) as
      | { llm: { ok: boolean; detail: string }; languageTool: { ok: boolean; detail: string } }
      | undefined;
    if (response) return response;
    const fallback = { ok: false, detail: 'No response from service worker.' };
    return { llm: fallback, languageTool: fallback };
  }
);

tabBar.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const tab = target?.dataset.tab as TabKey | undefined;
  if (!tab) return;
  selectTab(tab);
});

function selectTab(tab: TabKey): void {
  tabBar.querySelectorAll<HTMLButtonElement>('button[role="tab"]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
  });
  root!.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });
}

function renderDocInfo(): void {
  if (!state.document) {
    docInfoEl.innerHTML = 'No document detected yet. Open a Google Doc to begin.';
    return;
  }
  const hostLabel = state.document.host === 'google-docs' ? 'Google Docs' : 'document';
  docInfoEl.innerHTML = `${escapeHtml(hostLabel)} · <strong>${escapeHtml(
    state.document.title || 'Untitled'
  )}</strong>`;
}

function pushIssuesUpdate(): void {
  issuesTab.update({
    doc: state.document,
    issues: state.issues,
    appliedIds: state.appliedIds,
    dismissedIds: state.dismissedIds,
    busy: state.busy,
    error: state.error,
    hasRun: state.hasRun,
    lastCopiedId: state.lastCopiedId,
    progress: state.progress,
    enabledRules: state.enabledRules,
  });
}

async function bootstrap(): Promise<void> {
  await Promise.all([rulesTab.refresh(), settingsTab.refresh()]);
  const tab = await getCurrentTab();
  if (tab?.id) {
    state.tabId = tab.id;
    const response = (await chrome.runtime
      .sendMessage({ type: 'proofos:get-active-document', payload: { tabId: tab.id } })
      .catch(() => null)) as { payload?: { document: DocumentInfo | null } } | null;
    state.document = response?.payload?.document ?? null;
  }
  renderDocInfo();
  pushIssuesUpdate();
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function newRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function requestProofread(): void {
  if (!state.tabId) {
    state.error = { code: 'no-document', message: 'No active tab.' };
    pushIssuesUpdate();
    return;
  }
  const requestId = newRequestId();
  state.pendingRequestId = requestId;
  state.error = null;
  state.busy = true;
  state.issues = [];
  state.appliedIds = new Set();
  state.dismissedIds = new Set();
  state.lastCopiedId = null;
  state.progress = { completed: 0, total: 0 };
  state.hasRun = true;
  pushIssuesUpdate();
  // Snapshot the enabled rule list so the panel can render a section per rule
  // (even empty ones) while the run is in flight.
  void loadRules().then((all) => {
    state.enabledRules = all.filter((rule) => rule.enabled);
    pushIssuesUpdate();
  });
  void chrome.runtime.sendMessage({
    type: 'proofos:proofread-request',
    payload: { requestId, tabId: state.tabId },
  });
}

function requestCancel(): void {
  if (!state.tabId || !state.pendingRequestId) return;
  // Optimistic UI: stop showing the busy state immediately so the user gets
  // instant feedback. The actual proofread-result message will arrive shortly
  // (after in-flight fetches abort + worker pools drain) and reconcile state.
  state.busy = false;
  state.progress = null;
  state.error = { code: 'aborted', message: 'Cancelling…' };
  pushIssuesUpdate();
  void chrome.runtime.sendMessage({
    type: 'proofos:cancel-proofread',
    payload: { requestId: state.pendingRequestId, tabId: state.tabId },
  });
}

function requestApply(issueId: string): void {
  if (!state.tabId) return;
  const issue = state.issues.find((i) => i.id === issueId);
  // Write to the clipboard SYNCHRONOUSLY inside the click handler so Chrome's
  // user-activation flag is still active. A content-script clipboard write
  // (after a message round-trip) silently fails because the gesture lives in
  // this panel, not in the doc tab.
  if (issue) {
    void navigator.clipboard.writeText(issue.suggestion).catch((err) => {
      logger.warn({ err, issueId }, 'Sidepanel clipboard write failed');
    });
  }
  void chrome.runtime.sendMessage({
    type: 'proofos:apply-issue',
    payload: { requestId: newRequestId(), tabId: state.tabId, issueId },
  });
}

function dismissIssue(issueId: string): void {
  state.dismissedIds = new Set(state.dismissedIds).add(issueId);
  if (state.lastCopiedId === issueId) {
    state.lastCopiedId = null;
  }
  pushIssuesUpdate();
}

chrome.runtime.onMessage.addListener((rawMessage) => {
  const message = rawMessage as ProofosMessage;
  if (message.type === 'proofos:proofread-result') {
    onProofreadResult(message);
  } else if (message.type === 'proofos:proofread-progress') {
    onProofreadProgress(message);
  } else if (message.type === 'proofos:apply-result') {
    onApplyResult(message);
  } else if (message.type === 'proofos:busy-state') {
    onBusyState(message);
  } else if (message.type === 'proofos:active-document') {
    if (message.payload.tabId === state.tabId) {
      state.document = message.payload.document;
      renderDocInfo();
      pushIssuesUpdate();
    }
  }
});

function onProofreadResult(message: ProofreadResultMessage): void {
  if (message.payload.tabId !== state.tabId) return;
  state.busy = false;
  state.hasRun = true;
  state.error = message.payload.error;
  // Replace with the canonical final list (the proxy deduped across all tasks).
  // Preserve appliedIds/dismissedIds so a user who acted mid-run keeps their state.
  state.issues = message.payload.issues;
  const surviving = new Set(state.issues.map((issue) => issue.id));
  state.appliedIds = new Set([...state.appliedIds].filter((id) => surviving.has(id)));
  state.dismissedIds = new Set([...state.dismissedIds].filter((id) => surviving.has(id)));
  if (state.lastCopiedId && !surviving.has(state.lastCopiedId)) {
    state.lastCopiedId = null;
  }
  state.pendingRequestId = null;
  state.progress = null;
  state.document = message.payload.document ?? state.document;
  renderDocInfo();
  pushIssuesUpdate();
}

function onProofreadProgress(message: ProofreadProgressMessage): void {
  if (message.payload.tabId !== state.tabId) return;
  if (message.payload.newIssues.length > 0) {
    const seen = new Set(state.issues.map((issue) => issue.id));
    const fresh = message.payload.newIssues.filter((issue) => !seen.has(issue.id));
    state.issues = [...state.issues, ...fresh];
  }
  state.progress = {
    completed: message.payload.completedTasks,
    total: message.payload.totalTasks,
  };
  pushIssuesUpdate();
}

function onApplyResult(message: ApplyResultMessage): void {
  if (message.payload.tabId !== state.tabId) return;
  if (message.payload.appliedIssueIds.length > 0) {
    const next = new Set(state.appliedIds);
    message.payload.appliedIssueIds.forEach((id) => next.add(id));
    state.appliedIds = next;
    state.lastCopiedId = message.payload.appliedIssueIds[message.payload.appliedIssueIds.length - 1];
  }
  if (message.payload.error) {
    state.error = message.payload.error;
  }
  pushIssuesUpdate();
}

function onBusyState(message: BusyStateUpdateMessage): void {
  if (message.payload.tabId !== state.tabId) return;
  state.busy = message.payload.busy;
  pushIssuesUpdate();
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  state.tabId = activeInfo.tabId;
  state.document = null;
  state.issues = [];
  state.appliedIds = new Set();
  state.dismissedIds = new Set();
  state.hasRun = false;
  state.error = null;
  state.lastCopiedId = null;
  state.pendingRequestId = null;
  state.progress = null;
  state.enabledRules = [];
  const response = (await chrome.runtime
    .sendMessage({ type: 'proofos:get-active-document', payload: { tabId: activeInfo.tabId } })
    .catch(() => null)) as { payload?: { document: DocumentInfo | null } } | null;
  state.document = response?.payload?.document ?? null;
  renderDocInfo();
  pushIssuesUpdate();
});

logger.info('ProofOS side panel loaded');
void bootstrap();
