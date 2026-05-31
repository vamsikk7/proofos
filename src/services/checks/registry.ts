import { checkSentenceLength } from './sentence-length.ts';
import { checkSpelling } from './spelling.ts';
import type { LocalChecker } from './types.ts';

const REGISTRY: Record<string, LocalChecker> = {
  spelling: checkSpelling,
  'sentence-length': checkSentenceLength,
};

export function getLocalChecker(ruleId: string): LocalChecker | null {
  return REGISTRY[ruleId] ?? null;
}
