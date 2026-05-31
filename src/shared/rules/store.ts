import { STORAGE_KEYS } from '../constants.ts';
import { getStorageValues, setStorageValue } from '../utils/storage.ts';
import { DEFAULT_RULES, DEFAULT_RULE_IDS } from './defaults.ts';
import type { CustomRuleInput, Rule, RuleCategory } from './types.ts';

const VALID_CATEGORIES: ReadonlySet<RuleCategory> = new Set([
  'spelling',
  'grammar',
  'punctuation',
  'capitalization',
  'preposition',
  'missing-words',
  'clarity',
  'conciseness',
  'passive-voice',
  'sentence-length',
  'parallelism',
  'custom',
]);

function sanitizeCustomRule(
  input: CustomRuleInput
): { name: string; instruction: string; category: RuleCategory } | null {
  const name = input.name.trim().slice(0, 80);
  const instruction = input.instruction.trim().slice(0, 800);
  const category = VALID_CATEGORIES.has(input.category) ? input.category : 'custom';
  if (!name || !instruction) {
    return null;
  }
  return { name, instruction, category };
}

function customRuleId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom-${Date.now()}-${random}`;
}

export async function loadRules(): Promise<Rule[]> {
  const stored = await getStorageValues([STORAGE_KEYS.RULES_ENABLED, STORAGE_KEYS.CUSTOM_RULES]);
  const enabledOverrides = stored[STORAGE_KEYS.RULES_ENABLED];
  const customRules = stored[STORAGE_KEYS.CUSTOM_RULES];

  const builtins: Rule[] = DEFAULT_RULES.map((rule) => ({
    ...rule,
    enabled:
      typeof enabledOverrides[rule.id] === 'boolean' ? enabledOverrides[rule.id] : rule.enabled,
  }));

  const customs: Rule[] = customRules.map((rule) => ({
    ...rule,
    enabled:
      typeof enabledOverrides[rule.id] === 'boolean' ? enabledOverrides[rule.id] : rule.enabled,
  }));

  return [...builtins, ...customs];
}

export async function getEnabledRules(): Promise<Rule[]> {
  const all = await loadRules();
  return all.filter((rule) => rule.enabled);
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const stored = await getStorageValues([STORAGE_KEYS.RULES_ENABLED]);
  const next = { ...stored[STORAGE_KEYS.RULES_ENABLED], [ruleId]: enabled };
  await setStorageValue(STORAGE_KEYS.RULES_ENABLED, next);
}

export async function addCustomRule(input: CustomRuleInput): Promise<Rule | null> {
  const sanitized = sanitizeCustomRule(input);
  if (!sanitized) {
    return null;
  }
  const newRule: Rule = {
    id: customRuleId(),
    ...sanitized,
    enabled: true,
    builtin: false,
    // User-authored rules always go through the LLM — they're free-form English,
    // not structured enough for the deterministic checkers.
    runner: 'llm',
  };
  const stored = await getStorageValues([STORAGE_KEYS.CUSTOM_RULES]);
  const next = [...stored[STORAGE_KEYS.CUSTOM_RULES], newRule];
  await setStorageValue(STORAGE_KEYS.CUSTOM_RULES, next);
  return newRule;
}

export async function updateCustomRule(
  ruleId: string,
  input: CustomRuleInput
): Promise<Rule | null> {
  if (DEFAULT_RULE_IDS.has(ruleId)) {
    return null;
  }
  const sanitized = sanitizeCustomRule(input);
  if (!sanitized) {
    return null;
  }
  const stored = await getStorageValues([STORAGE_KEYS.CUSTOM_RULES]);
  let updated: Rule | null = null;
  const next = stored[STORAGE_KEYS.CUSTOM_RULES].map((rule) => {
    if (rule.id !== ruleId) {
      return rule;
    }
    updated = { ...rule, ...sanitized };
    return updated;
  });
  if (!updated) {
    return null;
  }
  await setStorageValue(STORAGE_KEYS.CUSTOM_RULES, next);
  return updated;
}

export async function deleteCustomRule(ruleId: string): Promise<void> {
  if (DEFAULT_RULE_IDS.has(ruleId)) {
    return;
  }
  const stored = await getStorageValues([STORAGE_KEYS.CUSTOM_RULES, STORAGE_KEYS.RULES_ENABLED]);
  const nextRules = stored[STORAGE_KEYS.CUSTOM_RULES].filter((rule) => rule.id !== ruleId);
  const { [ruleId]: _removed, ...nextEnabled } = stored[STORAGE_KEYS.RULES_ENABLED];
  void _removed;
  await setStorageValue(STORAGE_KEYS.CUSTOM_RULES, nextRules);
  await setStorageValue(STORAGE_KEYS.RULES_ENABLED, nextEnabled);
}

export function onRulesChanged(callback: () => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ): void => {
    if (areaName !== 'sync') {
      return;
    }
    if (changes[STORAGE_KEYS.RULES_ENABLED] || changes[STORAGE_KEYS.CUSTOM_RULES]) {
      callback();
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
