import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig, ModelPrice } from '../../config/app.config';
import { LlmUsageEntity } from './llm-usage.entity';
import {
  LlmError,
  LlmErrorKind,
  LlmJsonRequest,
  LlmJsonResult,
  LlmTask,
  LlmUsageStatus,
  LlmUsageSummaryRow,
} from './llm.types';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/** pg advisory lock key that serializes budget reservations (one short transaction each). */
export const LLM_BUDGET_LOCK_KEY = 72_100_101;
/** Re-sends after a definitive, unbilled transient error (429 / 5xx / 529). */
export const LLM_TRANSIENT_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 20_000;
/**
 * Tokens added to the input upper bound for the structured-output system instructions the API
 * adds. The text itself is bounded by its UTF-8 byte length (a token is never shorter than a byte).
 */
const STRUCTURED_OUTPUT_OVERHEAD_TOKENS = 2_000;

interface Reservation {
  id: string;
  reservedUsd: number;
}

/**
 * Claude transport with fixed, auditable task -> model routing (Haiku for screening, Sonnet for
 * analysis/writing/outlook, Opus only when explicitly enabled by config).
 *
 * Budget: before every provider request a worst-case cost is reserved in the `llm_usage` ledger
 * under a PostgreSQL advisory lock, counting all in-flight reservations, so concurrent callers can
 * never collectively exceed LLM_DAILY_BUDGET_USD. The reservation is settled to the reported usage
 * afterwards; uncertain outcomes keep the worst case. No transaction is held across the API call.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic | null,
    @InjectRepository(LlmUsageEntity) private readonly usage: Repository<LlmUsageEntity>,
  ) {}

  isAvailable(): boolean {
    return this.client !== null;
  }

  modelFor(task: LlmTask): string {
    const { models } = this.config.llm;
    switch (task) {
      case LlmTask.SCREENING:
        return models.screening;
      case LlmTask.PAPER_ANALYSIS:
        return models.analysis;
      case LlmTask.ARTICLE_WRITING:
        return models.writing;
      case LlmTask.OUTLOOK:
        return models.outlook;
    }
  }

  /**
   * Upper bound on how long one generateJson() can take: every attempt runs into the client
   * timeout and every retry waits the maximum back-off. Callers size claim leases from this.
   */
  maxCallDurationMs(): number {
    const attempts = 1 + LLM_TRANSIENT_RETRIES;
    return attempts * this.config.llm.timeoutMs + LLM_TRANSIENT_RETRIES * MAX_RETRY_DELAY_MS;
  }

  /** Worst-case USD of one provider request for this task (what is reserved before sending). */
  worstCaseCostUsd(request: LlmJsonRequest): number {
    const price = this.price(this.modelFor(request.task));
    const inputUpperBound =
      Buffer.byteLength(request.system, 'utf8') +
      Buffer.byteLength(request.prompt, 'utf8') +
      Buffer.byteLength(JSON.stringify(request.schema), 'utf8') +
      STRUCTURED_OUTPUT_OVERHEAD_TOKENS;
    return (
      (inputUpperBound * price.inputPerMTokUsd + request.maxTokens * price.outputPerMTokUsd) /
      1_000_000
    );
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    if (!this.client) {
      throw new LlmError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(this.client, request);
      } catch (error) {
        if (!(error instanceof LlmError) || !error.transient || attempt >= LLM_TRANSIENT_RETRIES) {
          throw error;
        }
        const delayMs = Math.min(
          error.transient.retryAfterMs ?? 1_000 * 2 ** attempt,
          MAX_RETRY_DELAY_MS,
        );
        this.logger.warn(`${request.task}: ${error.message}; retrying in ${delayMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /** One provider request: reserve -> call (no transaction open) -> settle. */
  private async attempt(client: Anthropic, request: LlmJsonRequest): Promise<LlmJsonResult> {
    const model = this.modelFor(request.task);
    const reservation = await this.reserve(request, model);

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: {
            format: { type: 'json_schema', schema: request.schema },
            ...(request.effort ? { effort: request.effort } : {}),
          },
        },
        // Retries are done above, one reservation per request actually sent.
        { maxRetries: 0 },
      );
    } catch (error) {
      const failure = classifyApiError(error);
      const message = `Claude call for ${request.task} failed: ${errorMessage(error)}`;
      if (failure.definitive) {
        // The API answered with an error status: nothing was generated or billed.
        await this.settle(reservation, model, 'FAILED', failure.kind, 0, 0, 0);
        throw new LlmError(
          failure.kind,
          message,
          failure.transient ? { retryAfterMs: failure.retryAfterMs } : null,
        );
      }
      // No response (timeout / dropped connection): it may have been processed and billed.
      await this.settle(reservation, model, 'UNKNOWN', failure.kind, 0, 0, reservation.reservedUsd);
      throw new LlmError(failure.kind, `${message} (outcome unknown; worst-case cost kept)`);
    }

    // Price by the model that actually served the response.
    const servedModel = response.model || model;
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;
    const costUsd = this.cost(servedModel, inputTokens, outputTokens);
    if (costUsd > reservation.reservedUsd) {
      this.logger.warn(
        `${request.task} cost $${costUsd.toFixed(6)} exceeded its reservation $${reservation.reservedUsd.toFixed(6)}`,
      );
    }

    const failure = this.responseFailure(response);
    if (failure) {
      await this.settle(
        reservation,
        servedModel,
        'FAILED',
        failure.kind,
        inputTokens,
        outputTokens,
        costUsd,
      );
      throw new LlmError(failure.kind, failure.message);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      await this.settle(
        reservation,
        servedModel,
        'FAILED',
        'INVALID_OUTPUT',
        inputTokens,
        outputTokens,
        costUsd,
      );
      throw new LlmError('INVALID_OUTPUT', `${request.task} returned non-JSON output`);
    }

    await this.settle(
      reservation,
      servedModel,
      'SUCCEEDED',
      null,
      inputTokens,
      outputTokens,
      costUsd,
    );
    return { data, model: servedModel, inputTokens, outputTokens, costUsd };
  }

  /**
   * Atomically reserves the worst-case cost against today's (UTC, database clock) budget. All
   * reservers serialize on one advisory lock inside a short transaction, so the sum they check
   * includes every other in-flight reservation.
   */
  private async reserve(request: LlmJsonRequest, model: string): Promise<Reservation> {
    const worstCase = roundUsd(this.worstCaseCostUsd(request));
    const budget = this.config.llm.dailyBudgetUsd;
    const reservation = await this.usage.manager.transaction(
      async (manager): Promise<Reservation | { committed: number }> => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [LLM_BUDGET_LOCK_KEY]);
        const [{ committed }] = await manager.query<{ committed: string }[]>(
          `SELECT COALESCE(SUM(cost_usd), 0) AS committed FROM llm_usage
          WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
        );
        if (Number(committed) + worstCase > budget) return { committed: Number(committed) };
        const [row] = await manager.query<{ id: string }[]>(
          `INSERT INTO llm_usage (task, model, status, reserved_usd, cost_usd)
         VALUES ($1, $2, 'RESERVED', $3, $3) RETURNING id`,
          [request.task, model, worstCase],
        );
        return { id: row.id, reservedUsd: worstCase };
      },
    );
    if ('committed' in reservation) {
      this.logger.warn(
        `Daily LLM budget reached: committed $${reservation.committed.toFixed(4)} (incl. in-flight), next ${request.task} call may cost up to $${worstCase.toFixed(4)}, budget $${budget}`,
      );
      throw new LlmError('BUDGET_EXCEEDED', `Daily LLM budget of $${budget} would be exceeded`);
    }
    return reservation;
  }

  /** Replaces the reservation with the settled cost. If this write fails the worst case stays. */
  private async settle(
    reservation: Reservation,
    model: string,
    status: Exclude<LlmUsageStatus, 'RESERVED'>,
    errorKind: LlmErrorKind | null,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): Promise<void> {
    await this.usage.update(
      { id: reservation.id },
      {
        model,
        status,
        errorKind,
        inputTokens,
        outputTokens,
        costUsd: roundUsd(costUsd),
        settledAt: new Date(),
      },
    );
  }

  /** Spend recorded since 00:00 UTC of the given instant. */
  async spentToday(now = new Date()): Promise<number> {
    const raw = await this.usage
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.cost_usd), 0)', 'total')
      .where('u.created_at >= :from', { from: startOfUtcDay(now) })
      .getRawOne<{ total: string }>();
    return Number(raw?.total ?? 0);
  }

  async summarize(from: Date, to: Date): Promise<LlmUsageSummaryRow[]> {
    const rows = await this.usage
      .createQueryBuilder('u')
      .select('u.task', 'task')
      .addSelect('u.model', 'model')
      .addSelect('u.status', 'status')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(u.input_tokens)', 'inputTokens')
      .addSelect('SUM(u.output_tokens)', 'outputTokens')
      .addSelect('SUM(u.cost_usd)', 'costUsd')
      .where('u.created_at >= :from AND u.created_at < :to', { from, to })
      .groupBy('u.task')
      .addGroupBy('u.model')
      .addGroupBy('u.status')
      .orderBy('u.task')
      .getRawMany<Record<string, string>>();
    return rows.map((row) => ({
      task: row.task as LlmTask,
      model: row.model,
      status: row.status,
      calls: Number(row.calls),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      costUsd: Number(row.costUsd),
    }));
  }

  private responseFailure(
    response: Anthropic.Message,
  ): { kind: LlmErrorKind; message: string } | null {
    switch (response.stop_reason) {
      case 'refusal':
        return { kind: 'REFUSAL', message: 'Claude declined the request (stop_reason=refusal)' };
      case 'max_tokens':
        return { kind: 'TRUNCATED', message: 'Claude output hit max_tokens before completing' };
      default:
        return null;
    }
  }

  private price(model: string): ModelPrice {
    const price = this.config.llm.prices[model];
    if (!price) throw new LlmError('REQUEST_REJECTED', `No price configured for model ${model}`);
    return price;
  }

  private cost(model: string, inputTokens: number, outputTokens: number): number {
    const price = this.config.llm.prices[model] ?? this.price(this.config.llm.models.analysis);
    return (
      (inputTokens * price.inputPerMTokUsd + outputTokens * price.outputPerMTokUsd) / 1_000_000
    );
  }
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

