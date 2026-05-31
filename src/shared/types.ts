import type { RuleCategory } from './rules/types.ts';

export interface ProofreadIssue {
  id: string;
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  startIndex: number;
  endIndex: number;
  original: string;
  suggestion: string;
  explanation: string;
  /**
   * Full text of the paragraph this issue lives in, attached by the proxy
   * so the side panel can render surrounding context with the original
   * substring highlighted. Optional only for backward-compat with stored data.
   */
  context?: string;
}

export interface ProofreadResult {
  issues: ProofreadIssue[];
}

export type LlmProviderId = 'ollama' | 'openai';

export interface LlmSettings {
  provider: LlmProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  /**
   * Self-hosted LanguageTool URL (e.g. http://localhost:8010).
   * Empty string disables LT; rules tagged `runner: 'languagetool'` fall back to LLM.
   */
  languageToolUrl: string;
}
