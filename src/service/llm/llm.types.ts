export enum LlmTask {
  SCREENING = 'SCREENING',
  PAPER_ANALYSIS = 'PAPER_ANALYSIS',
  ARTICLE_WRITING = 'ARTICLE_WRITING',
  OUTLOOK = 'OUTLOOK',
}

export type LlmErrorKind =
  | 'NOT_CONFIGURED'
  | 'BUDGET_EXCEEDED'
  | 'REFUSAL'
  | 'TRUNCATED'
  | 'INVALID_OUTPUT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'REQUEST_REJECTED';

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set([
  'BUDGET_EXCEEDED',
  'TRUNCATED',
  'INVALID_OUTPUT',
  'RATE_LIMITED',
  'UNAVAILABLE',
]);

export class LlmError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
    this.retryable = RETRYABLE.has(kind);
  }
}

export interface LlmJsonRequest {
  task: LlmTask;
  system: string;
  prompt: string;
  /** JSON schema for structured output (objects need additionalProperties: false). */
  schema: Record<string, unknown>;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmJsonResult {
  /** Parsed JSON; callers must validate it against their domain rules. */
  data: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmUsageSummaryRow {
  task: LlmTask;
  model: string;
  status: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
