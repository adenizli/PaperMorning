import Anthropic from '@anthropic-ai/sdk';
import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { ClaimLostError } from '../../../src/common/persistence/claim-lost.error';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { ResearchQueryService } from '../../../src/domain/research';
import type { IssueContentModel } from '../../../src/domain/publication/model/issue-content.model';
import { PublicationStage } from '../../../src/domain/publication/model/publication-run.model';
import { OutlookGenerationRepositoryService } from '../../../src/domain/publication/repository/outlook-generation-repository.service';
import { PublicationRunRepositoryService } from '../../../src/domain/publication/repository/publication-run-repository.service';
import { ArticleWritingService } from '../../../src/domain/publication/service/article-writing.service';
import { IssueService } from '../../../src/domain/publication/service/issue.service';
import { OutlookService } from '../../../src/domain/publication/service/outlook.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import type { PdfRenderer } from '../../../src/service/pdf/pdf-renderer';
import { gate, waitUntil } from '../../support/concurrency';
import { FakeAnthropic } from '../../support/fake-anthropic';
import {
  FakeMailTransport,
  FakePdfRenderer,
  InMemoryFileStorage,
} from '../../support/fake-integrations';
import {
  cannedArticle,
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  TaskName,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

const DATE = '2026-11-22';
const { HIGH } = TopicPriority;
const { BEGINNER, ADVANCED } = KnowledgeLevel;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Renders distinct bytes per call (like real Chromium output may differ) and can be held. */
class ControllableRenderer implements PdfRenderer {
  calls = 0;
  hold: Promise<void> | null = null;

  async render(content: IssueContentModel): Promise<Buffer> {
    const n = ++this.calls;
    const hold = this.hold;
    if (hold) await hold;
    return Buffer.from(`%PDF-1.4\n% render ${n} ${content.issueDate}\n%%EOF\n`, 'latin1');
  }
}

describe('Publication concurrency (PostgreSQL)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let storage: InMemoryFileStorage;
  let db: DataSource;
  /** Optional async hook per task, evaluated before the canned answer. */
  let hooks: Partial<Record<TaskName, (n: number) => Promise<void>>>;
  const counts: Record<string, number> = {};
  const calls = (task: TaskName) => fake.calls.filter((c) => taskOf(c) === task).length;

  async function boot(renderer: PdfRenderer = new FakePdfRenderer()) {
    hooks = {};
    for (const key of Object.keys(counts)) delete counts[key];
    const canned = routingHandler();
    fake = new FakeAnthropic(async (params) => {
      const task = taskOf(params);
      counts[task] = (counts[task] ?? 0) + 1;
      await hooks[task]?.(counts[task]);
      return canned(params);
    });
    storage = new InMemoryFileStorage();
    app = await createResearchApp({
      anthropic: fake,
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      pdf: renderer,
      storage,
      mail: new FakeMailTransport(),
      env: { RESEARCH_HAIKU_SCREENING: 'false' },
    });
    db = app.get(DataSource);
  }
  afterEach(() => app.close());

  async function reader(name: string, level = BEGINNER) {
    return createReader(app, name, [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: level },
    ]);
  }

  async function expire(table: string, column = 'lease_expires_at') {
    await db.query(`UPDATE ${table} SET ${column} = now() - interval '1 second'`);
  }

  describe('publication run fencing', () => {
    it('rejects checkpoint, complete and fail from a worker whose run was taken over', async () => {
      await boot();
      const userId = await reader('reader_a');
      const runs = app.get(PublicationRunRepositoryService);
      const a = await runs.claim(userId, DATE, 900, 3);
      if (a.outcome !== 'CLAIMED') throw new Error('expected claim');
      await runs.checkpoint(a.run.id, a.claimToken, PublicationStage.WRITING, {}, 900);

      await expire('publication_run');
      const b = await runs.claim(userId, DATE, 900, 3);
      if (b.outcome !== 'CLAIMED') throw new Error('expected takeover');
      expect(b.run).toMatchObject({ stage: PublicationStage.WRITING, attemptCount: 2 });

      await expect(
        runs.checkpoint(a.run.id, a.claimToken, PublicationStage.RENDERING, {}, 900),
      ).rejects.toBeInstanceOf(ClaimLostError);
      await expect(runs.complete(a.run.id, a.claimToken, a.run.id)).rejects.toBeInstanceOf(
        ClaimLostError,
      );
      await expect(
        runs.fail(a.run.id, a.claimToken, {
          kind: 'X',
          message: 'stale',
          retryable: false,
          nextAttemptAt: null,
        }),
      ).rejects.toBeInstanceOf(ClaimLostError);
      expect(await runs.renew(a.run.id, a.claimToken, 900)).toBe(false);
      expect(await runs.findById(a.run.id)).toMatchObject({
        status: 'RUNNING',
        stage: PublicationStage.WRITING,
        errorKind: null,
      });
    });

    it('a stale preparation stops at its next step and never pays for the outlook', async () => {
      await boot();
      for (let i = 0; i < 2; i++) await seedAnalyzedPaper(app, 'robotics');
      const userId = await reader('reader_a');
      const held = gate();
      hooks.ARTICLE = (n) => (n === 1 ? held.promise : Promise.resolve());

      const stale = app.get(PublicationService).prepareIssue(userId, DATE);
      await waitUntil(() => calls('ARTICLE') === 1);
      await expire('publication_run');
      const takeover = await app.get(PublicationRunRepositoryService).claim(userId, DATE, 900, 3);
      expect(takeover.outcome).toBe('CLAIMED');

      held.open();
      await expect(stale).resolves.toMatchObject({ outcome: 'IN_PROGRESS' });
      expect(calls('ARTICLE')).toBe(1);
      expect(calls('OUTLOOK')).toBe(0);
      expect((await db.query('SELECT count(*)::int AS n FROM issue'))[0].n).toBe(0);
      const [run] = await db.query('SELECT status, attempt_count FROM publication_run');
      expect(run).toMatchObject({ status: 'RUNNING', attempt_count: 2 });
    });
  });

  describe('article variant fencing', () => {
    async function viewForWriting() {
      const paper = await seedAnalyzedPaper(app, 'robotics');
      const [view] = await app
        .get(ResearchQueryService)
        .getByAnalysisIds([paper.analysisId], ['robotics']);
      return view;
    }

    it.each([
      ['late success', undefined],
      ['late failure', new Anthropic.BadRequestError(400, {}, 'late', new Headers())],
    ])('rejects a %s from a writer whose claim was taken over', async (_label, lateError) => {
      await boot();
      const view = await viewForWriting();
      const first = gate();
      const second = gate();
      hooks.ARTICLE = async (n) => {
        await (n === 1 ? first.promise : second.promise);
        if (n === 1 && lateError) throw lateError;
      };
      const writer = app.get(ArticleWritingService);
      const stale = writer.getOrWrite(view, 'tr', BEGINNER, { waitMs: 0 });
      await waitUntil(() => calls('ARTICLE') === 1);
      await expire('article_variant');
      const current = writer.getOrWrite(view, 'tr', BEGINNER);
      await waitUntil(() => calls('ARTICLE') === 2);

      first.open();
      // The stale writer's result (or failure) is discarded while the new owner still runs.
      await expect(stale).rejects.toMatchObject({ kind: 'IN_PROGRESS' });
      const [row] = await db.query('SELECT status, content, error_kind FROM article_variant');
      expect(row).toMatchObject({ status: 'RUNNING', content: null, error_kind: null });

      second.open();
      await expect(current).resolves.toMatchObject({ status: 'COMPLETED' });
      const [done] = await db.query('SELECT status, content, attempt_count FROM article_variant');
      expect(done).toMatchObject({ status: 'COMPLETED', attempt_count: 2 });
      expect(done.content.headline).toBe(cannedArticle().headline);
    });
  });

  describe('immutable PDF publication', () => {
    /** A complete, valid snapshot produced by the real pipeline (frozen for another date). */
    async function snapshot(): Promise<{ userId: string; content: IssueContentModel }> {
      for (let i = 0; i < 2; i++) await seedAnalyzedPaper(app, 'robotics');
      const userId = await reader('reader_a');
      const result = await app.get(PublicationService).prepareIssue(userId, DATE);
      if (result.outcome !== 'READY') throw new Error(`setup failed: ${result.reason}`);
      return { userId, content: { ...result.issue!.content, issueDate: '2026-11-23' } };
    }
    const publish = (userId: string, content: IssueContentModel, waitMs = 10_000) =>
      app
        .get(IssueService)
        .publish(
          { userId, issueDate: '2026-11-23', timezone: 'Europe/Istanbul', content },
          { waitMs, pollMs: 20 },
        );

    it('renders once for concurrent publishers and all observe the same verified PDF', async () => {
      const renderer = new ControllableRenderer();
      await boot(renderer);
      const { userId, content } = await snapshot();
      const before = renderer.calls;
      const held = gate();
      renderer.hold = held.promise;

      const publishers = Array.from({ length: 4 }, () => publish(userId, content));
      await waitUntil(() => renderer.calls === before + 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      held.open();
      const issues = await Promise.all(publishers);

      expect(renderer.calls).toBe(before + 1);
      expect(new Set(issues.map((i) => `${i.id}:${i.pdfSha256}:${i.status}`)).size).toBe(1);
      const bytes = await app.get(IssueService).readVerifiedPdf(issues[0]);
      expect(sha(bytes)).toBe(issues[0].pdfSha256);
    });

    it('a stale renderer cannot replace the PDF of an issue published after a takeover', async () => {
      const renderer = new ControllableRenderer();
      await boot(renderer);
      const { userId, content } = await snapshot();
      const held = gate();
      renderer.hold = held.promise;

      const stale = publish(userId, content);
      await waitUntil(async () => {
        const [row] = await db.query(
          `SELECT render_token FROM issue WHERE issue_date = '2026-11-23'`,
        );
        return Boolean(row?.render_token);
      });
      // The first renderer stalls past its lease; a second worker takes over and publishes.
      await expire('issue', 'render_lease_expires_at');
      renderer.hold = null;
      const published = await publish(userId, content);
      expect(published.status).toBe('READY');

      held.open();
      const staleResult = await stale;
      expect(staleResult).toMatchObject({ id: published.id, pdfSha256: published.pdfSha256 });

      // The READY issue still points at intact bytes; the stale render went to another key.
      const [row] = await db.query(`SELECT pdf_storage_key, pdf_sha256 FROM issue WHERE id = $1`, [
        published.id,
      ]);
      expect(row.pdf_sha256).toBe(published.pdfSha256);
      const bytes = await app.get(IssueService).readVerifiedPdf(published);
      expect(sha(bytes)).toBe(published.pdfSha256);
      const keys = [...storage.files.keys()].filter((k) => k.includes(published.id));
      expect(keys).toHaveLength(2);
      for (const key of keys)
        expect(key).toBe(`issues/${userId}/${published.id}-${sha(storage.files.get(key)!)}.pdf`);
    });

    it('reuses a stored, verified PDF after a crash between storage and READY', async () => {
      const renderer = new ControllableRenderer();
      await boot(renderer);
      const { userId, content } = await snapshot();
      const issueService = app.get(IssueService);

      // Crash simulation: the PDF was stored and staged, then the process died before READY.
      const bytes = Buffer.from('%PDF-1.4\n% staged before crash\n%%EOF\n', 'latin1');
      const crashedDate = '2026-11-24';
      await db.query(
        `INSERT INTO issue (user_id, issue_date, timezone, language, status, content, content_hash)
         SELECT user_id, $1, timezone, language, 'FROZEN', content, content_hash FROM issue
          WHERE issue_date = $2`,
        [crashedDate, DATE],
      );
      const [crashed] = await db.query(`SELECT id FROM issue WHERE issue_date = $1`, [crashedDate]);
      const key = `issues/${userId}/${crashed.id}-${sha(bytes)}.pdf`;
      await storage.write(key, bytes);
      await db.query(
        `UPDATE issue SET pdf_storage_key = $2, pdf_sha256 = $3, pdf_size_bytes = $4,
                          render_token = gen_random_uuid(),
                          render_lease_expires_at = now() - interval '1 second'
          WHERE id = $1`,
        [crashed.id, key, sha(bytes), bytes.length],
      );

      const calls = renderer.calls;
      const ready = await issueService.publish({
        userId,
        issueDate: crashedDate,
        timezone: 'Europe/Istanbul',
        content,
      });
      expect(ready).toMatchObject({ status: 'READY', pdfSha256: sha(bytes), pdfStorageKey: key });
      expect(renderer.calls).toBe(calls); // reused, not rendered again

      // A staged file that no longer verifies is never published: it is rendered again.
      const brokenDate = '2026-11-25';
      await db.query(
        `INSERT INTO issue (user_id, issue_date, timezone, language, status, content, content_hash,
                            pdf_storage_key, pdf_sha256, pdf_size_bytes)
         SELECT user_id, $1, timezone, language, 'FROZEN', content, content_hash,
                'issues/x/missing.pdf', repeat('0', 64), 10 FROM issue
          WHERE issue_date = $2`,
        [brokenDate, DATE],
      );
      const rerendered = await issueService.publish({
        userId,
        issueDate: brokenDate,
        timezone: 'Europe/Istanbul',
        content,
      });
      expect(rerendered.status).toBe('READY');
      expect(rerendered.pdfSha256).not.toBe('0'.repeat(64));
      expect(renderer.calls).toBe(calls + 1);
    });
  });

  describe('shared Ufuk Raporu generation', () => {
    async function outlookPapers() {
      const ids = [];
      for (let i = 0; i < 2; i++) ids.push((await seedAnalyzedPaper(app, 'robotics')).analysisId);
      const views = await app.get(ResearchQueryService).getByAnalysisIds(ids, ['robotics']);
      return views.map((view, index) => ({ paperKey: `P${index + 1}`, view }));
    }

    it('lets parallel consumers share one paid generation', async () => {
      await boot();
      const papers = await outlookPapers();
      const held = gate();
      hooks.OUTLOOK = () => held.promise;
      const outlook = app.get(OutlookService);
      const consumers = Array.from({ length: 4 }, () =>
        outlook.getOrCreate(papers, 'tr', BEGINNER, { waitMs: 10_000, pollMs: 20 }),
      );
      await waitUntil(() => calls('OUTLOOK') === 1);
      await new Promise((resolve) => setTimeout(resolve, 100));
      held.open();
      const reports = await Promise.all(consumers);
      expect(calls('OUTLOOK')).toBe(1);
      expect(new Set(reports.map((r) => JSON.stringify(r))).size).toBe(1);

      // Different knowledge level => different fingerprint => never reused.
      await outlook.getOrCreate(papers, 'tr', ADVANCED);
      expect(calls('OUTLOOK')).toBe(2);
      expect((await db.query(`SELECT count(*)::int AS n FROM outlook_generation`))[0].n).toBe(2);
    });

    it('recovers an interrupted generation and fences the stale worker', async () => {
      await boot();
      const papers = await outlookPapers();
      const outlook = app.get(OutlookService);
      const repo = app.get(OutlookGenerationRepositoryService);
      const fp = outlook.fingerprintFor(papers, 'tr', BEGINNER);

      // A worker claimed the generation and then crashed (lease runs out).
      const crashed = await repo.claim({
        fingerprint: fp,
        model: 'claude-sonnet-5-5',
        promptVersion: 'x',
        leaseSeconds: 600,
      });
      if (crashed.outcome !== 'CLAIMED') throw new Error('expected claim');
      await expire('outlook_generation');

      const report = await outlook.getOrCreate(papers, 'tr', BEGINNER);
      expect(report.fingerprint).toBe(fp);
      expect(calls('OUTLOOK')).toBe(1);
      // The crashed worker coming back cannot overwrite the recovered result.
      await expect(
        repo.complete(crashed.record.id, crashed.claimToken, { ...report, teaser: 'stale' }),
      ).rejects.toBeInstanceOf(ClaimLostError);
      expect(
        await repo.fail(crashed.record.id, crashed.claimToken, {
          kind: 'X',
          message: 'stale',
          retryable: true,
        }),
      ).toBe(false);
      expect((await repo.findByFingerprint(fp))!.report!.teaser).toBe(report.teaser);
    });

    it('keeps a finished report reusable when the publication that paid for it fails', async () => {
      await boot(Object.assign(new FakePdfRenderer(), { failNext: 1 }));
      for (let i = 0; i < 2; i++) await seedAnalyzedPaper(app, 'robotics');
      const a = await reader('reader_a');
      const b = await reader('reader_b');
      const failed = await app.get(PublicationService).prepareIssue(a, DATE);
      expect(failed).toMatchObject({ outcome: 'FAILED' });
      expect(calls('OUTLOOK')).toBe(1);
      const [stored] = await db.query(`SELECT status FROM outlook_generation`);
      expect(stored.status).toBe('COMPLETED');

      // Another reader with the same research package and level reuses it: no second Sonnet call.
      const ready = await app.get(PublicationService).prepareIssue(b, DATE);
      expect(ready.outcome).toBe('READY');
      expect(calls('OUTLOOK')).toBe(1);
    });
  });
});
