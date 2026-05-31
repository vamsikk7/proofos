import type { ProofreadIssue } from '../types.ts';

export type ProofreadErrorCode =
  | 'no-document'
  | 'no-text'
  | 'provider-unreachable'
  | 'provider-auth'
  | 'provider-not-found'
  | 'invalid-response'
  | 'aborted'
  | 'unknown';

export interface ProofreadError {
  code: ProofreadErrorCode;
  message: string;
}

export type DocumentHost = 'google-docs' | 'unknown';

export interface DocumentInfo {
  host: DocumentHost;
  title: string;
  url: string;
  tabId: number;
}

export interface ProofreadRequestMessage {
  type: 'proofos:proofread-request';
  payload: {
    requestId: string;
    tabId: number;
  };
}

export interface ProofreadResultMessage {
  type: 'proofos:proofread-result';
  payload: {
    requestId: string;
    tabId: number;
    document: DocumentInfo;
    issues: ProofreadIssue[];
    error: ProofreadError | null;
  };
}

export interface ApplyIssueMessage {
  type: 'proofos:apply-issue';
  payload: {
    requestId: string;
    tabId: number;
    issueId: string;
  };
}

export interface CancelProofreadMessage {
  type: 'proofos:cancel-proofread';
  payload: {
    requestId: string;
    tabId: number;
  };
}

export interface ProofreadProgressMessage {
  type: 'proofos:proofread-progress';
  payload: {
    requestId: string;
    tabId: number;
    newIssues: ProofreadIssue[];
    completedTasks: number;
    totalTasks: number;
  };
}

export interface ApplyResultMessage {
  type: 'proofos:apply-result';
  payload: {
    requestId: string;
    tabId: number;
    issueIds: string[];
    appliedIssueIds: string[];
    error: ProofreadError | null;
  };
}

export interface ActiveDocumentRequestMessage {
  type: 'proofos:get-active-document';
  payload: {
    tabId: number;
  };
}

export interface ActiveDocumentResponseMessage {
  type: 'proofos:active-document';
  payload: {
    tabId: number;
    document: DocumentInfo | null;
  };
}

export interface RunFromContentMessage {
  type: 'proofos:content-ready';
  payload: {
    document: DocumentInfo;
  };
}

export interface BusyStateUpdateMessage {
  type: 'proofos:busy-state';
  payload: {
    tabId: number;
    busy: boolean;
  };
}

export type ProofosMessage =
  | ProofreadRequestMessage
  | ProofreadResultMessage
  | ProofreadProgressMessage
  | ApplyIssueMessage
  | ApplyResultMessage
  | CancelProofreadMessage
  | ActiveDocumentRequestMessage
  | ActiveDocumentResponseMessage
  | RunFromContentMessage
  | BusyStateUpdateMessage;
