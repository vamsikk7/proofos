import type { LlmSettings } from './types.ts';
import type { Rule } from './rules/types.ts';

export const STORAGE_KEYS = {
  LLM_SETTINGS: 'llmSettings',
  RULES_ENABLED: 'rulesEnabled',
  CUSTOM_RULES: 'customRules',
  ONBOARDING_COMPLETE: 'onboardingComplete',
} as const;

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  // qwen2.5 is non-reasoning (no <think> overhead) so each per-paragraph,
  // per-rule call returns in 1-3s vs 60s+ on a reasoning model like deepseek-r1.
  model: 'qwen2.5:latest',
  apiKey: '',
  temperature: 0.2,
  maxTokens: 4096,
  // Matches the docker-compose service. Empty string disables LT and forces
  // grammar/punctuation/capitalization/preposition rules to fall back to LLM.
  languageToolUrl: 'http://localhost:8010',
};

export const STORAGE_DEFAULTS = {
  [STORAGE_KEYS.LLM_SETTINGS]: DEFAULT_LLM_SETTINGS,
  [STORAGE_KEYS.RULES_ENABLED]: {} as Record<string, boolean>,
  [STORAGE_KEYS.CUSTOM_RULES]: [] as Rule[],
  [STORAGE_KEYS.ONBOARDING_COMPLETE]: false,
} as const;
