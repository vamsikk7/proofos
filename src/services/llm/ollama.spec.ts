import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama.ts';
import type { LlmSettings } from '../../shared/types.ts';
import type { Rule } from '../../shared/rules/types.ts';

const baseSettings: LlmSettings = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'deepseek-r1:8b',
  apiKey: '',
  temperature: 0.2,
  maxTokens: 4096,
  languageToolUrl: '',
};

const spellingRule: Rule = {
  id: 'spelling',
  name: 'Spelling',
  category: 'spelling',
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

function mockResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe('OllamaProvider.proofread', () => {
  it('posts to /api/chat with the configured model and parses issues', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        message: {
          content: JSON.stringify({
            issues: [
              {
                ruleId: 'spelling',
                original: 'teh',
                suggestion: 'the',
                explanation: 'typo',
              },
            ],
          }),
        },
      })
    );

    const provider = new OllamaProvider(baseSettings);
    const result = await provider.proofread({ text: 'teh quick fox', rules: [spellingRule] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body.model).toBe('deepseek-r1:8b');
    expect(body.messages).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].suggestion).toBe('the');
  });

  it('strips DeepSeek-R1 reasoning blocks before parsing', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        message: {
          content: `<think>let me check</think>${JSON.stringify({
            issues: [{ ruleId: 'spelling', original: 'teh', suggestion: 'the', explanation: '' }],
          })}`,
        },
      })
    );

    const provider = new OllamaProvider(baseSettings);
    const result = await provider.proofread({ text: 'teh quick fox', rules: [spellingRule] });
    expect(result.issues).toHaveLength(1);
  });
});

describe('OllamaProvider.healthCheck', () => {
  it('reports ok when the model is listed in /api/tags', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ models: [{ name: 'deepseek-r1:8b' }, { name: 'llama3:8b' }] })
    );

    const provider = new OllamaProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
  });

  it('reports the pull command when the model is missing', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ models: [{ name: 'llama3:8b' }] }));
    const provider = new OllamaProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('ollama pull deepseek-r1:8b');
  });

  it('reports unreachable when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const provider = new OllamaProvider(baseSettings);
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.detail.toLowerCase()).toContain('ollama');
  });
});
