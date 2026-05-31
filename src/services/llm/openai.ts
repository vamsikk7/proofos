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

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
  error?: { message?: string };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = 'openai';

  constructor(private readonly settings: LlmSettings) {}

  async proofread(request: ProofreadRequest): Promise<ProofreadResponse> {
    const { text, rules, signal } = request;
    const url = `${normalizeBaseUrl(this.settings.baseUrl)}/v1/chat/completions`;
    const userPrompt = buildUserPrompt({
      rules,
      target: { id: request.paragraphId ?? 'p1', text },
      previous: request.previousParagraph ?? null,
      next: request.nextParagraph ?? null,
      documentTitle: request.documentTitle,
    });
    const body = {
      model: this.settings.model,
      temperature: this.settings.temperature,
      max_tokens: this.settings.maxTokens,
      response_format: { type: 'json_object' as const },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    };

    const response = await this.send(url, body, signal);
    const payload = (await response.json()) as OpenAiChatResponse;
    if (payload.error?.message) {
      throw new LlmRequestError('invalid-response', payload.error.message);
    }

    const content = payload.choices?.[0]?.message?.content ?? '';
    const issues = parseLlmResponse(content, request.offsetReferenceText ?? text, rules, {
      searchStart: request.searchStart,
      searchEnd: request.searchEnd,
    });
    return { issues, rawResponse: content };
  }

  async healthCheck(signal?: AbortSignal): Promise<LlmHealth> {
    const url = `${normalizeBaseUrl(this.settings.baseUrl)}/v1/models`;
    try {
      const headers = this.buildHeaders();
      const response = await fetch(url, { method: 'GET', headers, signal });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: 'Authentication failed. Check your API key.' };
      }
      if (!response.ok) {
        return { ok: false, detail: `Server returned ${response.status}.` };
      }
      const payload = (await response.json()) as OpenAiModelsResponse;
      if (payload.error?.message) {
        return { ok: false, detail: payload.error.message };
      }
      const ids = payload.data?.map((m) => m.id ?? '') ?? [];
      const has = ids.some(
        (id) => id === this.settings.model || id.endsWith(`/${this.settings.model}`)
      );
      if (ids.length > 0 && !has) {
        return {
          ok: false,
          detail: `Connected, but model "${this.settings.model}" was not in the /v1/models list.`,
        };
      }
      return { ok: true, detail: 'Connection successful.' };
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new LlmRequestError('aborted', 'Request aborted', { cause });
      }
      return { ok: false, detail: `Could not reach ${this.settings.baseUrl}.` };
    }
  }

  private async send(
    url: string,
    body: unknown,
    signal: AbortSignal | undefined
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        throw new LlmRequestError('aborted', 'Request aborted', { cause });
      }
      throw new LlmRequestError('network', `Failed to reach ${url}`, { cause });
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmRequestError('unauthorized', 'Authentication failed. Check your API key.', {
        status: response.status,
      });
    }
    if (response.status === 404) {
      throw new LlmRequestError(
        'not-found',
        `Endpoint not found. Check the base URL (${this.settings.baseUrl}).`,
        { status: response.status }
      );
    }
    if (!response.ok) {
      throw new LlmRequestError('network', `Server returned ${response.status}`, {
        status: response.status,
      });
    }
    return response;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.settings.apiKey) {
      headers.authorization = `Bearer ${this.settings.apiKey}`;
    }
    return headers;
  }
}
