import type { Rule } from '../../shared/rules/types.ts';
import type { ProofreadIssue } from '../../shared/types.ts';
import { LlmRequestError } from './provider.ts';

interface RawIssue {
  ruleId?: unknown;
  original?: unknown;
  suggestion?: unknown;
  explanation?: unknown;
}

interface RawResponse {
  issues?: unknown;
}

export function stripThinkBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

export interface ParseOptions {
  /**
   * Earliest position in `documentText` where the `original` snippet may be
   * located. Use this when the LLM was given a single paragraph and you want
   * to refuse matches against identical phrases elsewhere in the document.
   */
  searchStart?: number;
  /** Exclusive upper bound for the snippet's END position in `documentText`. */
  searchEnd?: number;
}

export function parseLlmResponse(
  rawContent: string,
  documentText: string,
  rules: Rule[],
  options: ParseOptions = {}
): ProofreadIssue[] {
  const cleaned = stripThinkBlocks(rawContent);
  const jsonChunk = extractFirstJsonObject(cleaned);
  if (!jsonChunk) {
    throw new LlmRequestError('invalid-response', 'LLM response did not contain a JSON object');
  }

  let parsed: RawResponse;
  try {
    parsed = JSON.parse(jsonChunk) as RawResponse;
  } catch (cause) {
    throw new LlmRequestError('invalid-response', 'LLM response JSON failed to parse', { cause });
  }

  if (!parsed.issues || !Array.isArray(parsed.issues)) {
    return [];
  }

  const ruleLookup = new Map(rules.map((rule) => [rule.id, rule]));
  const issues: ProofreadIssue[] = [];
  const searchStart = options.searchStart ?? 0;
  const searchEnd = options.searchEnd;

  for (let i = 0; i < parsed.issues.length; i += 1) {
    const raw = parsed.issues[i] as RawIssue;
    const ruleId = typeof raw.ruleId === 'string' ? raw.ruleId : '';
    const original = typeof raw.original === 'string' ? raw.original : '';
    const suggestion = typeof raw.suggestion === 'string' ? raw.suggestion : '';
    const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';

    if (!ruleId || !original || suggestion === undefined) {
      continue;
    }

    const rule = ruleLookup.get(ruleId);
    if (!rule) continue;

    const startIndex = documentText.indexOf(original, searchStart);
    if (startIndex === -1) {
      // The model invented or paraphrased the snippet; drop it rather than corrupting offsets.
      continue;
    }
    const endIndex = startIndex + original.length;
    if (searchEnd !== undefined && endIndex > searchEnd) {
      // Match landed past the target paragraph's range — refuse it.
      continue;
    }

    issues.push({
      id: `${ruleId}:${startIndex}:${endIndex}:${i}`,
      ruleId,
      ruleName: rule.name,
      category: rule.category,
      startIndex,
      endIndex,
      original,
      suggestion,
      explanation,
    });
  }

  return issues;
}
