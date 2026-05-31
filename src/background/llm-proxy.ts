import { logger } from '../services/logger.ts';
import { getLocalChecker } from '../services/checks/registry.ts';
import {
  checkParagraphWithLanguageTool,
  healthCheckLanguageTool,
  type LanguageToolHealth,
} from '../services/languagetool/client.ts';
import { splitIntoParagraphs, type DocParagraph } from '../services/llm/paragraphs.ts';
import {
  createProvider,
  LlmRequestError,
  type LlmHealth,
} from '../services/llm/provider.ts';
import { getEnabledRules } from '../shared/rules/store.ts';
import { STORAGE_KEYS } from '../shared/constants.ts';
import { getStorageValue } from '../shared/utils/storage.ts';
import type { ProofreadError } from '../shared/messages/issues.ts';
import type { ProofreadIssue } from '../shared/types.ts';

export interface ProxyProgressEvent {
  newIssues: ProofreadIssue[];
  completedTasks: number;
  totalTasks: number;
}

export interface ProxyProofreadInput {
  text: string;
  documentTitle?: string;
  signal?: AbortSignal;
  onProgress?: (event: ProxyProgressEvent) => void;
}

export interface ProxyProofreadOutput {
  issues: ProofreadIssue[];
  error: ProofreadError | null;
}

export interface CombinedHealth {
  llm: LlmHealth;
  languageTool: LanguageToolHealth;
}

const LLM_CONCURRENCY_OLLAMA = 4;
const LLM_CONCURRENCY_OPENAI = 6;
const LT_CONCURRENCY = 2;

