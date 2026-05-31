import type { Rule } from '../../shared/rules/types.ts';

export const SYSTEM_PROMPT = `You are ProofOS, a proofreading assistant.

The user will give you ONE target paragraph from a document, plus the paragraphs immediately before and after it for context only. Each paragraph carries a short id (p1, p2, ...). Apply the single rule the user provides and return issues that occur INSIDE the target paragraph as strict JSON.

OUTPUT FORMAT
Return ONLY a JSON object with this exact shape:

{
  "issues": [
    {
      "ruleId": "<the rule id the user supplied>",
      "paragraphId": "<the target paragraph id>",
      "original": "<exact substring from the TARGET paragraph, copied verbatim>",
      "suggestion": "<your suggested replacement for that substring>",
      "explanation": "<one short sentence explaining the fix>"
    }
  ]
}

REQUIREMENTS
- Output JSON only. No prose, no markdown fences, no preamble.
- Only flag issues in the TARGET paragraph. Use the surrounding paragraphs only to inform your judgement.
- "original" MUST be an exact substring of the TARGET paragraph, copied verbatim (matching case, spacing, punctuation).
- "paragraphId" MUST equal the target paragraph id.
- If the target paragraph is clean, return {"issues": []}.
- "explanation" must be one short sentence, no more than 120 characters.`;

export interface PromptParagraph {
  id: string;
  text: string;
}

export interface BuildPromptOptions {
  /**
   * All enabled LLM rules to apply to the target paragraph in a single call.
   * Bundling rules into one call lets the model consolidate — if a span would
   * match multiple rules it picks one, avoiding the duplicate findings you'd
   * otherwise get from running each rule independently.
   */
  rules: Rule[];
  target: PromptParagraph;
  previous?: PromptParagraph | null;
  next?: PromptParagraph | null;
  documentTitle?: string;
}

export function buildUserPrompt(options: BuildPromptOptions): string {
  const { rules, target, previous, next, documentTitle } = options;
  const titleLine = documentTitle ? `Document title: ${documentTitle}\n\n` : '';

  const ruleBlock = rules
    .map((rule) => `- ${rule.id} (${rule.name}, ${rule.category}): ${rule.instruction}`)
    .join('\n');

  const prevBlock = previous
    ? `Previous paragraph (id: ${previous.id}, context only, do not flag):\n"""\n${previous.text}\n"""\n\n`
    : '';
  const nextBlock = next
    ? `\nNext paragraph (id: ${next.id}, context only, do not flag):\n"""\n${next.text}\n"""\n`
    : '';

  return `${titleLine}Apply these rules to the target paragraph. Each issue must reference exactly one rule id (the most specific one that applies). Do not flag the same span under multiple rules.

Rules:
${ruleBlock}

${prevBlock}Target paragraph (id: ${target.id}, flag issues here):
"""
${target.text}
"""
${nextBlock}
Return JSON now.`;
}
