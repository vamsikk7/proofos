import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleProvider } from './openai.ts';
import type { LlmSettings } from '../../shared/types.ts';
import type { Rule } from '../../shared/rules/types.ts';
import { LlmRequestError } from './provider.ts';

const baseSettings: LlmSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test',
  temperature: 0.2,
  maxTokens: 1024,
  languageToolUrl: '',
};

const grammarRule: Rule = {
  id: 'grammar',
  name: 'Grammar',
  category: 'grammar',
  instruction: '',
  enabled: true,
  builtin: true,
  runner: 'llm',
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe('OpenAiCompatibleProvider.proofread', () => {
  it('sends a chat completion with bearer auth and parses choices[0]', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                issues: [
                  { ruleId: 'grammar', original: 'he go', suggestion: 'he goes', explanation: '' },
                ],
              }),
            },
          },
        ],
      })
    );

    const provider = new OpenAiCompatibleProvider(baseSettings);
    const result = await provider.proofread({ text: 'he go to school', rules: [grammarRule] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(result.issues).toHaveLength(1);
  });

  it('throws LlmRequestError on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }));
    const provider = new OpenAiCompatibleProvider(baseSettings);
    await expect(provider.proofread({ text: 'hi', rules: [grammarRule] })).rejects.toBeInstanceOf(
      LlmRequestError
    );
  });
});

describe('OpenAiCompatibleProvider.healthCheck', () => {
  it('reports ok when the configured model is in the models list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-4o-mini' }] }));
    const provider = new OpenAiCompatibleProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
  });

  it('reports auth failure on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }));
    const provider = new OpenAiCompatibleProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail.toLowerCase()).toContain('authentication');
  });

  it('reports model missing if /v1/models returns ids without the configured model', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-3.5-turbo' }] }));
    const provider = new OpenAiCompatibleProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('gpt-4o-mini');
  });
});
