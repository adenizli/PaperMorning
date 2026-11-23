import Anthropic from '@anthropic-ai/sdk';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmService } from '../../src/service/llm/llm.service';
import { LlmError, LlmTask } from '../../src/service/llm/llm.types';
import { gate, waitUntil } from '../support/concurrency';
import { FakeAnthropic } from '../support/fake-anthropic';
import { createResearchApp } from '../support/research-app';

const request = {
  task: LlmTask.PAPER_ANALYSIS,
  system: 'sys',
  prompt: 'prompt',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  maxTokens: 4000,
};

interface LedgerRow {
  status: string;
  cost_usd: string;
  reserved_usd: string;
  settled_at: Date | null;
}

describe('LlmService budget reservations (PostgreSQL)', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  async function ledger(): Promise<LedgerRow[]> {
    return app
      .get(DataSource)
      .query(
        'SELECT status, cost_usd, reserved_usd, settled_at FROM llm_usage ORDER BY created_at',
      );
  }

  /** Worst case of one request, computed by the service itself (config-independent). */
  async function worstCase(): Promise<number> {
    const probe = await createResearchApp({ anthropic: new FakeAnthropic(() => ({ data: {} })) });
    const value = probe.get(LlmService).worstCaseCostUsd(request);
    await probe.close();
    return value;
  }

  it('lets concurrent callers reserve at most the daily budget, counting in-flight calls', async () => {
    const perCall = await worstCase();
    const release = gate();
    const fake = new FakeAnthropic(async () => {
      await release.promise;
      return { data: { ok: true }, inputTokens: 10, outputTokens: 10 };
    });
    // Room for exactly three worst-case reservations.
    app = await createResearchApp({
      anthropic: fake,
      env: { LLM_DAILY_BUDGET_USD: String(perCall * 3.5) },
    });
    const llm = app.get(LlmService);

    const results = Array.from({ length: 10 }, () =>
      llm.generateJson(request).then(
        () => 'OK',
        (error: unknown) => (error instanceof LlmError ? error.kind : 'OTHER'),
      ),
    );
    // Every caller has either reserved (and is now blocked inside the provider call) or been refused.
    await waitUntil(() => fake.calls.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.calls).toHaveLength(3);
    const inFlight = await ledger();
    expect(inFlight.filter((row) => row.status === 'RESERVED')).toHaveLength(3);
    expect(await llm.spentToday()).toBeCloseTo(perCall * 3, 5);

    release.open();
    const outcomes = await Promise.all(results);
    expect(outcomes.filter((o) => o === 'OK')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'BUDGET_EXCEEDED')).toHaveLength(7);

    // Settled to the reported usage; the worst case stays visible for audit.
    const settled = await ledger();
    expect(settled.map((row) => row.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    for (const row of settled) {
      expect(Number(row.cost_usd)).toBeCloseTo((10 * 2 + 10 * 10) / 1e6, 8);
      expect(Number(row.reserved_usd)).toBeCloseTo(perCall, 6);
      expect(row.settled_at).not.toBeNull();
    }
    expect(await llm.spentToday()).toBeLessThanOrEqual(perCall * 3.5);
  });

  it('keeps the worst case charged when the outcome is unknown (timeout / dropped connection)', async () => {
    const fake = new FakeAnthropic(() => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    app = await createResearchApp({ anthropic: fake });
    const llm = app.get(LlmService);
    await expect(llm.generateJson(request)).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    // Uncertain outcomes are never re-sent automatically (it may already have been billed).
    expect(fake.calls).toHaveLength(1);
    const [row] = await ledger();
    expect(row.status).toBe('UNKNOWN');
    expect(Number(row.cost_usd)).toBeGreaterThan(0);
    expect(Number(row.cost_usd)).toBe(Number(row.reserved_usd));
  });

  it('releases the reservation for a definitive, unbilled error response', async () => {
    const fake = new FakeAnthropic(() => {
      throw new Anthropic.BadRequestError(400, {}, 'bad', new Headers());
    });
    app = await createResearchApp({ anthropic: fake });
    await expect(app.get(LlmService).generateJson(request)).rejects.toMatchObject({
      kind: 'REQUEST_REJECTED',
    });
    const [row] = await ledger();
    expect(row).toMatchObject({ status: 'FAILED' });
    expect(Number(row.cost_usd)).toBe(0);
    expect(Number(row.reserved_usd)).toBeGreaterThan(0);
  });

  it('re-sends after an overloaded response with a fresh reservation per request', async () => {
    let calls = 0;
    const fake = new FakeAnthropic(() => {
      if (++calls === 1) {
        throw Anthropic.APIError.generate(
          529,
          {},
          'overloaded',
          new Headers({ 'retry-after': '0' }),
        );
      }
      return { data: { ok: true } };
    });
    app = await createResearchApp({ anthropic: fake });
    await expect(app.get(LlmService).generateJson(request)).resolves.toMatchObject({
      data: { ok: true },
    });
    expect(fake.calls).toHaveLength(2);
    expect((await ledger()).map((row) => row.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('a reservation left behind by a crashed call keeps counting against the budget', async () => {
    const perCall = await worstCase();
    const never = gate();
    const fake = new FakeAnthropic(async () => {
      await never.promise;
      return { data: {} };
    });
    app = await createResearchApp({
      anthropic: fake,
      env: { LLM_DAILY_BUDGET_USD: String(perCall * 1.5) },
    });
    const llm = app.get(LlmService);
    const stuck = llm.generateJson(request).catch(() => undefined);
    await waitUntil(() => fake.calls.length === 1);
    // The first call has not settled (as if the process died mid-call): a second one is refused.
    await expect(llm.generateJson(request)).rejects.toMatchObject({ kind: 'BUDGET_EXCEEDED' });
    expect(fake.calls).toHaveLength(1);
    expect((await ledger()).map((row) => row.status)).toEqual(['RESERVED']);
    never.open();
    await stuck;
  });
});
