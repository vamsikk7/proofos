import type { ProofreadIssue } from '../../shared/types.ts';
import type { LocalChecker } from './types.ts';

const SENTENCE_REGEX = /[^.!?]+[.!?]+["')\]]*\s*/g;
const WORD_REGEX = /\b\w+\b/g;
const SENTENCE_LIMIT = 40;

export const checkSentenceLength: LocalChecker = (paragraph, rule) => {
  const issues: ProofreadIssue[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = SENTENCE_REGEX.exec(paragraph.text)) !== null) {
    const sentence = match[0];
    const words = sentence.match(WORD_REGEX) ?? [];
    if (words.length <= SENTENCE_LIMIT) continue;

    // Trim trailing whitespace from the highlighted range but keep the
    // ending punctuation so the user can locate it in the doc.
    const trimmed = sentence.replace(/\s+$/, '');
    const startIndex = paragraph.offset + match.index;
    const endIndex = startIndex + trimmed.length;

    issues.push({
      id: `${rule.id}:${startIndex}:${endIndex}:loc-${idx}`,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      startIndex,
      endIndex,
      original: trimmed,
      // No literal rewrite — this is editorial guidance, not a substitution.
      suggestion: `[${words.length} words — consider splitting into shorter sentences]`,
      explanation: `Sentence has ${words.length} words; ${SENTENCE_LIMIT} or fewer is easier to follow.`,
    });
    idx += 1;
  }

  return issues;
};
