import { logger } from '../logger.ts';
import type { Rule } from '../../shared/rules/types.ts';
import type { ProofreadIssue } from '../../shared/types.ts';
import type { DocParagraph } from '../llm/paragraphs.ts';

interface LtCategory {
  id: string;
  name?: string;
}

interface LtRuleRef {
  id: string;
  description?: string;
  category?: LtCategory;
}

interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements?: Array<{ value: string }>;
  rule?: LtRuleRef;
}

interface LtResponse {
  matches?: LtMatch[];
}

export interface LanguageToolHealth {
  ok: boolean;
  detail: string;
}

const LT_CATEGORY_TO_RULE: Record<string, string> = {
  GRAMMAR: 'grammar',
  COMPOUNDING: 'grammar',
  COLLOCATIONS: 'grammar',
  CONFUSED_WORDS: 'grammar',
  FALSE_FRIENDS: 'grammar',
  PUNCTUATION: 'punctuation',
  TYPOGRAPHY: 'punctuation',
  CASING: 'capitalization',
};

function chooseProofosRule(match: LtMatch, enabledRuleIds: Set<string>): string | null {
  const ltRuleId = match.rule?.id ?? '';
  const ltCategoryId = match.rule?.category?.id ?? '';

  // Prepositions are scattered across GRAMMAR / CONFUSED_WORDS in LT. If the
  // preposition rule is enabled, claim anything that looks prepositional first.
  if (enabledRuleIds.has('preposition') && /PREPOSITION|EN_A_VS_AN|^PREP_/i.test(ltRuleId)) {
    return 'preposition';
  }

  const fromCategory = LT_CATEGORY_TO_RULE[ltCategoryId];
  if (fromCategory && enabledRuleIds.has(fromCategory)) {
    return fromCategory;
  }
  return null;
}

function trimExplanation(input: string): string {
  const collapsed = input.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 120) return collapsed;
  return `${collapsed.slice(0, 117)}…`;
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function checkParagraphWithLanguageTool(
  paragraph: DocParagraph,
  rules: Rule[],
  ltUrl: string,
  signal?: AbortSignal
): Promise<ProofreadIssue[]> {
  if (!ltUrl) return [];
  if (rules.length === 0) return [];

  const enabledIds = new Set(rules.map((r) => r.id));
  const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
  const ruleCategoryById = new Map(rules.map((r) => [r.id, r.category]));

  const url = `${baseUrl(ltUrl)}/v2/check`;
  const body = new URLSearchParams({
    text: paragraph.text,
    language: 'en-US',
    level: 'default',
    enabledOnly: 'false',
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    });
  } catch (cause) {
    logger.warn({ err: cause, url }, 'LanguageTool fetch rejected');
    throw new Error('Could not reach LanguageTool.');
  }

  if (!response.ok) {
    throw new Error(`LanguageTool returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as LtResponse;
  const matches = payload.matches ?? [];
  const issues: ProofreadIssue[] = [];

  matches.forEach((match, idx) => {
    const proofosRuleId = chooseProofosRule(match, enabledIds);
    if (!proofosRuleId) return;

    const startIndex = paragraph.offset + match.offset;
    const endIndex = startIndex + match.length;
    const original = paragraph.text.slice(match.offset, match.offset + match.length);
    const suggestion = match.replacements?.[0]?.value ?? '';
    if (!suggestion) return;

    const ruleName = ruleNameById.get(proofosRuleId) ?? proofosRuleId;
    const category = ruleCategoryById.get(proofosRuleId) ?? 'custom';

    issues.push({
      id: `${proofosRuleId}:${startIndex}:${endIndex}:lt-${idx}`,
      ruleId: proofosRuleId,
      ruleName,
      category,
      startIndex,
      endIndex,
      original,
      suggestion,
      explanation: trimExplanation(match.shortMessage || match.message),
    });
  });

  return issues;
}

export async function healthCheckLanguageTool(
  ltUrl: string,
  signal?: AbortSignal
): Promise<LanguageToolHealth> {
  if (!ltUrl) {
    return { ok: false, detail: 'LanguageTool URL not configured.' };
  }
  const url = `${baseUrl(ltUrl)}/v2/languages`;
  try {
    const response = await fetch(url, { method: 'GET', signal });
    if (!response.ok) {
      return { ok: false, detail: `LanguageTool returned HTTP ${response.status}.` };
    }
    // LT returns objects like { name: 'English (US)', code: 'en', longCode: 'en-US' }.
    // We pass `language: 'en-US'` on /v2/check, so accept either field matching.
    const langs = (await response.json()) as Array<{ code?: string; longCode?: string }>;
    const hasEnUs = langs.some(
      (l) => l.longCode === 'en-US' || l.code === 'en-US' || l.code === 'en'
    );
    if (!hasEnUs) {
      return { ok: false, detail: 'LanguageTool reachable, but en-US is not loaded.' };
    }
    return { ok: true, detail: 'LanguageTool reachable.' };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    return {
      ok: false,
      detail: `Could not reach LanguageTool at ${ltUrl}. Run "npm run lt:up" to start it.`,
    };
  }
}
