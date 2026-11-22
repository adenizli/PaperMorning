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
  LlmUsageSummaryRow,
} from './llm.types';

export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/**
 * Claude transport with fixed, auditable task -> model routing (Haiku for screening, Sonnet for
 * analysis/writing/outlook, Opus only when explicitly enabled by config). Enforces the operator's
 * daily budget before every call and records every call in the usage ledger.
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

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    if (!this.client) {
      throw new LlmError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not configured');
    }
    const model = this.modelFor(request.task);
    await this.assertWithinBudget(model, request);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          format: { type: 'json_schema', schema: request.schema },
          ...(request.effort ? { effort: request.effort } : {}),
        },
      });
    } catch (error) {
      const kind = classifyApiError(error);
      await this.record(request.task, model, 'FAILED', kind, 0, 0);
      throw new LlmError(kind, `Claude call for ${request.task} failed: ${errorMessage(error)}`);
    }

    // Price by the model that actually served the response.
    const servedModel = response.model || model;
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;
    const costUsd = this.cost(servedModel, inputTokens, outputTokens);

    const failure = this.responseFailure(response);
    if (failure) {
      await this.record(
        request.task,
        servedModel,
        'FAILED',
        failure.kind,
        inputTokens,
        outputTokens,
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
      await this.record(
        request.task,
        servedModel,
        'FAILED',
        'INVALID_OUTPUT',
        inputTokens,
        outputTokens,
      );
      throw new LlmError('INVALID_OUTPUT', `${request.task} returned non-JSON output`);
    }

    await this.record(request.task, servedModel, 'SUCCEEDED', null, inputTokens, outputTokens);
    return { data, model: servedModel, inputTokens, outputTokens, costUsd };
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

  private async assertWithinBudget(model: string, request: LlmJsonRequest): Promise<void> {
    const price = this.price(model);
    const approxInputTokens = Math.ceil((request.system.length + request.prompt.length) / 3);
    const worstCase =
      (approxInputTokens * price.inputPerMTokUsd + request.maxTokens * price.outputPerMTokUsd) /
      1_000_000;
    const spent = await this.spentToday();
    if (spent + worstCase > this.config.llm.dailyBudgetUsd) {
      this.logger.warn(
        `Daily LLM budget reached: spent $${spent.toFixed(4)}, next ${request.task} call may cost up to $${worstCase.toFixed(4)}, budget $${this.config.llm.dailyBudgetUsd}`,
      );
      throw new LlmError(
        'BUDGET_EXCEEDED',
        `Daily LLM budget of $${this.config.llm.dailyBudgetUsd} would be exceeded`,
      );
    }
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

  private async record(
    task: LlmTask,
    model: string,
    status: 'SUCCEEDED' | 'FAILED',
    errorKind: LlmErrorKind | null,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await this.usage.insert({
      task,
      model,
      status,
      errorKind,
      inputTokens,
      outputTokens,
      costUsd: this.cost(model, inputTokens, outputTokens),
    });
  }
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function classifyApiError(error: unknown): LlmErrorKind {
  if (error instanceof Anthropic.RateLimitError) return 'RATE_LIMITED';
  if (error instanceof Anthropic.APIConnectionError) return 'UNAVAILABLE';
  if (error instanceof Anthropic.InternalServerError) return 'UNAVAILABLE';
  if (error instanceof Anthropic.APIError) {
    return error.status === 529 || error.status === 408 ? 'UNAVAILABLE' : 'REQUEST_REJECTED';
  }
  return 'UNAVAILABLE';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
