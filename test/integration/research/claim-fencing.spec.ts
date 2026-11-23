import Anthropic from '@anthropic-ai/sdk';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClaimLostError } from '../../../src/common/persistence/claim-lost.error';
import { AnalysisStatus } from '../../../src/domain/research/model/paper-analysis.model';
import {
  ResearchRunStage,
  ResearchRunStatus,
} from '../../../src/domain/research/model/research-run.model';
import { PaperAnalysisRepositoryService } from '../../../src/domain/research/repository/paper-analysis-repository.service';
import { ResearchRunRepositoryService } from '../../../src/domain/research/repository/research-run-repository.service';
import { PaperAnalysisService } from '../../../src/domain/research/service/paper-analysis.service';
import { ResearchDiscoveryService } from '../../../src/domain/research/service/research-discovery.service';
import { ResearchService } from '../../../src/domain/research/service/research.service';
import { gate, waitUntil } from '../../support/concurrency';
import { cannedAnalysis, FakeAnthropic } from '../../support/fake-anthropic';
import { createResearchApp } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

/** Simulates "the lease ran out while the worker was stalled" without waiting for real time. */
async function expireLeases(db: DataSource, table: 'paper_analysis' | 'research_run') {
  await db.query(`UPDATE ${table} SET lease_expires_at = now() - interval '1 second'`);
}

