import type { LlmSettings } from '../../shared/types.ts';
import { parseLlmResponse } from './parser.ts';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompts.ts';
import {
  LlmRequestError,
  type LlmHealth,
  type LlmProvider,
  type ProofreadRequest,
  type ProofreadResponse,
} from './provider.ts';

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama';

  constructor(private readonly settings: LlmSettings) {}

  async proofread(request: ProofreadRequest): Promise<ProofreadResponse> {
    const { text, rules, signal } = request;
    const url = `${normalizeBaseUrl(this.settings.baseUrl)}/api/chat`;
    const userPrompt = buildUserPrompt({
      rules,
      target: { id: request.paragraphId ?? 'p1', text },
      previous: request.previousParagraph ?? null,
      next: request.nextParagraph ?? null,
      documentTitle: request.documentTitle,
    });
    const body = {
      model: this.settings.model,
      stream: false,
      options: {
        temperature: this.settings.temperature,
        num_predict: this.settings.maxTokens,
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    };

    const response = await safeFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new LlmRequestError('network', `Ollama responded ${response.status}`, {
        status: response.status,
      });
    }

    const payload = (await response.json()) as OllamaChatResponse;
    if (payload.error) {
      throw new LlmRequestError('invalid-response', payload.error);
    }

    const content = payload.message?.content ?? '';
    const issues = parseLlmResponse(content, request.offsetReferenceText ?? text, rules, {
      searchStart: request.searchStart,
      searchEnd: request.searchEnd,
    });
    return { issues, rawResponse: content };
  }

  async healthCheck(signal?: AbortSignal): Promise<LlmHealth> {
    const url = `${normalizeBaseUrl(this.settings.baseUrl)}/api/tags`;
    try {
      const response = await safeFetch(url, { method: 'GET', signal });
      if (!response.ok) {
        return {
          ok: false,
          detail: `Ollama returned ${response.status}. Is the server running?`,
        };
      }
      const payload = (await response.json()) as OllamaTagsResponse;
      const has = payload.models?.some((m) => (m.name ?? '').startsWith(this.settings.model));
      if (!has) {
        return {
          ok: false,
          detail: `Model "${this.settings.model}" is not pulled. Run: ollama pull ${this.settings.model}`,
        };
      }
      return { ok: true, detail: `Reachable. Model ${this.settings.model} is available.` };
    } catch (error) {
      return { ok: false, detail: describeNetworkError(error, this.settings.baseUrl) };
    }
  }
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new LlmRequestError('aborted', 'Request aborted', { cause });
    }
    throw new LlmRequestError('network', `Failed to reach ${url}`, { cause });
  }
}

function describeNetworkError(error: unknown, baseUrl: string): string {
  if (error instanceof LlmRequestError && error.code !== 'network') {
    return error.message;
  }
  return `Could not reach Ollama at ${baseUrl}. Make sure the server is running (try: ollama serve).`;
}
