export type RuleCategory =
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'preposition'
  | 'missing-words'
  | 'clarity'
  | 'conciseness'
  | 'passive-voice'
  | 'sentence-length'
  | 'parallelism'
  | 'custom';

/**
 * Which engine evaluates this rule.
 *
 * - `local`: pure JS in the service worker — no network, sub-millisecond per call.
 *   Used for rules that have well-established deterministic checks (spelling via
 *   nspell, sentence-length via word counting).
 * - `languagetool`: a self-hosted LanguageTool server (see docker-compose.yml).
 *   One HTTP call per paragraph returns matches for every LT-backed rule at once.
 *   Falls back to `llm` if no LT URL is configured.
 * - `llm`: the configured LLM provider (Ollama / OpenAI-compatible). Used for
 *   nuanced rules that need understanding (clarity, missing words, parallelism).
 */
export type RuleRunner = 'local' | 'languagetool' | 'llm';

export interface Rule {
  id: string;
  name: string;
  category: RuleCategory;
  instruction: string;
  enabled: boolean;
  builtin: boolean;
  runner: RuleRunner;
}

export interface CustomRuleInput {
  name: string;
  category: RuleCategory;
  instruction: string;
}
