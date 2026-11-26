import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DailyPublicationScheduler } from '../../../src/core/scheduler/daily-publication.scheduler';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import type { AcademicSearchResult } from '../../../src/service/academic-source/academic-source.types';
import { gate, waitUntil } from '../../support/concurrency';
import { FakeAnthropic } from '../../support/fake-anthropic';
import {
  FakeMailTransport,
  FakePdfRenderer,
  InMemoryFileStorage,
} from '../../support/fake-integrations';
import {
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

// 06:00 in Istanbul on 2026-11-24: every reader below is due for preparation.
const SIX_AM = new Date('2026-11-24T03:00:00Z');
const NEXT_MINUTE = new Date('2026-11-24T03:01:00Z');
const topic = (topicKey: string) => [
  { topicKey, priority: TopicPriority.HIGH, knowledgeLevel: KnowledgeLevel.BEGINNER },
];

describe('DailyPublicationScheduler bounded concurrency (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let fake: FakeAnthropic;
  let search: jest.Mock<Promise<AcademicSearchResult>>;
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];

  async function boot() {
    active = maxActive = 0;
    started.length = 0;
    app = await createResearchApp({
      anthropic: fake,
      sources: { search },
      pdf: new FakePdfRenderer(),
      storage: new InMemoryFileStorage(),
      mail: new FakeMailTransport(),
      env: { RESEARCH_HAIKU_SCREENING: 'false', SCHEDULER_PREPARATION_CONCURRENCY: '2' },
    });
    db = app.get(DataSource);
    // Observe (without changing) how many preparations run at the same time.
    const publications = app.get(PublicationService);
    const prepare = publications.prepareIssue.bind(publications);
    jest.spyOn(publications, 'prepareIssue').mockImplementation(async (userId, date) => {
      started.push(userId);
      maxActive = Math.max(maxActive, ++active);
      try {
        return await prepare(userId, date);
      } finally {
        active--;
      }
    });
  }
  afterEach(() => app.close());

  const reader = (name: string, topicKey: string) =>
    createReader(app, name, topic(topicKey), { timezone: 'Europe/Istanbul' });
  const status = async (userId: string): Promise<string | undefined> => {
    const rows = await db.query<{ status: string }[]>(
      `SELECT status FROM issue WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.status;
  };

  it('a slow reader does not block successful and failing readers, within the slot limit', async () => {
    const slow = gate();
    const canned = routingHandler();
    fake = new FakeAnthropic(async (params) => {
      // Every article about the slow reader's topic stalls until released.
      if (taskOf(params) === 'ARTICLE' && JSON.stringify(params.messages).includes('SLOWTOPIC')) {
        await slow.promise;
      }
      return canned(params);
    });
    search = jest.fn().mockResolvedValue({ records: [], failures: [] });
    await boot();
    await seedAnalyzedPaper(app, 'robotics', {
      title: 'SLOWTOPIC robot study',
      publishedAt: '2026-11-23',
    });
    await seedAnalyzedPaper(app, 'quantum-physics', { publishedAt: '2026-11-23' });
    await seedAnalyzedPaper(app, 'aerospace', { publishedAt: '2026-11-23' });
    const slowReader = await reader('slow', 'robotics'); // listed first
    const fastA = await reader('fast_a', 'quantum-physics');
    const failing = await reader('failing', 'medicine'); // no research at all -> FAILED
    const fastB = await reader('fast_b', 'aerospace');

    const scheduler = app.get(DailyPublicationScheduler);
    const firstTick = scheduler.runPreparation(SIX_AM);

    // While the slow reader holds one slot, the others go through the second one.
    await waitUntil(
      async () => (await status(fastA)) === 'READY' && (await status(fastB)) === 'READY',
    );
    expect(await status(slowReader)).toBeUndefined();
    const [failed] = await db.query(
      `SELECT status, error_kind FROM publication_run WHERE user_id = $1`,
      [failing],
    );
    expect(failed).toMatchObject({ status: 'FAILED', error_kind: 'NO_ELIGIBLE_RESEARCH' });

    // A later tick does not start the in-flight reader again and is not blocked by it.
    const second = await scheduler.runPreparation(NEXT_MINUTE);
    expect(second.find((e) => e.userId === slowReader)!.preparation).toBe('IN_PROGRESS');
    expect(started.filter((id) => id === slowReader)).toHaveLength(1);

    slow.open();
    const entries = await firstTick;
    const outcome = (id: string) => entries.find((e) => e.userId === id)!.preparation;
    expect([outcome(slowReader), outcome(fastA), outcome(failing), outcome(fastB)]).toEqual([
      'READY',
      'READY',
      'FAILED',
      'READY',
    ]);
    expect(maxActive).toBe(2);
    expect((await db.query(`SELECT count(*)::int AS n FROM issue`))[0].n).toBe(3);
  });

  it('a reader waits for research another reader is running for the same topic', async () => {
    const researchHeld = gate();
    fake = new FakeAnthropic(routingHandler());
    const records = [
      academicRecord({ publishedAt: '2026-11-23' }),
      academicRecord({
        sourceRecordId: '2611.00002v1',
        arxivId: '2611.00002',
        title: 'Legged robot locomotion',
        publishedAt: '2026-11-23',
        landingUrl: 'https://arxiv.org/abs/2611.00002v1',
      }),
    ];
    search = jest.fn().mockImplementation(async () => {
      await researchHeld.promise;
      return { records, failures: [] };
    });
    await boot();
    // No analyses exist yet: both readers depend on today's shared research run.
    const first = await reader('first', 'robotics');
    const second = await reader('second', 'robotics');

    const tick = app.get(DailyPublicationScheduler).runPreparation(SIX_AM);
    await waitUntil(() => started.length === 2 && search.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    researchHeld.open();
    const entries = await tick;

    expect(entries.map((e) => e.preparation)).toEqual(['READY', 'READY']);
    expect(search).toHaveBeenCalledTimes(1); // one shared research run for both readers
    expect(await status(first)).toBe('READY');
    expect(await status(second)).toBe('READY');
    expect(
      (
        await db.query(`SELECT count(*)::int AS n FROM research_run WHERE topic_key = 'robotics'`)
      )[0].n,
    ).toBe(1);
  }, 30_000);
});