describe('claim fencing (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  afterEach(() => app.close());

  describe('paper analysis', () => {
    let versionId: string;
    let analysis: PaperAnalysisService;

    async function boot(fake: FakeAnthropic) {
      app = await createResearchApp({ anthropic: fake });
      db = app.get(DataSource);
      analysis = app.get(PaperAnalysisService);
      versionId = (await app.get(ResearchDiscoveryService).storeRecord(academicRecord())).version
        .id;
    }

    /** Worker A's call is held; its lease expires; worker B takes over and is still running. */
    async function takeoverWhileBothInFlight(firstCall: () => Promise<unknown>) {
      const second = gate();
      let call = 0;
      const fake = new FakeAnthropic(async () => {
        call++;
        if (call === 1) {
          await firstCall();
          return { data: cannedAnalysis({ summary: 'Result of the stale worker.' }) };
        }
        await second.promise;
        return { data: cannedAnalysis({ summary: 'Result of the current owner.' }) };
      });
      await boot(fake);
      const workerA = analysis.analyze(versionId);
      await waitUntil(() => fake.calls.length === 1);
      await expireLeases(db, 'paper_analysis');
      const workerB = analysis.analyze(versionId);
      await waitUntil(() => fake.calls.length === 2);
      return { fake, workerA, workerB, releaseB: second.open };
    }

    it('rejects a late success from a worker whose claim was taken over', async () => {
      const first = gate();
      const { workerA, workerB, releaseB } = await takeoverWhileBothInFlight(() => first.promise);
      first.open();
      // A finishes while B still owns the claim: A's result must not be stored.
      await expect(workerA).resolves.toMatchObject({ status: 'IN_PROGRESS' });
      const [row] = await db.query('SELECT status, content FROM paper_analysis');
      expect(row).toMatchObject({ status: AnalysisStatus.RUNNING, content: null });

      releaseB();
      const outcome = await workerB;
      expect(outcome).toMatchObject({ status: 'COMPLETED', reused: false });
      const [stored] = await db.query('SELECT status, content, attempt_count FROM paper_analysis');
      expect(stored.status).toBe(AnalysisStatus.COMPLETED);
      expect(stored.content.summary).toBe('Result of the current owner.');
      expect(stored.attempt_count).toBe(2);
    });

    it('rejects a late failure from a worker whose claim was taken over', async () => {
      const first = gate();
      const { workerA, workerB, releaseB } = await takeoverWhileBothInFlight(async () => {
        await first.promise;
        throw new Anthropic.BadRequestError(400, {}, 'late rejection', new Headers());
      });
      first.open();
      await expect(workerA).resolves.toMatchObject({ status: 'IN_PROGRESS' });
      const [row] = await db.query('SELECT status, error_kind FROM paper_analysis');
      expect(row).toMatchObject({ status: AnalysisStatus.RUNNING, error_kind: null });

      releaseB();
      await expect(workerB).resolves.toMatchObject({ status: 'COMPLETED' });
      const [stored] = await db.query('SELECT status, content FROM paper_analysis');
      expect(stored.status).toBe(AnalysisStatus.COMPLETED);
      expect(stored.content.summary).toBe('Result of the current owner.');
    });

    it('sizes the lease to outlive the longest bounded Claude call', async () => {
      await boot(new FakeAnthropic(() => ({ data: cannedAnalysis() })));
      // 3 attempts x LLM_TIMEOUT_MS (180 s default) + back-off, plus margin.
      expect(analysis.leaseSeconds()).toBeGreaterThanOrEqual(3 * 180 + 40);
      const claim = await app.get(PaperAnalysisRepositoryService).claim({
        fingerprint: 'f'.repeat(64),
        paperVersionId: versionId,
        coverage: 'ABSTRACT_ONLY' as never,
        model: 'claude-sonnet-5-5',
        promptVersion: 'p',
        schemaVersion: 1,
        leaseSeconds: analysis.leaseSeconds(),
      });
      expect(claim.outcome).toBe('CLAIMED');
      const [{ seconds }] = await db.query(
        `SELECT extract(epoch FROM lease_expires_at - now())::int AS seconds FROM paper_analysis`,
      );
      expect(seconds).toBeGreaterThanOrEqual(analysis.leaseSeconds() - 5);
    });
  });

  describe('research run', () => {
    const runInput = {
      runKey: 'daily:robotics:2026-11-22',
      trigger: 'CLI',
      topicKey: 'robotics',
      windowFrom: '2026-11-15',
      windowUntil: '2026-11-22',
      leaseSeconds: 600,
    };

    it('fences checkpoint, complete, fail and renew of a stale owner after takeover', async () => {
      app = await createResearchApp({ anthropic: null });
      db = app.get(DataSource);
      const runs = app.get(ResearchRunRepositoryService);

      const a = await runs.claim(runInput);
      if (a.outcome !== 'CLAIMED') throw new Error('expected claim');
      await runs.checkpoint(a.run.id, a.claimToken, { stage: ResearchRunStage.SCREENING }, 600);

      await expireLeases(db, 'research_run');
      const b = await runs.claim(runInput);
      if (b.outcome !== 'CLAIMED') throw new Error('expected takeover');
      // Takeover resumes from the persisted checkpoint.
      expect(b.run).toMatchObject({ stage: ResearchRunStage.SCREENING, attemptCount: 2 });
      expect(b.claimToken).not.toBe(a.claimToken);

      await expect(
        runs.checkpoint(a.run.id, a.claimToken, { stage: ResearchRunStage.ANALYSIS }, 600),
      ).rejects.toBeInstanceOf(ClaimLostError);
      await expect(runs.complete(a.run.id, a.claimToken, b.run.counts, [])).rejects.toBeInstanceOf(
        ClaimLostError,
      );
      await expect(runs.fail(a.run.id, a.claimToken, ['stale'])).rejects.toBeInstanceOf(
        ClaimLostError,
      );
      expect(await runs.renew(a.run.id, a.claimToken, 600)).toBe(false);

      const current = await runs.findById(a.run.id);
      expect(current).toMatchObject({
        status: ResearchRunStatus.RUNNING,
        stage: ResearchRunStage.SCREENING,
        errors: [],
      });
      expect(await runs.renew(b.run.id, b.claimToken, 600)).toBe(true);
      const done = await runs.complete(b.run.id, b.claimToken, b.run.counts, []);
      expect(done.status).toBe(ResearchRunStatus.COMPLETED);
    });

    it('a worker that lost its run stops before paying for the next analysis', async () => {
      const records = [
        academicRecord(),
        academicRecord({
          sourceRecordId: '2611.00002v1',
          arxivId: '2611.00002',
          title: 'Legged robot locomotion',
          landingUrl: 'https://arxiv.org/abs/2611.00002v1',
        }),
      ];
      const first = gate();
      const fake = new FakeAnthropic(async () => {
        await first.promise;
        return { data: cannedAnalysis() };
      });
      app = await createResearchApp({
        anthropic: fake,
        sources: { search: jest.fn().mockResolvedValue({ records, failures: [] }) },
        env: { RESEARCH_HAIKU_SCREENING: 'false' },
      });
      db = app.get(DataSource);
      const runs = app.get(ResearchRunRepositoryService);

      const workerA = app.get(ResearchService).runTopic('robotics', {
        topicKeys: ['robotics'],
        runDate: '2026-11-22',
        trigger: 'CLI',
        maxCandidatesPerTopic: 2,
      });
      await waitUntil(() => fake.calls.length === 1);
      // A stalls in its first analysis; meanwhile its run lease expires and B takes the run over.
      await expireLeases(db, 'research_run');
      const takeover = await runs.claim(runInput);
      expect(takeover.outcome).toBe('CLAIMED');

      first.open();
      const result = await workerA;
      // A's heartbeat failed: it neither paid for the second paper nor touched B's run.
      expect(fake.calls).toHaveLength(1);
      expect(result).toMatchObject({ status: ResearchRunStatus.RUNNING, attemptCount: 2 });
      const [row] = await db.query('SELECT status, completed_at FROM research_run');
      expect(row).toMatchObject({ status: 'RUNNING', completed_at: null });
    });
  });
});
