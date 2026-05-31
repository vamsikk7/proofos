import type { ProofreadIssue } from '../../shared/types.ts';
import type { DocumentInfo, ProofreadError } from '../../shared/messages/issues.ts';
import type { Rule } from '../../shared/rules/types.ts';
import { escapeHtml, truncate } from '../util/diff.ts';

export interface IssuesTabState {
  doc: DocumentInfo | null;
  issues: ProofreadIssue[];
  appliedIds: Set<string>;
  dismissedIds: Set<string>;
  busy: boolean;
  error: ProofreadError | null;
  hasRun: boolean;
  lastCopiedId: string | null;
  progress: { completed: number; total: number } | null;
  /** All rules the user has enabled — rendered as sections even when 0 findings. */
  enabledRules: Rule[];
}

export interface IssuesTabHandlers {
  onRunProofread: () => void;
  onCancelProofread: () => void;
  onApplyIssue: (issueId: string) => void;
  onDismissIssue: (issueId: string) => void;
}

export class IssuesTab {
  private state: IssuesTabState = {
    doc: null,
    issues: [],
    appliedIds: new Set(),
    dismissedIds: new Set(),
    busy: false,
    error: null,
    hasRun: false,
    lastCopiedId: null,
    progress: null,
    enabledRules: [],
  };

  // Tracks which rule groups the user has collapsed. Survives re-renders so the
  // panel doesn't snap groups back open every time a progress message arrives.
  private collapsedRuleIds = new Set<string>();

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: IssuesTabHandlers
  ) {
    this.root.addEventListener('click', this.onClick);
    // `toggle` doesn't bubble — use capture so a single listener at the root catches it.
    this.root.addEventListener('toggle', this.onToggle, true);
  }

  update(patch: Partial<IssuesTabState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'run') this.handlers.onRunProofread();
    if (action === 'cancel') this.handlers.onCancelProofread();
    if (action === 'apply') {
      const issueId = target.dataset.issueId;
      if (issueId) this.handlers.onApplyIssue(issueId);
    }
    if (action === 'dismiss') {
      const issueId = target.dataset.issueId;
      if (issueId) this.handlers.onDismissIssue(issueId);
    }
  };

  private onToggle = (event: Event): void => {
    const details = event.target as HTMLDetailsElement;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (!details.matches('details.rule-group')) return;
    const ruleId = details.dataset.ruleId;
    if (!ruleId) return;
    if (details.open) {
      this.collapsedRuleIds.delete(ruleId);
    } else {
      this.collapsedRuleIds.add(ruleId);
    }
  };

  private render(): void {
    const {
      busy,
      issues,
      error,
      hasRun,
      doc,
      appliedIds,
      dismissedIds,
      lastCopiedId,
      progress,
      enabledRules,
    } = this.state;
    const visible = issues.filter((issue) => !dismissedIds.has(issue.id));
    const outstanding = visible.filter((issue) => !appliedIds.has(issue.id)).length;
    const progressLabel =
      busy && progress && progress.total > 0 ? ` (${progress.completed}/${progress.total})` : '';

    // Bucket the issues by ruleId so each enabled rule section can pull its own slice.
    const issuesByRule = new Map<string, ProofreadIssue[]>();
    for (const issue of visible) {
      const list = issuesByRule.get(issue.ruleId);
      if (list) list.push(issue);
      else issuesByRule.set(issue.ruleId, [issue]);
    }

    // Build groups: one per enabled rule (in enabled-rule order), then append any
    // orphan groups for issues whose rule isn't in enabledRules (defensive — shouldn't
    // happen, but keeps issues visible if the rule list ever falls out of sync).
    const groups: RuleGroup[] =
      enabledRules.length > 0
        ? enabledRules.map((rule) => ({
            ruleId: rule.id,
            ruleName: rule.name,
            issues: issuesByRule.get(rule.id) ?? [],
          }))
        : groupByRule(visible);
    if (enabledRules.length > 0) {
      for (const [ruleId, ruleIssues] of issuesByRule) {
        if (!enabledRules.some((r) => r.id === ruleId)) {
          groups.push({
            ruleId,
            ruleName: ruleIssues[0]?.ruleName ?? ruleId,
            issues: ruleIssues,
          });
        }
      }
    }

    const toolbar = `
      <div class="toolbar">
        <button class="button button--primary" data-action="run" ${busy || !doc ? 'disabled' : ''}>
          ${busy ? `Proofreading…${progressLabel}` : 'Proofread document'}
        </button>
        ${
          busy
            ? `<button class="button" data-action="cancel">Cancel</button>`
            : `<span class="toolbar__hint">${outstanding} outstanding · ${appliedIds.size} copied</span>`
        }
      </div>
    `;

    let body = '';
    if (!doc) {
      body = `<div class="empty-state">Open a Google Doc to begin.</div>`;
    } else if (!hasRun && !busy) {
      body = `<div class="empty-state">Click <strong>Proofread document</strong> to scan ${escapeHtml(
        doc.title || 'this document'
      )}.</div>`;
    } else if (groups.length === 0) {
      // Defensive: hasRun but no enabled rules loaded yet — show a spinner-equivalent.
      body = `<div class="empty-state">Loading rules…</div>`;
    } else {
      const sections: string[] = [];
      if (error) {
        sections.push(`<div class="notice notice--warn">${escapeHtml(error.message)}</div>`);
      }
      sections.push(
        `<div class="notice notice--info"><strong>Copy fix</strong> puts the suggestion on your clipboard. Each card shows the surrounding paragraph with the issue <mark>highlighted</mark> — use it to locate the snippet visually, then paste over it in your doc. (Auto-scrolling to the paragraph via Docs' Find dialog is best-effort and frequently blocked by the Kix editor.)</div>`
      );
      sections.push(
        ...groups.map((group) =>
          renderRuleGroup(group, {
            collapsed: this.collapsedRuleIds.has(group.ruleId),
            busy,
            appliedIds,
            lastCopiedId,
          })
        )
      );
      body = sections.join('');
    }

    this.root.innerHTML = `${toolbar}${body}`;
  }
}

