import type { Rule } from './types.ts';

export const DEFAULT_RULES: ReadonlyArray<Rule> = [
  {
    id: 'spelling',
    name: 'Spelling',
    category: 'spelling',
    instruction:
      'Flag misspelled words. Suggest the most likely intended spelling. Skip proper nouns and domain-specific jargon unless clearly typed in error.',
    enabled: true,
    builtin: true,
    // Handled locally by nspell + dictionary-en. No LLM call.
    runner: 'local',
  },
  {
    id: 'grammar',
    name: 'Grammar',
    category: 'grammar',
    instruction:
      'Flag subject-verb agreement errors, wrong verb tense, incorrect pronoun case, and other grammar mistakes. Provide the corrected phrase.',
    enabled: true,
    builtin: true,
    runner: 'languagetool',
  },
  {
    id: 'punctuation',
    name: 'Punctuation',
    category: 'punctuation',
    instruction:
      'Flag missing or misplaced commas, periods, semicolons, colons, quotation marks, apostrophes. Suggest the punctuation that should appear.',
    enabled: true,
    builtin: true,
    runner: 'languagetool',
  },
  {
    id: 'capitalization',
    name: 'Capitalization',
    category: 'capitalization',
    instruction:
      'Flag missing capitals at the start of sentences, proper nouns, and abbreviations that should be capitalized. Suggest the corrected casing.',
    enabled: true,
    builtin: true,
    runner: 'languagetool',
  },
  {
    id: 'preposition',
    name: 'Preposition usage',
    category: 'preposition',
    instruction:
      'Flag the wrong preposition for the verb or context (e.g. "interested on" → "interested in"). Suggest the idiomatic preposition.',
    enabled: true,
    builtin: true,
    runner: 'languagetool',
  },
  {
    id: 'missing-words',
    name: 'Missing words',
    category: 'missing-words',
    instruction:
      'Flag obviously missing articles ("a", "an", "the"), auxiliary verbs, or pronouns that make the sentence ungrammatical. Suggest the inserted word in context.',
    enabled: true,
    builtin: true,
    runner: 'llm',
  },
  {
    id: 'clarity',
    name: 'Clarity',
    category: 'clarity',
    instruction:
      'Flag vague pronouns ("this", "it" with unclear antecedents), jargon used without explanation, and ambiguous phrasing. Suggest a clearer rewrite of just the problematic span.',
    enabled: true,
    builtin: true,
    runner: 'llm',
  },
  {
    id: 'conciseness',
    name: 'Conciseness',
    category: 'conciseness',
    instruction:
      'Flag redundant phrases ("in order to", "due to the fact that", "at this point in time") and obvious filler words. Suggest the shorter version.',
    enabled: true,
    builtin: true,
    runner: 'llm',
  },
  {
    id: 'passive-voice',
    name: 'Passive voice',
    category: 'passive-voice',
    instruction:
      'Flag passive-voice sentences where the actor matters or active voice would read more directly. Suggest the active rewrite of just the clause.',
    enabled: false,
    builtin: true,
    runner: 'llm',
  },
  {
    id: 'sentence-length',
    name: 'Sentence length',
    category: 'sentence-length',
    instruction:
      'Flag sentences over ~40 words. Five lines of code, not an LLM call.',
    enabled: false,
    builtin: true,
    // Pure word-counting in JS.
    runner: 'local',
  },
  {
    id: 'parallelism',
    name: 'Parallel structure',
    category: 'parallelism',
    instruction:
      'Flag lists or coordinated clauses whose elements are not grammatically parallel. Suggest a rewrite that makes the items parallel.',
    enabled: false,
    builtin: true,
    runner: 'llm',
  },
];

export const DEFAULT_RULE_IDS: ReadonlySet<string> = new Set(DEFAULT_RULES.map((r) => r.id));
