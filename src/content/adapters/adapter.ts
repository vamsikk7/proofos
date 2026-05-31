import type { DocumentHost } from '../../shared/messages/issues.ts';
import type { ProofreadIssue } from '../../shared/types.ts';

export interface DocumentAdapter {
  readonly host: DocumentHost;
  matches(): boolean;
  waitForReady(timeoutMs?: number): Promise<boolean>;
  getDocumentTitle(): string;
  getText(): Promise<string>;
  applyIssue(issue: ProofreadIssue): Promise<boolean>;
}

export class AdapterError extends Error {
  readonly code: 'not-ready' | 'read-failed' | 'apply-failed' | 'snippet-not-found';
  constructor(code: AdapterError['code'], message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'AdapterError';
    this.code = code;
  }
}

export function waitFor<T>(
  selectorFn: () => T | null | undefined,
  timeoutMs: number,
  intervalMs = 100
): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const value = selectorFn();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}
