import { INestApplication } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { IssueService } from '../../../src/domain/publication/service/issue.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import { LlmService } from '../../../src/service/llm/llm.service';
import { FakeAnthropic } from '../../support/fake-anthropic';
import { FakeMailTransport, InMemoryFileStorage } from '../../support/fake-integrations';
import { inspectPdf } from '../../support/pdf-text';
import {
  cannedArticle,
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

jest.setTimeout(180_000);

const DATE = '2026-11-24';
const topics = [
  { topicKey: 'robotics', priority: TopicPriority.HIGH, knowledgeLevel: KnowledgeLevel.BEGINNER },
];

const promptOf = (params: Anthropic.MessageCreateParamsNonStreaming): string => {
  const content = params.messages[0]?.content;
  return typeof content === 'string' ? content : JSON.stringify(content);
};

/**
 * A multi-paper issue in one research area, end to end: real PostgreSQL, real Chromium PDF,
 * Claude faked. Selection, cached analyses, article checkpoints, cross-study Outlook citations,
 * pagination and bookmarks.
 */
describe('multi-paper issue (PostgreSQL + real PDF)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let storage: InMemoryFileStorage;
  let db: DataSource;
  let articleCalls = 0;
  const calls = (task: string) => fake.calls.filter((c) => taskOf(c) === task).length;

  beforeEach(async () => {
    articleCalls = 0;
    fake = new FakeAnthropic(
      routingHandler({
        // A distinct headline per paper; the second paper fails once (crash during writing).
        ARTICLE: (params) => {
          articleCalls++;
          if (articleCalls === 2) throw new Error('simulated crash while writing paper 2');
          const title = /Makale başlığı: (.+)/.exec(promptOf(params))?.[1] ?? 'Bilinmeyen';
          return {
            data: {
              ...cannedArticle(`Bulgu: ${title}`),
              notReported: ['Gerçek robotlardaki sonuçlar özette belirtilmiyor.'],
            },
          };
        },
      }),
    );
    storage = new InMemoryFileStorage();
    app = await createResearchApp({
      anthropic: fake,
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      storage,
      mail: new FakeMailTransport(),
      env: { RESEARCH_HAIKU_SCREENING: 'false', LLM_DAILY_BUDGET_USD: '2' },
    });
    db = app.get(DataSource);
  });
  afterEach(() => app.close());

  it('selects distinct works, recovers from a failed article, and synthesizes across papers', async () => {
    await seedAnalyzedPaper(app, 'robotics', {
      title: 'Learning to Grasp: A Benchmark',
      authors: ['A. Smith'],
    });
    // The journal version of the same work (a different paper record): must not appear twice.
    await seedAnalyzedPaper(app, 'robotics', {
      title: 'Learning to grasp — a benchmark',
      authors: ['A. Smith'],
    });
    await seedAnalyzedPaper(app, 'robotics', {
      title: 'Tactile Sensing at Scale',
      authors: ['B. Jones'],
    });
    await seedAnalyzedPaper(app, 'robotics', {
      title: 'Legged Locomotion on Ice',
      authors: ['C. Wu'],
    });
    const reader = await createReader(app, 'reader_multi', topics);
    const analyses = calls('ANALYSIS');

    // Attempt 1: the second article fails; the first is checkpointed.
    const failed = await app.get(PublicationService).prepareIssue(reader, DATE);
    expect(failed).toMatchObject({ outcome: 'FAILED' });
    expect(failed.run!.checkpoint.selection).toHaveLength(3);
    expect(Object.keys(failed.run!.checkpoint.variantIds ?? {})).toHaveLength(1);

    // Attempt 2 after the back-off: resumes from the checkpoint, same selection.
    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    const ready = await app.get(PublicationService).prepareIssue(reader, DATE);
    expect(ready.outcome).toBe('READY');
    expect(ready.run!.checkpoint.selection).toEqual(failed.run!.checkpoint.selection);
    expect(articleCalls).toBe(4); // 3 articles + the failed attempt; paper 1 not rewritten
    expect(calls('ANALYSIS')).toBe(analyses); // cached analyses, never repaid
    expect(calls('OUTLOOK')).toBe(1);

    const content = ready.issue!.content;
    const titles = content.articles.map((a) => a.source.title);
    expect(titles).toHaveLength(3);
    expect(new Set(content.articles.map((a) => a.provenance.paperId)).size).toBe(3);
    expect(titles.filter((t) => /grasp/i.test(t))).toHaveLength(1);
    expect(content.articles.map((a) => a.role)).toEqual(['COVER', 'FEATURE', 'FEATURE']);

    // Cross-study Outlook: citations only to papers of this issue; relationships cite two papers.
    const keys = new Set(content.articles.map((a) => a.paperKey));
    const outlook = content.outlook;
    expect(outlook.mode).toBe('CROSS_STUDY');
    expect(outlook.synthesis.paperKeys.length).toBeGreaterThanOrEqual(2);
    expect(outlook.contrasts!.length).toBeGreaterThanOrEqual(1);
    for (const contrast of outlook.contrasts!)
      expect(contrast.paperKeys.length).toBeGreaterThanOrEqual(2);
    const cited = [
      outlook.synthesis,
      ...outlook.evidence,
      ...outlook.inferences,
      ...outlook.contrasts!,
      ...outlook.academicOpportunities,
      ...outlook.industryOpportunities,
    ].flatMap((c) => c.paperKeys);
    for (const key of cited) expect(keys.has(key)).toBe(true);

    // Real PDF: magazine layout, every article and the Outlook reachable from the bookmarks.
    const pdf = await app.get(IssueService).readVerifiedPdf(ready.issue!);
    const doc = inspectPdf(pdf);
    expect(doc.pages).toBeGreaterThanOrEqual(4);
    expect(doc.pages).toBeLessThanOrEqual(10);
    const bookmarks = JSON.stringify(doc.outline);
    for (const article of content.articles) expect(bookmarks).toContain(article.headline);
    expect(bookmarks).toContain('Ufuk Raporu');
    expect(doc.pageTexts.join(' ')).toContain('Özette belirtilmeyenler'.toLocaleUpperCase('tr-TR'));

    // Spend is recorded and within the daily budget.
    const budget = await app.get(LlmService).budgetStatus();
    expect(budget.spentUsd + budget.inFlightUsd).toBeLessThanOrEqual(budget.budgetUsd);
  });

  it('a second reader with the same interests reuses analyses, articles and the Outlook', async () => {
    articleCalls = 10; // no injected failure in this test
    for (const title of ['Paper One', 'Paper Two', 'Paper Three'])
      await seedAnalyzedPaper(app, 'robotics', { title, authors: [`${title} Author`] });
    const first = await createReader(app, 'reader_one', topics);
    const second = await createReader(app, 'reader_two', topics);
    expect((await app.get(PublicationService).prepareIssue(first, DATE)).outcome).toBe('READY');
    const before = {
      analysis: calls('ANALYSIS'),
      article: calls('ARTICLE'),
      outlook: calls('OUTLOOK'),
    };
    const other = await app.get(PublicationService).prepareIssue(second, DATE);
    expect(other.outcome).toBe('READY');
    expect({
      analysis: calls('ANALYSIS'),
      article: calls('ARTICLE'),
      outlook: calls('OUTLOOK'),
    }).toEqual(before);
    expect(other.issue!.content.articles).toHaveLength(3);
  });
});