export async function runProofread(input: ProxyProofreadInput): Promise<ProxyProofreadOutput> {
  if (input.signal?.aborted) {
    return { issues: [], error: { code: 'aborted', message: 'Proofread cancelled.' } };
  }
  if (!input.text.trim()) {
    return { issues: [], error: { code: 'no-text', message: 'Document is empty.' } };
  }

  const [settings, rules] = await Promise.all([
    getStorageValue(STORAGE_KEYS.LLM_SETTINGS),
    getEnabledRules(),
  ]);

  if (rules.length === 0) {
    return {
      issues: [],
      error: {
        code: 'unknown',
        message: 'No rules are enabled. Enable at least one rule in the Rules tab.',
      },
    };
  }

  const paragraphs = splitIntoParagraphs(input.text);
  if (paragraphs.length === 0) {
    return { issues: [], error: { code: 'no-text', message: 'Document is empty.' } };
  }

  const localRules = rules.filter((r) => r.runner === 'local');
  let ltRules = rules.filter((r) => r.runner === 'languagetool');
  let llmRules = rules.filter((r) => r.runner === 'llm');

  // LT URL is empty → demote LT rules to LLM so the user still gets coverage.
  if (ltRules.length > 0 && !settings.languageToolUrl) {
    logger.info(
      { ltRuleCount: ltRules.length },
      'LanguageTool URL not configured; LT-tagged rules fall back to LLM'
    );
    llmRules = [...llmRules, ...ltRules];
    ltRules = [];
  }

  // Task count for the progress UI:
  //   - local: one task per (paragraph × local rule), runs synchronously
  //   - LT:    one task per paragraph (single LT call covers every enabled LT rule)
  //   - LLM:   one task per paragraph (single call covers every enabled LLM rule;
  //            bundling lets the model consolidate and avoids per-rule duplicates)
  const localTasks = paragraphs.length * localRules.length;
  const ltTasks = ltRules.length > 0 ? paragraphs.length : 0;
  const llmTasks = llmRules.length > 0 ? paragraphs.length : 0;
  const totalTasks = localTasks + ltTasks + llmTasks;

  logger.info(
    {
      paragraphs: paragraphs.length,
      localRules: localRules.length,
      ltRules: ltRules.length,
      llmRules: llmRules.length,
      totalTasks,
    },
    'Starting progressive proofread'
  );

  const seen = new Set<string>();
  const collected: ProofreadIssue[] = [];
  let completed = 0;
  let terminalError: ProofreadError | null = null;

  // Initial event so the UI shows (0/N) immediately.
  input.onProgress?.({ newIssues: [], completedTasks: 0, totalTasks });

  function annotate(issues: ProofreadIssue[], paragraph: DocParagraph): ProofreadIssue[] {
    return issues.map((issue) => ({ ...issue, context: paragraph.text }));
  }

  function recordAndEmit(issues: ProofreadIssue[]): void {
    const fresh: ProofreadIssue[] = [];
    for (const issue of issues) {
      // Dedup by span + suggested fix, NOT by ruleId. This collapses the case
      // where two engines (or two LT rules) flag the same span with the same
      // suggestion under different rule labels — the user only wants to see
      // one card per "this text should become that text" finding.
      const key = `${issue.startIndex}|${issue.endIndex}|${issue.suggestion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(issue);
      collected.push(issue);
    }
    completed += 1;
    input.onProgress?.({ newIssues: fresh, completedTasks: completed, totalTasks });
  }

  // 1) Local checkers — sub-millisecond per call, run synchronously paragraph-first.
  for (const paragraph of paragraphs) {
    if (input.signal?.aborted) {
      terminalError = { code: 'aborted', message: 'Proofread cancelled.' };
      break;
    }
    for (const rule of localRules) {
      if (input.signal?.aborted) break;
      try {
        const checker = getLocalChecker(rule.id);
        if (!checker) {
          // Unknown local rule (e.g. category not yet implemented) — count as done.
          recordAndEmit([]);
          continue;
        }
        const issues = await checker(paragraph, rule);
        recordAndEmit(annotate(issues, paragraph));
      } catch (cause) {
        logger.warn(
          { err: cause, rule: rule.id, paragraphId: paragraph.id },
          'Local checker failed; continuing'
        );
        recordAndEmit([]);
      }
    }
  }

  // 2) LanguageTool — one HTTP call per paragraph, run with light concurrency.
  if (!terminalError && ltTasks > 0) {
    await runWithConcurrency(
      paragraphs,
      LT_CONCURRENCY,
      async (paragraph) => {
        if (input.signal?.aborted || terminalError) return;
        try {
          const issues = await checkParagraphWithLanguageTool(
            paragraph,
            ltRules,
            settings.languageToolUrl,
            input.signal
          );
          recordAndEmit(annotate(issues, paragraph));
        } catch (cause) {
          if (input.signal?.aborted) return;
          logger.warn(
            { err: cause, paragraphId: paragraph.id },
            'LanguageTool call failed; continuing without LT issues for this paragraph'
          );
          recordAndEmit([]);
        }
      },
      () => input.signal?.aborted === true || terminalError !== null
    );
    if (input.signal?.aborted && !terminalError) {
      terminalError = { code: 'aborted', message: 'Proofread cancelled.' };
    }
  }

  // 3) LLM — one call per paragraph with ALL enabled LLM rules bundled in the
  // prompt. Bundling lets the model consolidate findings (one span → one rule)
  // and slashes total call count vs the per-rule variant.
  if (!terminalError && llmTasks > 0) {
    const provider = createProvider(settings);
    const concurrency =
      settings.provider === 'openai' ? LLM_CONCURRENCY_OPENAI : LLM_CONCURRENCY_OLLAMA;

    interface LlmTask {
      paragraph: DocParagraph;
      previous: DocParagraph | null;
      next: DocParagraph | null;
    }

    const tasks: LlmTask[] = paragraphs.map((paragraph, i) => ({
      paragraph,
      previous: i > 0 ? paragraphs[i - 1] : null,
      next: i + 1 < paragraphs.length ? paragraphs[i + 1] : null,
    }));

    await runWithConcurrency(
      tasks,
      concurrency,
      async (task) => {
        if (input.signal?.aborted || terminalError) return;
        try {
          const result = await provider.proofread({
            text: task.paragraph.text,
            rules: llmRules,
            documentTitle: input.documentTitle,
            signal: input.signal,
            offsetReferenceText: input.text,
            paragraphId: task.paragraph.id,
            searchStart: task.paragraph.offset,
            searchEnd: task.paragraph.offset + task.paragraph.text.length,
            previousParagraph: task.previous
              ? { id: task.previous.id, text: task.previous.text }
              : null,
            nextParagraph: task.next ? { id: task.next.id, text: task.next.text } : null,
          });
          recordAndEmit(annotate(result.issues, task.paragraph));
        } catch (cause) {
          if (input.signal?.aborted) return;
          const taskError = toProofreadError(cause);
          if (taskError.code === 'provider-auth') {
            terminalError = taskError;
            return;
          }
          logger.warn(
            { err: cause, paragraphId: task.paragraph.id },
            'LLM task failed; continuing'
          );
          recordAndEmit([]);
        }
      },
      () => input.signal?.aborted === true || terminalError !== null
    );
    if (input.signal?.aborted && !terminalError) {
      terminalError = { code: 'aborted', message: 'Proofread cancelled.' };
    }
  }

  return { issues: collected, error: terminalError };
}

export async function runHealthCheck(signal?: AbortSignal): Promise<CombinedHealth> {
  const settings = await getStorageValue(STORAGE_KEYS.LLM_SETTINGS);
  const provider = createProvider(settings);
  const [llmHealth, ltHealth] = await Promise.all([
    provider.healthCheck(signal),
    healthCheckLanguageTool(settings.languageToolUrl, signal),
  ]);
  return { llm: llmHealth, languageTool: ltHealth };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  async function runner(): Promise<void> {
    while (true) {
      if (shouldStop?.()) return;
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      await worker(items[idx]);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runner));
}

function toProofreadError(cause: unknown): ProofreadError {
  if (cause instanceof LlmRequestError) {
    switch (cause.code) {
      case 'unauthorized':
        return { code: 'provider-auth', message: cause.message };
      case 'not-found':
        return { code: 'provider-not-found', message: cause.message };
      case 'invalid-response':
        return { code: 'invalid-response', message: cause.message };
      case 'aborted':
        return { code: 'aborted', message: cause.message };
      case 'network':
        return { code: 'provider-unreachable', message: cause.message };
      default:
        return { code: 'unknown', message: cause.message };
    }
  }
  const message = cause instanceof Error ? cause.message : 'Unknown error';
  return { code: 'unknown', message };
}
