import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContentCoverage } from '../../../src/common/enum/research.enum';
import { ABSTRACT_ONLY_LIMITATION } from '../../../src/domain/research/service/analysis-output.validator';
import { PaperVersionRepositoryService } from '../../../src/domain/research/repository/paper-version-repository.service';
import { PaperAnalysisService } from '../../../src/domain/research/service/paper-analysis.service';
import { ResearchDiscoveryService } from '../../../src/domain/research/service/research-discovery.service';
import { cannedAnalysis, FakeAnthropic } from '../../support/fake-anthropic';
import { createResearchApp, ResearchAppOptions } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

describe('PaperAnalysisService (PostgreSQL)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let analysis: PaperAnalysisService;
  let db: DataSource;
  let versionId: string;

  async function boot(options: ResearchAppOptions = {}) {
    app = await createResearchApp({ anthropic: fake, ...options });
    analysis = app.get(PaperAnalysisService);
    db = app.get(DataSource);
    versionId = (await app.get(ResearchDiscoveryService).storeRecord(academicRecord())).version.id;
  }

  beforeEach(() => {
    fake = new FakeAnthropic(() => ({ data: cannedAnalysis() }));
  });
  afterEach(() => app.close());

  it('analyzes once and lets two independent consumers reuse the stored analysis', async () => {
    await boot();
    const readerA = await analysis.analyze(versionId);
    const readerB = await analysis.analyze(versionId);
    expect(readerA).toMatchObject({ status: 'COMPLETED', reused: false });
    expect(readerB).toMatchObject({ status: 'COMPLETED', reused: true });
    expect(
      readerA.status === 'COMPLETED' &&
        readerB.status === 'COMPLETED' &&
        readerA.analysis.id === readerB.analysis.id,
    ).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].model).toBe('claude-sonnet-5-5');

    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'paper_analysis'`,
    );
    expect(columns.map((c: { column_name: string }) => c.column_name)).not.toContain('user_id');
  });

  it('allows only one billable claim under concurrency', async () => {
    fake.handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { data: cannedAnalysis() };
    };
    await boot();
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => analysis.analyze(versionId, { waitMs: 5000, pollMs: 50 })),
    );
    expect(fake.calls).toHaveLength(1);
    expect(outcomes.every((o) => o.status === 'COMPLETED')).toBe(true);
    expect(
      new Set(outcomes.map((o) => (o.status === 'COMPLETED' ? o.analysis.id : ''))),
    ).toHaveProperty('size', 1);
    expect((await db.query('SELECT count(*)::int AS n FROM paper_analysis'))[0].n).toBe(1);
  });

  it('labels abstract-only input honestly and keeps deterministic source links', async () => {
    await boot();
    const outcome = await analysis.analyze(versionId);
    if (outcome.status !== 'COMPLETED') throw new Error('expected completion');
    expect(outcome.analysis.coverage).toBe(ContentCoverage.ABSTRACT_ONLY);
    expect(outcome.analysis.content!.limitations[0]).toBe(ABSTRACT_ONLY_LIMITATION);
    expect(outcome.analysis.sourceReferences.map((r) => r.kind)).toEqual([
      'LANDING',
      'ARXIV',
      'PDF',
    ]);
    expect(fake.calls[0].messages[0].content).toContain('Available content: ABSTRACT ONLY');
    expect(outcome.analysis.inputTokens).toBe(1000);
    expect(outcome.analysis.costUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 6);
  });

  it('does not hold a database transaction open during the LLM call', async () => {
    let idleInTransaction = -1;
    fake.handler = async () => {
      idleInTransaction = Number(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
          )
        )[0].n,
      );
      return { data: cannedAnalysis() };
    };
    await boot();
    await analysis.analyze(versionId);
    expect(idleInTransaction).toBe(0);
  });

  it('rejects invented numbers as a retryable failure, then succeeds on retry', async () => {
    let call = 0;
    fake.handler = () => ({
      data:
        call++ === 0 ? cannedAnalysis({ summary: 'Improves accuracy by 87%.' }) : cannedAnalysis(),
    });
    await boot();
    const failed = await analysis.analyze(versionId);
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorKind: 'VALIDATION_FAILED',
      retryable: true,
    });
    const retried = await analysis.analyze(versionId);
    expect(retried).toMatchObject({ status: 'COMPLETED', reused: false });
    if (retried.status === 'COMPLETED') expect(retried.analysis.attemptCount).toBe(2);
  });

  it('does not retry non-retryable failures such as refusals', async () => {
    fake.handler = () => ({ data: {}, stopReason: 'refusal' });
    await boot();
    expect(await analysis.analyze(versionId)).toMatchObject({
      status: 'FAILED',
      errorKind: 'REFUSAL',
      retryable: false,
    });
    expect(await analysis.analyze(versionId)).toMatchObject({
      status: 'FAILED',
      errorKind: 'REFUSAL',
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('takes over an expired lease left by a crashed worker', async () => {
    fake.handler = () => ({ data: cannedAnalysis() });
    await boot();
    const version = await app.get(PaperVersionRepositoryService).findById(versionId);
    const fp = analysis.fingerprintFor(version!);
    await db.query(
      `INSERT INTO paper_analysis (fingerprint, paper_version_id, status, coverage, model, prompt_version, schema_version, attempt_count, lease_expires_at)
       VALUES ($1, $2, 'RUNNING', 'ABSTRACT_ONLY', 'claude-sonnet-5-5', 'analysis-v1', 1, 1, now() - interval '1 minute')`,
      [fp, versionId],
    );
    const outcome = await analysis.analyze(versionId);
    expect(outcome).toMatchObject({ status: 'COMPLETED', reused: false });
    if (outcome.status === 'COMPLETED') expect(outcome.analysis.attemptCount).toBe(2);
  });

  it('reports NOT_CONFIGURED without creating rows when no API key is configured', async () => {
    fake = null as unknown as FakeAnthropic;
    await boot({ anthropic: null });
    expect(await analysis.analyze(versionId)).toMatchObject({
      status: 'FAILED',
      errorKind: 'NOT_CONFIGURED',
    });
    expect((await db.query('SELECT count(*)::int AS n FROM paper_analysis'))[0].n).toBe(0);
  });

  it('creates a new analysis when the configured analysis model changes', async () => {
    await boot();
    await analysis.analyze(versionId);
    await app.close();
    app = await createResearchApp({
      anthropic: fake,
      keepData: true,
      env: {
        LLM_MODEL_ANALYSIS: 'claude-sonnet-test',
        LLM_PRICING_JSON: '{"claude-sonnet-test":{"inputPerMTokUsd":1,"outputPerMTokUsd":1}}',
      },
    });
    const outcome = await app.get(PaperAnalysisService).analyze(versionId);
    expect(outcome).toMatchObject({ status: 'COMPLETED', reused: false });
    expect(fake.calls.map((c) => c.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-test']);
  });
});
