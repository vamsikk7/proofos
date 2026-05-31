import type { LlmSettings, ProofreadIssue } from '../../shared/types.ts';
import type { Rule } from '../../shared/rules/types.ts';

export interface ParagraphRef {
  id: string;
  text: string;
}

export interface ProofreadRequest {
  /** Text sent to the LLM (the target paragraph). */
  text: string;
  rules: Rule[];
  documentTitle?: string;
  signal?: AbortSignal;
  /**
   * Text used by the parser to resolve issue offsets. Defaults to `text`.
   * Pass the FULL document text here so resulting issues carry global offsets.
   */
  offsetReferenceText?: string;
  /** Short id (e.g. "p3") to embed in the prompt and require back in the response. */
  paragraphId?: string;
  /** Lower bound (inclusive) for `original.indexOf` against `offsetReferenceText`. */
  searchStart?: number;
  /** Upper bound (exclusive) for the match's END position. */
  searchEnd?: number;
  /** Optional context shown to the model — do-not-flag siblings of the target paragraph. */
  previousParagraph?: ParagraphRef | null;
  nextParagraph?: ParagraphRef | null;
}

export interface ProofreadResponse {
  issues: ProofreadIssue[];
  rawResponse?: string;
}

export interface LlmHealth {
  ok: boolean;
  detail: string;
}

export interface LlmProvider {
  id: string;
  proofread(req: ProofreadRequest): Promise<ProofreadResponse>;
  healthCheck(signal?: AbortSignal): Promise<LlmHealth>;
}

export class LlmRequestError extends Error {
  readonly code:
    | 'network'
    | 'unauthorized'
    | 'not-found'
    | 'invalid-response'
    | 'aborted'
    | 'unknown';
  readonly status?: number;

  constructor(
    code: LlmRequestError['code'],
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'LlmRequestError';
    this.code = code;
    this.status = options?.status;
  }
}

import { OllamaProvider } from './ollama.ts';
import { OpenAiCompatibleProvider } from './openai.ts';

export function createProvider(settings: LlmSettings): LlmProvider {
  if (settings.provider === 'openai') {
    return new OpenAiCompatibleProvider(settings);
  }
  return new OllamaProvider(settings);
}
