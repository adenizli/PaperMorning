import Anthropic from '@anthropic-ai/sdk';
import { INestApplication } from '@nestjs/common';
import { LlmService } from '../../src/service/llm/llm.service';
import { LlmError, LlmTask } from '../../src/service/llm/llm.types';
import { FakeAnthropic } from '../support/fake-anthropic';
import { createResearchApp } from '../support/research-app';

const request = (task = LlmTask.SCREENING) => ({
  task,
  system: 'sys',
  prompt: 'prompt',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  maxTokens: 100,
});

describe('LlmService (PostgreSQL ledger)', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('routes tasks to configured models, sends structured output config and records usage', async () => {
    const fake = new FakeAnthropic(() => ({
      data: { ok: true },
      inputTokens: 2000,
      outputTokens: 100,
    }));
    app = await createResearchApp({ anthropic: fake });
    const llm = app.get(LlmService);
    const result = await llm.generateJson({ ...request(), effort: 'low' });
    await llm.generateJson(request(LlmTask.PAPER_ANALYSIS));

    expect(fake.calls.map((c) => c.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(fake.calls[0].output_config).toEqual({
      format: { type: 'json_schema', schema: request().schema },
      effort: 'low',
    });
    expect(fake.calls[0]).not.toHaveProperty('tool_choice');
    expect(result).toMatchObject({ data: { ok: true }, model: 'claude-haiku-5-5' });
    expect(result.costUsd).toBeCloseTo((2000 * 0.1 + 100 * 0.5) / 1e6, 8);

    const now = new Date();
    const summary = await llm.summarize(
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() + 60_000),
    );
    expect(summary.map((r) => [r.task, r.model, r.calls])).toEqual([
      ['PAPER_ANALYSIS', 'claude-sonnet-5-5', 1],
      ['SCREENING', 'claude-haiku-5-5', 1],
    ]);
  });

  it('enforces the daily budget before calling Claude', async () => {
    const fake = new FakeAnthropic(() => ({ data: {} }));
    app = await createResearchApp({ anthropic: fake, env: { LLM_DAILY_BUDGET_USD: '0.00001' } });
    await expect(
      app.get(LlmService).generateJson(request(LlmTask.PAPER_ANALYSIS)),
    ).rejects.toMatchObject({ kind: 'BUDGET_EXCEEDED' });
    expect(fake.calls).toHaveLength(0);
  });

  it.each([
    ['refusal', { stopReason: 'refusal' as const, data: {} }, 'REFUSAL', false],
    ['truncation', { stopReason: 'max_tokens' as const, data: {} }, 'TRUNCATED', true],
    ['non-JSON output', { rawText: 'not json' }, 'INVALID_OUTPUT', true],
  ])(
    'classifies %s and records it as a failed, billed call',
    async (_label, response, kind, retryable) => {
      const fake = new FakeAnthropic(() => response);
      app = await createResearchApp({ anthropic: fake });
      const error = await app
        .get(LlmService)
        .generateJson(request())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({ kind, retryable });
      expect(await app.get(LlmService).spentToday()).toBeGreaterThan(0);
    },
  );

  it.each([
    [
      'rate limit',
      () => new Anthropic.RateLimitError(429, {}, 'slow down', new Headers()),
      'RATE_LIMITED',
    ],
    ['connection', () => new Anthropic.APIConnectionError({ message: 'reset' }), 'UNAVAILABLE'],
    [
      'bad request',
      () => new Anthropic.BadRequestError(400, {}, 'bad', new Headers()),
      'REQUEST_REJECTED',
    ],
  ])('maps SDK %s errors', async (_label, makeError, kind) => {
    const fake = new FakeAnthropic(() => {
      throw makeError();
    });
    app = await createResearchApp({ anthropic: fake });
    await expect(app.get(LlmService).generateJson(request())).rejects.toMatchObject({ kind });
  });

  it('fails explicitly when no API key is configured', async () => {
    app = await createResearchApp({ anthropic: null });
    expect(app.get(LlmService).isAvailable()).toBe(false);
    await expect(app.get(LlmService).generateJson(request())).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
  });
});
