import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { IssueService } from '../../../src/domain/publication/service/issue.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import { FakeAnthropic } from '../../support/fake-anthropic';
import {
  FakeMailTransport,
  FakePdfRenderer,
  InMemoryFileStorage,
} from '../../support/fake-integrations';
import {
  cannedArticle,
  cannedOutlook,
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

const DATE = '2026-11-22';
const { HIGH, LOW } = TopicPriority;
const { BEGINNER, ADVANCED } = KnowledgeLevel;

describe('PublicationService (PostgreSQL)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let pdf: FakePdfRenderer;
  let storage: InMemoryFileStorage;
  let db: DataSource;
  const sources = { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) };
  const calls = (task: string) => fake.calls.filter((c) => taskOf(c) === task).length;

  async function boot(keepData = false) {
    app = await createResearchApp({
      anthropic: fake,
      sources,
      pdf,
      storage,
      mail: new FakeMailTransport(),
      keepData,
      env: { RESEARCH_HAIKU_SCREENING: 'false' },
    });
    db = app.get(DataSource);
  }

  beforeEach(async () => {
    fake = new FakeAnthropic(routingHandler());
    pdf = new FakePdfRenderer();
    storage = new InMemoryFileStorage();
    await boot();
  });
  afterEach(() => app.close());

  async function seedPapers() {
    const robotics = [];
    for (let i = 0; i < 3; i++) robotics.push(await seedAnalyzedPaper(app, 'robotics'));
    const quantum = [];
    for (let i = 0; i < 2; i++) quantum.push(await seedAnalyzedPaper(app, 'quantum-physics'));
    return { robotics, quantum };
  }

  it('prepares different personal issues while reusing shared analyses and variants', async () => {
    const { quantum } = await seedPapers();
    const analysesBefore = calls('ANALYSIS');
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
      { topicKey: 'quantum-physics', priority: LOW, knowledgeLevel: ADVANCED },
    ]);
    const b = await createReader(app, 'reader_b', [
      { topicKey: 'quantum-physics', priority: HIGH, knowledgeLevel: ADVANCED },
    ]);

    const issueA = await app.get(PublicationService).prepareIssue(a, DATE);
    const writesAfterA = calls('ARTICLE');
    const issueB = await app.get(PublicationService).prepareIssue(b, DATE);

    expect(issueA.outcome).toBe('READY');
    expect(issueB.outcome).toBe('READY');
    const contentA = issueA.issue!.content;
    const contentB = issueB.issue!.content;
    expect(contentA.articles[0].topicKey).toBe('robotics');
    expect(contentB.articles.map((x) => x.topicKey)).toEqual([
      'quantum-physics',
      'quantum-physics',
    ]);
    expect(contentA.articles.find((x) => x.topicKey === 'quantum-physics')!.knowledgeLevel).toBe(
      ADVANCED,
    );

    // Science is never re-analyzed per reader; B's quantum/ADVANCED variants were already written for A.
    expect(calls('ANALYSIS')).toBe(analysesBefore);
    expect(writesAfterA).toBe(5); // 3 robotics BEGINNER + 2 quantum ADVANCED (remaining slots)
    expect(calls('ARTICLE')).toBe(5); // B (quantum/ADVANCED) reused both variants: zero new writes
    const sharedVariant = contentA.articles.find((x) => x.topicKey === 'quantum-physics')!
      .provenance.variantId;
    expect(contentB.articles.map((x) => x.provenance.variantId)).toContain(sharedVariant);
    const variantsA = new Set(contentA.articles.map((x) => x.provenance.variantId));
    expect(contentB.articles.every((x) => variantsA.has(x.provenance.variantId))).toBe(true);
    expect(contentA.articles.map((x) => x.topicKey)).toEqual([
      'robotics',
      'robotics',
      'robotics',
      'quantum-physics',
      'quantum-physics',
    ]);
    expect((await db.query('SELECT count(*)::int AS n FROM paper_analysis'))[0].n).toBe(5);
    const columns = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'article_variant'`,
    );
    expect(columns.map((c: { column_name: string }) => c.column_name)).not.toContain('user_id');
    expect(quantum.map((q) => q.analysisId)).toContain(contentB.articles[0].provenance.analysisId);
  });

  it('creates separate variants for a different knowledge level without touching the science', async () => {
    await seedPapers();
    const a = await createReader(app, 'adv', [
      { topicKey: 'quantum-physics', priority: HIGH, knowledgeLevel: ADVANCED },
    ]);
    const c = await createReader(app, 'beg', [
      { topicKey: 'quantum-physics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    await app.get(PublicationService).prepareIssue(a, DATE);
    await app.get(PublicationService).prepareIssue(c, DATE);
    const levels = await db.query(
      `SELECT knowledge_level, count(*)::int AS n FROM article_variant GROUP BY 1 ORDER BY 1`,
    );
    expect(levels).toEqual([
      { knowledge_level: 'ADVANCED', n: 2 },
      { knowledge_level: 'BEGINNER', n: 2 },
    ]);
    expect((await db.query('SELECT count(*)::int AS n FROM paper_analysis'))[0].n).toBe(5);
    const prompts = fake.calls
      .filter((x) => taskOf(x) === 'ARTICLE')
      .map((x) => JSON.stringify(x.messages));
    expect(prompts.filter((p) => p.includes('Okur düzeyi: BEGINNER'))).toHaveLength(2);
  });

  it('freezes a source-backed snapshot with the Ufuk Raporu last, and renders the PDF from it', async () => {
    await seedPapers();
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const { issue } = await app.get(PublicationService).prepareIssue(a, DATE);
    const content = issue!.content;

    expect(content.toc.at(-1)).toEqual({
      key: 'outlook',
      title: content.outlook.title,
      kind: 'OUTLOOK',
    });
    expect(
      content.articles.every((x) =>
        x.source.references.some((r) => r.url.startsWith('https://arxiv.org/abs/')),
      ),
    ).toBe(true);
    expect(
      content.articles.every(
        (x) => x.source.coverage === 'ABSTRACT_ONLY' && x.source.publicationStatus === 'PREPRINT',
      ),
    ).toBe(true);
    expect(content.editorialNotes.join(' ')).toMatch(/yalnızca makale özetlerine/);
    expect(content.editorialNotes.join(' ')).toMatch(/hakem değerlendirmesinden geçmemiştir/);
    expect(content.outlook.evidence.length).toBeGreaterThan(0);
    expect(content.outlook.inferences.length).toBeGreaterThan(0);
    expect(content.outlook.academicOpportunities[0].paperKeys).toEqual(['P1']);
    expect(content.articles.map((x) => x.paperKey)).toEqual(['P1', 'P2', 'P3']);

    expect(pdf.rendered).toHaveLength(1);
    expect(pdf.rendered[0]).toEqual(content); // the renderer saw exactly the served snapshot
    expect(issue!.status).toBe('READY');
    expect(storage.files.get(issue!.pdfStorageKey!)!.subarray(0, 5).toString()).toBe('%PDF-');
    // Content-addressed: the key names the exact bytes it holds.
    expect(issue!.pdfStorageKey).toBe(`issues/${a}/${issue!.id}-${issue!.pdfSha256}.pdf`);
  });

  it('is idempotent per reader/date under repeated and concurrent triggers', async () => {
    await seedPapers();
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => app.get(PublicationService).prepareIssue(a, DATE)),
    );
    const again = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(
      results.filter((r) => r.outcome === 'READY').length +
        results.filter((r) => r.outcome === 'IN_PROGRESS').length,
    ).toBe(5);
    expect(again.outcome).toBe('READY');
    expect((await db.query('SELECT count(*)::int AS n FROM issue'))[0].n).toBe(1);
    expect(pdf.rendered).toHaveLength(1);
    expect(calls('ARTICLE')).toBe(3);
    expect(calls('OUTLOOK')).toBe(1);
  });

  it('resumes from persisted checkpoints after a failure and a restart without repaying', async () => {
    await seedPapers();
    let articleCalls = 0;
    fake.handler = routingHandler({
      ARTICLE: () => {
        if (++articleCalls === 2) throw new Error('simulated crash during writing');
        return routingHandler()({ system: 'Sen PaperMorning adlı', messages: [] } as never);
      },
    });
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const failed = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(failed).toMatchObject({ outcome: 'FAILED' });
    expect(failed.run).toMatchObject({ stage: 'WRITING', status: 'FAILED', retryable: true });
    expect(failed.run!.checkpoint.selection).toHaveLength(3);
    expect(Object.keys(failed.run!.checkpoint.variantIds ?? {})).toHaveLength(1);

    // Back-off is respected: an immediate retry does not run.
    expect((await app.get(PublicationService).prepareIssue(a, DATE)).outcome).toBe('FAILED');
    expect(articleCalls).toBe(2);

    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    await app.close();
    fake.handler = routingHandler();
    await boot(true);
    const resumed = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(resumed.outcome).toBe('READY');
    expect(resumed.run!.attemptCount).toBe(2);
    // 1 variant written before the crash + 2 remaining = 3 successful writes in total.
    expect(
      (
        await db.query(`SELECT count(*)::int AS n FROM article_variant WHERE status = 'COMPLETED'`)
      )[0].n,
    ).toBe(3);
  });

  it('a VALIDATION_FAILED article is retried on the same variant row from the WRITING checkpoint', async () => {
    // Mirrors the 2026-11-28 failure: a validation-only fix keeps the article fingerprint (no
    // prompt bump), so the failed variant row is reclaimed and the run resumes from its checkpoint.
    await seedAnalyzedPaper(app, 'robotics', {
      abstractSuffix: ' We evaluate over 470,000 rollouts.',
    });
    const articleWith = (evidence: string) => {
      const data = cannedArticle();
      (data.sections as { key: string; body: string }[]).find((s) => s.key === 'evidence')!.body =
        evidence;
      return { data };
    };
    let articleCalls = 0;
    fake.handler = routingHandler({
      ARTICLE: () =>
        ++articleCalls === 1
          ? articleWith('Yazarlar 470 deneme koşusunu değerlendiriyor.') // a different quantity
          : articleWith('Yazarlar 470.000 koşuyu, yani 470 binden fazla denemeyi değerlendiriyor.'),
    });
    const reader = await createReader(app, 'reader_retry', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const analysesBefore = calls('ANALYSIS');

    const failed = await app.get(PublicationService).prepareIssue(reader, DATE);
    expect(failed).toMatchObject({ outcome: 'FAILED' });
    expect(failed.run).toMatchObject({ stage: 'WRITING', status: 'FAILED', retryable: true });
    expect(failed.reason).toMatch(
      /^VALIDATION_FAILED: .*numbers not present in the analysis\/abstract: 470 \[sections\[evidence\]\.body: /,
    );
    const [variantBefore] = await db.query(
      `SELECT id, generation_fingerprint, status, attempt_count, retryable FROM article_variant`,
    );
    expect(variantBefore).toMatchObject({ status: 'FAILED', attempt_count: 1, retryable: true });
    const selection = failed.run!.checkpoint.selection;

    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    const resumed = await app.get(PublicationService).prepareIssue(reader, DATE);
    expect(resumed.outcome).toBe('READY');
    expect(resumed.run).toMatchObject({ attemptCount: 2, status: 'COMPLETED' });
    expect(resumed.run!.checkpoint.selection).toEqual(selection);
    const variants = await db.query(
      `SELECT id, generation_fingerprint, status, attempt_count FROM article_variant`,
    );
    expect(variants).toEqual([
      {
        id: variantBefore.id,
        generation_fingerprint: variantBefore.generation_fingerprint,
        status: 'COMPLETED',
        attempt_count: 2,
      },
    ]);
    expect(articleCalls).toBe(2);
    expect(calls('ANALYSIS')).toBe(analysesBefore); // the shared analysis is not repaid
  });

  it('never marks an issue READY when PDF rendering fails, and keeps the frozen snapshot on retry', async () => {
    await seedPapers();
    pdf.failNext = 1;
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const failed = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(failed).toMatchObject({
      outcome: 'FAILED',
      reason: expect.stringMatching(/PDF_RENDER_FAILED/),
    });
    const [frozen] = await db.query(`SELECT status, content FROM issue`);
    expect(frozen.status).toBe('FROZEN');
    expect(await app.get(IssueService).listForUser(a)).toEqual([]);

    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    const ready = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(ready.outcome).toBe('READY');
    expect(ready.issue!.content).toEqual(frozen.content); // same snapshot, not regenerated
    expect(calls('OUTLOOK')).toBe(1);
  });

  it('enforces immutability of published issues in the database', async () => {
    await seedPapers();
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    await app.get(PublicationService).prepareIssue(a, DATE);
    await expect(
      db.query(`UPDATE issue SET content = jsonb_set(content, '{intro}', '"changed"')`),
    ).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE issue SET pdf_storage_key = 'issues/x.pdf'`)).rejects.toThrow(
      /published/,
    );
    await expect(db.query(`UPDATE issue SET issue_date = '2026-01-01'`)).rejects.toThrow(
      /immutable/,
    );
  });

  it('does not repeat papers from earlier issues and fails visibly when nothing new exists', async () => {
    await seedPapers();
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'quantum-physics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    expect((await app.get(PublicationService).prepareIssue(a, DATE)).outcome).toBe('READY');
    const nextDay = await app.get(PublicationService).prepareIssue(a, '2026-11-23');
    expect(nextDay).toMatchObject({
      outcome: 'FAILED',
      reason: expect.stringMatching(/NO_ELIGIBLE_RESEARCH/),
    });
    expect((await db.query('SELECT count(*)::int AS n FROM issue'))[0].n).toBe(1);
  });

  it('skips readers without topics and rejects an outlook citing unknown papers', async () => {
    await seedPapers();
    const none = await createReader(app, 'no_topics', []);
    expect(await app.get(PublicationService).prepareIssue(none, DATE)).toMatchObject({
      outcome: 'SKIPPED',
    });

    fake.handler = routingHandler({ OUTLOOK: () => ({ data: cannedOutlook(['P9']) }) });
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const result = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(result).toMatchObject({
      outcome: 'FAILED',
      reason: expect.stringMatching(/VALIDATION_FAILED.*unknown papers P9/),
    });
    expect((await db.query('SELECT count(*)::int AS n FROM issue'))[0].n).toBe(0);
  });

  it('reports honest insufficient evidence instead of inventing opportunities', async () => {
    await seedAnalyzedPaper(app, 'robotics');
    fake.handler = routingHandler({
      OUTLOOK: () => ({
        data: cannedOutlook(['P1'], {
          industryOpportunities: [],
          insufficientEvidence: {
            academic: null,
            industry: 'Tek ön baskı sektör pilotu için yeterli değil.',
            synthesis: null,
          },
        }),
      }),
    });
    const a = await createReader(app, 'reader_a', [
      { topicKey: 'robotics', priority: HIGH, knowledgeLevel: BEGINNER },
    ]);
    const { issue } = await app.get(PublicationService).prepareIssue(a, DATE);
    expect(issue!.content.outlook.industryOpportunities).toEqual([]);
    expect(issue!.content.outlook.insufficientEvidence.industry).toMatch(/yeterli değil/);
    expect(issue!.content.outlook.insufficientEvidence.synthesis).toMatch(/tek bir çalışma/);
  });
});
