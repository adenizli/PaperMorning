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
    /**
     * Set only when the provider answered with a definitive, unbilled transient error (HTTP 429,
     * 5xx, 529), so the same request may be sent again immediately. Never set for outcomes that
     * may have been processed (timeouts, dropped connections).
     */
    readonly transient: { retryAfterMs: number | null } | null = null,
  ) {
    super(message);
    this.name = 'LlmError';
    this.retryable = RETRYABLE.has(kind);
  }
}

/**
 * Ledger states. RESERVED: worst-case cost held before the call (also what a crash leaves behind,
 * so it keeps counting). SUCCEEDED/FAILED: settled to the provider-reported usage (0 for a
 * definitive error response, which is not billed). UNKNOWN: the outcome is uncertain (timeout or
 * dropped connection), so the worst-case reservation stays charged.
 */
export type LlmUsageStatus = 'RESERVED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

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
