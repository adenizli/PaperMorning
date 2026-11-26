import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PublicationStatus } from '../../../src/common/enum/research.enum';
import {
  ResearchRunStage,
  ResearchRunStatus,
} from '../../../src/domain/research/model/research-run.model';
import { ResearchQueryService } from '../../../src/domain/research/service/research-query.service';
import { ResearchService } from '../../../src/domain/research/service/research.service';
import type { AcademicSearchResult } from '../../../src/service/academic-source/academic-source.types';
import { cannedAnalysis, FakeAnthropic } from '../../support/fake-anthropic';
import { createResearchApp } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

const records = [
  academicRecord(),
  academicRecord({
    sourceRecordId: '2611.00002v1',
    arxivId: '2611.00002',
    title: 'Legged robot locomotion',
    publishedAt: '2026-11-21',
    landingUrl: 'https://arxiv.org/abs/2611.00002v1',
  }),
  academicRecord({
    sourceRecordId: '2611.00003v1',
    arxivId: '2611.00003',
    title: 'Robotic grasp planning',
    publishedAt: '2026-11-19',
    landingUrl: 'https://arxiv.org/abs/2611.00003v1',
  }),
  // No abstract: must be rejected by rules, never sent to an LLM.
  academicRecord({
    sourceRecordId: '2611.00004v1',
    arxivId: '2611.00004',
    title: 'Robot note',
    abstract: null,
  }),
  // Unrelated paper.
  academicRecord({
    sourceRecordId: '2611.00005v1',
    arxivId: '2611.00005',
    title: 'Protein folding dynamics',
    categories: ['q-bio.BM'],
    abstract:
      'We simulate protein folding pathways with molecular dynamics and compare free-energy landscapes across temperatures in detail.',
  }),
];

const request = {
  topicKeys: ['robotics'],
  runDate: '2026-11-22',
  trigger: 'CLI' as const,
  maxCandidatesPerTopic: 2,
};

describe('ResearchService runs (PostgreSQL)', () => {
  let app: INestApplication;
  let fake: FakeAnthropic;
  let search: jest.Mock<Promise<AcademicSearchResult>>;

  async function boot(keepData = false) {
    app = await createResearchApp({
      anthropic: fake,
      sources: { search },
      keepData,
      env: { RESEARCH_HAIKU_SCREENING: 'false' },
    });
  }

  beforeEach(() => {
    fake = new FakeAnthropic(() => ({ data: cannedAnalysis() }));
    search = jest.fn().mockResolvedValue({ records, failures: [] });
  });
  afterEach(() => app.close());

  it('runs discovery -> screening -> capped analysis and exposes provenance through the query API', async () => {
    await boot();
    const [run] = await app.get(ResearchService).ensureDailyResearch(request);
    expect(run).toMatchObject({
      status: ResearchRunStatus.COMPLETED,
      stage: ResearchRunStage.DONE,
      windowFrom: '2026-11-15',
    });
    expect(run.counts).toMatchObject({
      discovered: 5,
      newVersions: 5,
      screened: 5,
      accepted: 3,
      candidates: 2,
      analyzed: 2,
      reused: 0,
    });
    expect(fake.calls).toHaveLength(2);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        arxivCategories: ['cs.RO'],
        from: '2026-11-15',
        until: '2026-11-22',
      }),
    );

    const views = await app
      .get(ResearchQueryService)
      .listAnalyzedPapers({ topicKeys: ['robotics'], publishedFrom: '2026-11-15' });
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      topicKey: 'robotics',
      publicationStatus: PublicationStatus.PREPRINT,
      coverage: 'ABSTRACT_ONLY',
    });
    expect(views[0].sourceReferences[0].url).toMatch(/^https:\/\/arxiv\.org\/abs\//);
    expect(
      await app
        .get(ResearchQueryService)
        .listAnalyzedPapers({ topicKeys: ['medicine'], publishedFrom: '2026-11-15' }),
    ).toEqual([]);
  });

  it('repeated triggers on the same day neither rediscover nor re-pay', async () => {
    await boot();
    await app.get(ResearchService).ensureDailyResearch(request);
    const [again] = await app.get(ResearchService).ensureDailyResearch(request);
    expect(again.status).toBe(ResearchRunStatus.COMPLETED);
    expect(search).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('resumes from the persisted ANALYSIS checkpoint after a budget stop and a restart', async () => {
    // The worst-case reservation of one Sonnet analysis is ~$0.09 (8000 max output tokens plus a
    // byte-length bound on the input). The first call settles to $0.052, so a second reservation
    // no longer fits into $0.12: exactly one analysis is paid for today.
    fake.handler = () => ({ data: cannedAnalysis(), inputTokens: 1000, outputTokens: 5000 });
    app = await createResearchApp({
      anthropic: fake,
      sources: { search },
      env: { RESEARCH_HAIKU_SCREENING: 'false', LLM_DAILY_BUDGET_USD: '0.12' },
    });
    const [stopped] = await app.get(ResearchService).ensureDailyResearch(request);
    expect(stopped).toMatchObject({
      status: ResearchRunStatus.FAILED,
      stage: ResearchRunStage.ANALYSIS,
    });
    expect(stopped.errors.join('\n')).toMatch(/BUDGET_EXCEEDED/);
    expect(fake.calls).toHaveLength(1);
    await app.close();

    // "Restart" with budget restored: discovery and screening are not repeated, the finished
    // analysis is reused and only the missing one is paid for.
    fake.handler = () => ({ data: cannedAnalysis() });
    app = await createResearchApp({
      anthropic: fake,
      sources: { search },
      keepData: true,
      env: { RESEARCH_HAIKU_SCREENING: 'false' },
    });
    const [resumed] = await app.get(ResearchService).ensureDailyResearch(request);
    expect(resumed).toMatchObject({ status: ResearchRunStatus.COMPLETED, attemptCount: 2 });
    expect(resumed.counts).toMatchObject({ analyzed: 1, reused: 1 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('keeps partial results when one source fails and fails visibly when all do', async () => {
    search.mockResolvedValueOnce({
      records: records.slice(0, 1),
      failures: [{ source: 'OPENALEX', message: 'HTTP 503' }],
    });
    await boot();
    const [partial] = await app.get(ResearchService).ensureDailyResearch(request);
    expect(partial.status).toBe(ResearchRunStatus.COMPLETED);
    expect(partial.errors).toContain('OPENALEX: HTTP 503');

    search.mockResolvedValueOnce({
      records: [],
      failures: [
        { source: 'OPENALEX', message: 'down' },
        { source: 'ARXIV', message: 'down' },
      ],
    });
    const [failed] = await app
      .get(ResearchService)
      .ensureDailyResearch({ ...request, runDate: '2026-11-23' });
    expect(failed).toMatchObject({
      status: ResearchRunStatus.FAILED,
      stage: ResearchRunStage.DISCOVERY,
    });
  });

  it('rejects unsupported topics', async () => {
    await boot();
    await expect(
      app.get(ResearchService).ensureDailyResearch({ ...request, topicKeys: ['astrology'] }),
    ).rejects.toThrow(/Unsupported topic/);
    expect(
      (await app.get(DataSource).query('SELECT count(*)::int AS n FROM research_run'))[0].n,
    ).toBe(0);
  });
});
