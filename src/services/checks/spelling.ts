import nspell from 'nspell';

import type { ProofreadIssue } from '../../shared/types.ts';
import type { LocalChecker } from './types.ts';

type NSpellInstance = ReturnType<typeof nspell>;

// Dictionary files are vendored from `dictionary-en` into `public/dict/` so the
// extension service worker can fetch them via its own chrome-extension:// origin.
// They're fetched lazily on first spelling check and cached for the SW's lifetime.
const AFF_PATH = 'dict/en-US.aff';
const DIC_PATH = 'dict/en-US.dic';

let cached: Promise<NSpellInstance> | null = null;

function loadSpell(): Promise<NSpellInstance> {
  if (cached) return cached;
  const base = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('') : '/';
  cached = (async () => {
    const [aff, dic] = await Promise.all([
      fetch(`${base}${AFF_PATH}`).then((r) => r.text()),
      fetch(`${base}${DIC_PATH}`).then((r) => r.text()),
    ]);
    return nspell(aff, dic);
  })();
  return cached;
}

const WORD_REGEX = /\b[A-Za-z][A-Za-z'’-]*\b/g;

export const checkSpelling: LocalChecker = async (paragraph, rule) => {
  const spell = await loadSpell();
  const issues: ProofreadIssue[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = WORD_REGEX.exec(paragraph.text)) !== null) {
    const word = match[0];
    // Filter the obvious noise sources before hitting the dictionary.
    if (word.length < 3) continue;
    if (/\d/.test(word)) continue;
    // All-caps words are almost always acronyms; flagging them produces noise.
    if (word.length > 1 && word === word.toUpperCase()) continue;
    if (spell.correct(word)) continue;

    const suggestions = spell.suggest(word);
    if (suggestions.length === 0) continue;
    const suggestion = suggestions[0];
    if (!suggestion || suggestion.toLowerCase() === word.toLowerCase()) continue;

    const startIndex = paragraph.offset + match.index;
    const endIndex = startIndex + word.length;
    issues.push({
      id: `${rule.id}:${startIndex}:${endIndex}:loc-${idx}`,
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      startIndex,
      endIndex,
      original: word,
      suggestion,
      explanation: `Possible misspelling — did you mean "${suggestion}"?`,
    });
    idx += 1;
  }

  return issues;
};