function renderRuleGroup(
  group: RuleGroup,
  ctx: {
    collapsed: boolean;
    busy: boolean;
    appliedIds: Set<string>;
    lastCopiedId: string | null;
  }
): string {
  const total = group.issues.length;
  const groupOutstanding = group.issues.filter((i) => !ctx.appliedIds.has(i.id)).length;
  const countLabel =
    total === 0
      ? ctx.busy
        ? 'Scanning…'
        : 'Clean'
      : `${groupOutstanding} of ${total}`;
  const body =
    total === 0
      ? `<div class="rule-group__empty">${
          ctx.busy
            ? 'No issues yet — still running.'
            : 'No issues for this rule.'
        }</div>`
      : group.issues
          .map((issue) =>
            renderIssue(issue, {
              applied: ctx.appliedIds.has(issue.id),
              justCopied: ctx.lastCopiedId === issue.id,
            })
          )
          .join('');
  return `
    <details class="rule-group" data-rule-id="${escapeHtml(group.ruleId)}"${ctx.collapsed ? '' : ' open'}>
      <summary class="rule-group__summary">
        <span class="rule-group__name">${escapeHtml(group.ruleName)}</span>
        <span class="rule-group__count${total === 0 ? ' rule-group__count--muted' : ''}">${countLabel}</span>
      </summary>
      <div class="rule-group__body">
        ${body}
      </div>
    </details>
  `;
}

function renderIssue(
  issue: ProofreadIssue,
  flags: { applied: boolean; justCopied: boolean }
): string {
  const classes = ['issue'];
  if (flags.applied) classes.push('issue--applied');
  return `
    <article class="${classes.join(' ')}">
      <div class="issue__head">
        <span class="issue__badge">${escapeHtml(issue.category)}</span>
        ${flags.applied ? `<span class="issue__status">${flags.justCopied ? 'Copied — paste in your doc' : 'Copied'}</span>` : ''}
      </div>
      <div class="issue__diff">
        <div class="issue__diff__line issue__diff__line--from">${escapeHtml(truncate(issue.original))}</div>
        <div class="issue__diff__line issue__diff__line--to">${escapeHtml(truncate(issue.suggestion))}</div>
      </div>
      ${renderContext(issue)}
      ${
        issue.explanation
          ? `<div class="issue__explanation">${escapeHtml(issue.explanation)}</div>`
          : ''
      }
      <div class="issue__actions">
        ${
          flags.applied
            ? `<button class="button" data-action="dismiss" data-issue-id="${escapeHtml(issue.id)}">Dismiss</button>
               <button class="button button--primary" data-action="apply" data-issue-id="${escapeHtml(issue.id)}">Copy again</button>`
            : `<button class="button button--primary" data-action="apply" data-issue-id="${escapeHtml(issue.id)}">Copy fix</button>`
        }
      </div>
    </article>
  `;
}

const CONTEXT_WINDOW = 220;

function renderContext(issue: ProofreadIssue): string {
  const ctx = issue.context;
  if (!ctx) return '';
  const orig = issue.original;
  const pos = orig ? ctx.indexOf(orig) : -1;

  if (pos === -1) {
    return `<div class="issue__context">${escapeHtml(truncate(ctx, CONTEXT_WINDOW))}</div>`;
  }

  const before = ctx.slice(0, pos);
  const after = ctx.slice(pos + orig.length);

  if (ctx.length <= CONTEXT_WINDOW + orig.length) {
    return `<div class="issue__context">${escapeHtml(before)}<mark>${escapeHtml(orig)}</mark>${escapeHtml(after)}</div>`;
  }

  const half = Math.floor(CONTEXT_WINDOW / 2);
  const beforeChars = Math.min(before.length, half);
  const afterChars = Math.min(after.length, CONTEXT_WINDOW - beforeChars);
  const truncatedBefore = before.slice(-beforeChars);
  const truncatedAfter = after.slice(0, afterChars);
  const beforeEllipsis = before.length > beforeChars ? '… ' : '';
  const afterEllipsis = after.length > afterChars ? ' …' : '';

  return `<div class="issue__context">${beforeEllipsis}${escapeHtml(truncatedBefore)}<mark>${escapeHtml(orig)}</mark>${escapeHtml(truncatedAfter)}${afterEllipsis}</div>`;
}

interface RuleGroup {
  ruleId: string;
  ruleName: string;
  issues: ProofreadIssue[];
}

function groupByRule(issues: ProofreadIssue[]): RuleGroup[] {
  const map = new Map<string, RuleGroup>();
  for (const issue of issues) {
    let group = map.get(issue.ruleId);
    if (!group) {
      group = { ruleId: issue.ruleId, ruleName: issue.ruleName, issues: [] };
      map.set(issue.ruleId, group);
    }
    group.issues.push(issue);
  }
  return Array.from(map.values());
}
