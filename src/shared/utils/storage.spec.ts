import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LLM_SETTINGS, STORAGE_KEYS } from '../constants.ts';
import {
  getStorageValue,
  getStorageValues,
  initializeStorage,
  setStorageValue,
  setStorageValues,
} from './storage.ts';

interface StorageArea {
  data: Record<string, unknown>;
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

const globalAny = globalThis as Record<string, unknown>;

function createStorageArea(): StorageArea {
  const area: StorageArea = {
    data: {},
    async get(keys) {
      if (!keys) return { ...area.data };
      const list = Array.isArray(keys) ? keys : [keys as string];
      const result: Record<string, unknown> = {};
      for (const key of list) {
        if (key in area.data) result[key] = area.data[key];
      }
      return result;
    },
    async set(items) {
      Object.assign(area.data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        delete area.data[key];
      }
    },
    async clear() {
      area.data = {};
    },
  };
  return area;
}

describe('storage utilities', () => {
  let sync: StorageArea;
  let local: StorageArea;

  beforeEach(() => {
    sync = createStorageArea();
    local = createStorageArea();
    globalAny.chrome = {
      storage: {
        sync,
        local,
        onChanged: { addListener: () => {}, removeListener: () => {} },
      },
    };
  });

  afterEach(() => {
    delete globalAny.chrome;
  });

  it('returns defaults for missing keys', async () => {
    const settings = await getStorageValue(STORAGE_KEYS.LLM_SETTINGS);
    expect(settings).toEqual(DEFAULT_LLM_SETTINGS);
    expect(await getStorageValue(STORAGE_KEYS.CUSTOM_RULES)).toEqual([]);
    expect(await getStorageValue(STORAGE_KEYS.RULES_ENABLED)).toEqual({});
  });

  it('merges partial LLM settings into defaults', async () => {
    local.data[STORAGE_KEYS.LLM_SETTINGS] = { provider: 'openai', model: 'gpt-4o-mini' };
    const settings = await getStorageValue(STORAGE_KEYS.LLM_SETTINGS);
    expect(settings.provider).toBe('openai');
    expect(settings.model).toBe('gpt-4o-mini');
    expect(settings.baseUrl).toBe(DEFAULT_LLM_SETTINGS.baseUrl);
    expect(settings.temperature).toBe(DEFAULT_LLM_SETTINGS.temperature);
  });

  it('round-trips set/get for settings', async () => {
    await setStorageValue(STORAGE_KEYS.RULES_ENABLED, { spelling: false });
    expect(await getStorageValue(STORAGE_KEYS.RULES_ENABLED)).toEqual({ spelling: false });
    // All settings now persist to chrome.storage.local, not .sync.
    expect(local.data[STORAGE_KEYS.RULES_ENABLED]).toEqual({ spelling: false });
    expect(sync.data[STORAGE_KEYS.RULES_ENABLED]).toBeUndefined();
  });

  it('initializeStorage seeds defaults for missing keys only', async () => {
    local.data[STORAGE_KEYS.RULES_ENABLED] = { spelling: false };
    await initializeStorage();
    expect(local.data[STORAGE_KEYS.RULES_ENABLED] as object).toEqual({ spelling: false });
    expect(local.data[STORAGE_KEYS.LLM_SETTINGS]).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it('getStorageValues fetches multiple keys at once', async () => {
    await setStorageValues({
      [STORAGE_KEYS.LLM_SETTINGS]: { ...DEFAULT_LLM_SETTINGS, model: 'llama3:8b' },
      [STORAGE_KEYS.CUSTOM_RULES]: [
        {
          id: 'custom-1',
          name: 'foo',
          category: 'custom',
          instruction: 'bar',
          enabled: true,
          builtin: false,
          runner: 'llm',
        },
      ],
    });
    const out = await getStorageValues([STORAGE_KEYS.LLM_SETTINGS, STORAGE_KEYS.CUSTOM_RULES]);
    expect(out[STORAGE_KEYS.LLM_SETTINGS].model).toBe('llama3:8b');
    expect(out[STORAGE_KEYS.CUSTOM_RULES]).toHaveLength(1);
  });
});