interface ApiFailure {
  kind: LlmErrorKind;
  /** The provider returned an HTTP error status: the request was not processed or billed. */
  definitive: boolean;
  /** Safe to re-send right away (429 / 5xx / 529 responses). */
  transient: boolean;
  retryAfterMs: number | null;
}

function classifyApiError(error: unknown): ApiFailure {
  // Timeouts and dropped connections have no status: the request may have been processed.
  if (error instanceof Anthropic.APIConnectionError) {
    return { kind: 'UNAVAILABLE', definitive: false, transient: false, retryAfterMs: null };
  }
  if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
    const retryAfterMs = parseRetryAfter(error.headers as Headers | undefined);
    if (error.status === 429) {
      return { kind: 'RATE_LIMITED', definitive: true, transient: true, retryAfterMs };
    }
    if (error.status >= 500 || error.status === 408) {
      return { kind: 'UNAVAILABLE', definitive: true, transient: true, retryAfterMs };
    }
    return { kind: 'REQUEST_REJECTED', definitive: true, transient: false, retryAfterMs: null };
  }
  return { kind: 'UNAVAILABLE', definitive: false, transient: false, retryAfterMs: null };
}

function parseRetryAfter(headers: Headers | undefined): number | null {
  const value = headers?.get?.('retry-after');
  const seconds = value ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
