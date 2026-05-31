import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../constants.ts';
import type { LlmSettings } from '../types.ts';
import type { Rule } from '../rules/types.ts';

export interface StorageData {
  [STORAGE_KEYS.LLM_SETTINGS]: LlmSettings;
  [STORAGE_KEYS.RULES_ENABLED]: Record<string, boolean>;
  [STORAGE_KEYS.CUSTOM_RULES]: Rule[];
  [STORAGE_KEYS.ONBOARDING_COMPLETE]: boolean;
}

// All ProofOS settings now live in chrome.storage.local — the user explicitly
// asked for local storage, plus local has no 100 KB cap and doesn't require the
// user to be signed into Chrome sync. To opt a key back into cross-device sync,
// add it to this tuple.
const SYNC_KEYS = [] as const;

function getStorageArea(key: string): chrome.storage.StorageArea {
  return SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])
    ? chrome.storage.sync
    : chrome.storage.local;
}

export async function getStorageValue<K extends keyof StorageData>(
  key: K
): Promise<StorageData[K]> {
  const storage = getStorageArea(key);
  const result = await storage.get(key);
  if (result[key] !== undefined) {
    return mergeDefaults(key, result[key] as StorageData[K]);
  }
  return cloneValue(STORAGE_DEFAULTS[key]) as StorageData[K];
}

export async function getStorageValues<K extends keyof StorageData>(
  keys: K[]
): Promise<Pick<StorageData, K>> {
  const data = {} as Pick<StorageData, K>;
  const syncKeys = keys.filter((k) => SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));
  const localKeys = keys.filter((k) => !SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));

  const [syncResult, localResult] = await Promise.all([
    syncKeys.length > 0
      ? chrome.storage.sync.get(syncKeys).then((result) => result as Partial<StorageData>)
      : Promise.resolve<Partial<StorageData>>({}),
    localKeys.length > 0
      ? chrome.storage.local.get(localKeys).then((result) => result as Partial<StorageData>)
      : Promise.resolve<Partial<StorageData>>({}),
  ]);

  for (const key of keys) {
    const result = SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number]) ? syncResult : localResult;
    const value = result[key];
    data[key] =
      value !== undefined
        ? mergeDefaults(key, value as StorageData[typeof key])
        : (cloneValue(STORAGE_DEFAULTS[key]) as StorageData[typeof key]);
  }

  return data;
}

export async function setStorageValue<K extends keyof StorageData>(
  key: K,
  value: StorageData[K]
): Promise<void> {
  const storage = getStorageArea(key);
  await storage.set({ [key]: value });
}

export async function setStorageValues(data: Partial<StorageData>): Promise<void> {
  const syncData: Partial<StorageData> = {};
  const localData: Partial<StorageData> = {};

  for (const [key, value] of Object.entries(data)) {
    if (SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])) {
      syncData[key as keyof StorageData] = value as never;
    } else {
      localData[key as keyof StorageData] = value as never;
    }
  }

  await Promise.all([
    Object.keys(syncData).length > 0 ? chrome.storage.sync.set(syncData) : Promise.resolve(),
    Object.keys(localData).length > 0 ? chrome.storage.local.set(localData) : Promise.resolve(),
  ]);
}

export function onStorageChange<K extends keyof StorageData>(
  key: K,
  callback: (newValue: StorageData[K], oldValue: StorageData[K]) => void
): () => void {
  const expectedArea = SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number]) ? 'sync' : 'local';
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === expectedArea && changes[key]) {
      const change = changes[key];
      callback(change.newValue as StorageData[K], change.oldValue as StorageData[K]);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function initializeStorage(): Promise<void> {
  const allKeys = Object.keys(STORAGE_DEFAULTS) as (keyof StorageData)[];
  const syncKeys = allKeys.filter((k) => SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));
  const localKeys = allKeys.filter((k) => !SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));

  const [syncValues, localValues] = await Promise.all([
    syncKeys.length > 0 ? chrome.storage.sync.get(syncKeys) : Promise.resolve({}),
    localKeys.length > 0 ? chrome.storage.local.get(localKeys) : Promise.resolve({}),
  ]);

  const syncUpdates: Partial<StorageData> = {};
  const localUpdates: Partial<StorageData> = {};

  for (const key of allKeys) {
    const target = SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number]) ? syncValues : localValues;
    if (!(key in target)) {
      const value = cloneValue(STORAGE_DEFAULTS[key]);
      if (SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])) {
        syncUpdates[key] = value as never;
      } else {
        localUpdates[key] = value as never;
      }
    }
  }

  await Promise.all([
    Object.keys(syncUpdates).length > 0 ? chrome.storage.sync.set(syncUpdates) : Promise.resolve(),
    Object.keys(localUpdates).length > 0
      ? chrome.storage.local.set(localUpdates)
      : Promise.resolve(),
  ]);
}

function mergeDefaults<K extends keyof StorageData>(key: K, value: StorageData[K]): StorageData[K] {
  if (key === STORAGE_KEYS.LLM_SETTINGS) {
    return {
      ...STORAGE_DEFAULTS[STORAGE_KEYS.LLM_SETTINGS],
      ...(value as object),
    } as StorageData[K];
  }
  return cloneValue(value);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (value && typeof value === 'object') {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }
  return value;
}
