import type { Rule } from '../../shared/rules/types.ts';
import type { ProofreadIssue } from '../../shared/types.ts';
import type { DocParagraph } from '../llm/paragraphs.ts';

/**
 * A LocalChecker evaluates a single rule against a single paragraph in JS,
 * with no network call. Returns a (possibly empty) array of issues whose
 * offsets are global to the full document.
 */
export type LocalChecker = (
  paragraph: DocParagraph,
  rule: Rule
) => Promise<ProofreadIssue[]> | ProofreadIssue[];
