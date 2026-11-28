import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DailyPublicationScheduler } from '../../../src/core/scheduler/daily-publication.scheduler';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { PreferenceService } from '../../../src/domain/account/service/preference.service';
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
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

const topics = [
  { topicKey: 'robotics', priority: TopicPriority.HIGH, knowledgeLevel: KnowledgeLevel.BEGINNER },
];
const T = (iso: string) => new Date(iso);

describe('DailyPublicationScheduler (simulated clock, PostgreSQL)', () => {
  let app: INestApplication;
  let mail: FakeMailTransport;
  let pdf: FakePdfRenderer;
  let db: DataSource;
  let scheduler: DailyPublicationScheduler;
  let istanbul: string;
  let newYork: string;

  async function boot(keepData = false, env: Record<string, string> = {}) {
    app = await createResearchApp({
      anthropic: new FakeAnthropic(routingHandler()),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      pdf,
      storage: new InMemoryFileStorage(),
      mail,
      keepData,
      env: { RESEARCH_HAIKU_SCREENING: 'false', ...env },
    });
    db = app.get(DataSource);
    scheduler = app.get(DailyPublicationScheduler);
  }

  /** One full minute of the server: preparation tick, then delivery tick. */
  async function minute(iso: string) {
    await scheduler.runPreparation(T(iso));
    return scheduler.runDelivery(T(iso));
  }

  beforeEach(async () => {
    mail = new FakeMailTransport();
    pdf = new FakePdfRenderer();
    await boot();
    for (let i = 0; i < 3; i++)
      await seedAnalyzedPaper(app, 'robotics', { publishedAt: '2026-11-23' });
    istanbul = await createReader(app, 'ist', topics, {
      dailyEmailEnabled: true,
      timezone: 'Europe/Istanbul',
    });
    newYork = await createReader(app, 'nyc', topics, {
      dailyEmailEnabled: true,
      timezone: 'America/New_York',
    });
  });
  afterEach(() => app.close());

  const issues = async (): Promise<{ user_id: string; issue_date: string; status: string }[]> =>
    db.query(
      `SELECT user_id, issue_date::text AS issue_date, status FROM issue ORDER BY issue_date, user_id`,
    );
  const sentTo = (who: string) => mail.sent.filter((m) => m.to === `${who}@example.org`);

  it("prepares from 06:00 and emails at 08:00 in each reader's own timezone", async () => {
    await minute('2026-11-24T02:59:00Z'); // 05:59 Istanbul, 21:59 New York (23rd): nothing due
    expect(await issues()).toEqual([]);

    await minute('2026-11-24T03:00:00Z'); // 06:00 Istanbul
    expect(await issues()).toEqual([
      { user_id: istanbul, issue_date: '2026-11-24', status: 'READY' },
    ]);
    expect(mail.sent).toHaveLength(0);

    await minute('2026-11-24T04:59:00Z'); // 07:59 Istanbul
    expect(mail.sent).toHaveLength(0);
    await minute('2026-11-24T05:00:00Z'); // 08:00 Istanbul, 00:00 New York
    expect(sentTo('ist')).toHaveLength(1);
    expect(sentTo('ist')[0].subject).toMatch(/^PaperMorning · 24 Kasım 2026 — /);
    expect(sentTo('nyc')).toHaveLength(0);

    await minute('2026-11-24T11:00:00Z'); // 06:00 New York -> prepare
    await minute('2026-11-24T12:59:00Z'); // 07:59 New York
    expect(sentTo('nyc')).toHaveLength(0);
    await minute('2026-11-24T13:00:00Z'); // 08:00 New York
    expect(sentTo('nyc')).toHaveLength(1);
    expect(sentTo('nyc')[0].attachments[0].filename).toBe('PaperMorning-2026-11-24.pdf');
    expect((await issues()).map((i: { issue_date: string }) => i.issue_date)).toEqual([
      '2026-11-24',
      '2026-11-24',
    ]);
  });

  it('never duplicates issues or emails under repeated ticks, concurrent ticks and a restart', async () => {
    await minute('2026-11-24T03:00:00Z');
    await Promise.all([
      minute('2026-11-24T05:00:00Z'),
      minute('2026-11-24T05:00:00Z'),
      minute('2026-11-24T05:01:00Z'),
    ]);
    await minute('2026-11-24T05:02:00Z');
    await app.close();
    await boot(true); // new process: empty in-memory state, same database
    await minute('2026-11-24T05:03:00Z');
    await minute('2026-11-24T06:30:00Z');
    expect(sentTo('ist')).toHaveLength(1);
    expect(
      (await issues()).filter((i: { user_id: string }) => i.user_id === istanbul),
    ).toHaveLength(1);
    expect(pdf.rendered).toHaveLength(1);
  });

  it('two server instances on one database: one issue, one render and one email per reader/day', async () => {
    await app.close();
    const storage = new InMemoryFileStorage(); // the shared /data volume
    const otherMail = new FakeMailTransport();
    const instance = (transport: FakeMailTransport) =>
      createResearchApp({
        anthropic: new FakeAnthropic(routingHandler()),
        sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
        pdf,
        storage,
        mail: transport,
        keepData: true,
        env: { RESEARCH_HAIKU_SCREENING: 'false' },
      });
    app = await instance(mail);
    const other = await instance(otherMail);
    try {
      const [a, b] = [app, other].map((x) => x.get(DailyPublicationScheduler));
      const both = (iso: string) =>
        Promise.all([
          a.runPreparation(T(iso)).then(() => a.runDelivery(T(iso))),
          b.runPreparation(T(iso)).then(() => b.runDelivery(T(iso))),
        ]);
      await both('2026-11-24T03:00:00Z'); // 06:00 Istanbul: both instances tick
      await both('2026-11-24T03:01:00Z');
      await both('2026-11-24T05:00:00Z'); // 08:00 Istanbul
      await both('2026-11-24T05:01:00Z');
      const sent = [...mail.sent, ...otherMail.sent].filter((m) => m.to === 'ist@example.org');
      expect(sent).toHaveLength(1);
      expect((await issues()).filter((i) => i.user_id === istanbul)).toEqual([
        expect.objectContaining({ issue_date: '2026-11-24', status: 'READY' }),
      ]);
      expect(pdf.rendered).toHaveLength(1);
    } finally {
      await other.close();
    }
  });

  it('an exhausted LLM budget never reaches Claude and retries stay bounded', async () => {
    await app.close();
    const fake = new FakeAnthropic(routingHandler());
    app = await createResearchApp({
      anthropic: fake,
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      pdf,
      storage: new InMemoryFileStorage(),
      mail,
      keepData: true,
      // Seeding today already spent more than this.
      env: {
        RESEARCH_HAIKU_SCREENING: 'false',
        LLM_DAILY_BUDGET_USD: '0.000001',
        PUBLICATION_MAX_ATTEMPTS: '2',
      },
    });
    db = app.get(DataSource);
    scheduler = app.get(DailyPublicationScheduler);
    const run = async () =>
      (
        await db.query(
          `SELECT attempt_count, status, error_kind, next_attempt_at FROM publication_run WHERE user_id = $1`,
          [istanbul],
        )
      )[0] as { attempt_count: number; status: string; error_kind: string; next_attempt_at: Date };

    await minute('2026-11-24T03:00:00Z');
    expect(await run()).toMatchObject({
      attempt_count: 1,
      status: 'FAILED',
      error_kind: 'BUDGET_EXCEEDED',
    });
    // Ticks inside the back-off window do nothing (no claim, no Claude request).
    for (const iso of ['2026-11-24T03:01:00Z', '2026-11-24T03:02:00Z', '2026-11-24T04:00:00Z'])
      await minute(iso);
    expect((await run()).attempt_count).toBe(1);

    // Back-off elapsed twice: the second attempt fails the same way, then attempts are exhausted.
    for (let i = 0; i < 3; i++) {
      await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
      await minute('2026-11-24T04:30:00Z');
    }
    expect((await run()).attempt_count).toBe(2);
    expect(fake.calls).toHaveLength(0); // every attempt was refused before any provider request

    await minute('2026-11-24T05:00:00Z'); // 08:00: nothing READY, nothing sent
    expect(sentTo('ist')).toEqual([]);
    expect((await issues()).filter((i) => i.user_id === istanbul)).toEqual([]);
  });

  it('prepares but never emails a reader who has not opted in', async () => {
    const profile = await app.get(PreferenceService).getForUser(istanbul);
    await app.get(PreferenceService).replaceForUser(istanbul, {
      ...profile.reader,
      dailyEmailEnabled: false,
      topics: profile.topics,
    });
    await minute('2026-11-24T03:00:00Z');
    const entries = await minute('2026-11-24T05:00:00Z');
    expect(entries.find((e) => e.userId === istanbul)!.delivery).toBe('NOT_SUBSCRIBED');
    expect(await issues()).toEqual([
      { user_id: istanbul, issue_date: '2026-11-24', status: 'READY' },
    ]);
    expect(mail.sent).toHaveLength(0);
  });

  it('records lateness, sends late within the window, and never relabels an old issue', async () => {
    // Yesterday's issue exists and was READY; today's rendering keeps failing until 08:30.
    await minute('2026-11-23T03:00:00Z');
    await minute('2026-11-23T05:00:00Z');
    expect(sentTo('ist')).toHaveLength(1);

    for (let i = 0; i < 2; i++)
      await seedAnalyzedPaper(app, 'robotics', { publishedAt: '2026-11-24' });
    pdf.failNext = 100;
    await minute('2026-11-24T03:00:00Z');
    const atDeadline = await minute('2026-11-24T05:00:00Z');
    expect(atDeadline.find((e) => e.userId === istanbul)!.delivery).toBe('NOT_READY');
    expect(sentTo('ist')).toHaveLength(1); // yesterday's issue is NOT resent as today's
    const [run] = await db.query(
      `SELECT late_at FROM publication_run WHERE user_id = $1 AND issue_date = '2026-11-24'`,
      [istanbul],
    );
    expect(run.late_at).not.toBeNull();

    pdf.failNext = 0;
    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    await minute('2026-11-24T05:30:00Z'); // 08:30: ready late, still inside the window
    expect(sentTo('ist')).toHaveLength(2);
    expect(sentTo('ist')[1].subject).toMatch(/^PaperMorning · 24 Kasım 2026 — /);
  });

  it('stops automatic work after the late window; a manual run publishes for the web without emailing', async () => {
    pdf.failNext = 100;
    await minute('2026-11-24T03:00:00Z');
    await minute('2026-11-24T05:00:00Z');
    pdf.failNext = 0;
    await db.query(`UPDATE publication_run SET next_attempt_at = now() - interval '1 second'`);
    const entries = await minute('2026-11-24T07:01:00Z'); // 10:01, window is 120 minutes
    expect(entries.find((e) => e.userId === istanbul)!.delivery).toBe('MISSED_CUTOFF');
    expect((await issues()).find((i: { user_id: string }) => i.user_id === istanbul)!.status).toBe(
      'FROZEN',
    );

    // Operator finishes the issue manually (CLI publication:prepare): READY on the web, no email.
    const { PublicationService } =
      await import('../../../src/domain/publication/service/publication.service');
    expect((await app.get(PublicationService).prepareIssue(istanbul, '2026-11-24')).outcome).toBe(
      'READY',
    );
    await minute('2026-11-24T07:05:00Z');
    expect(sentTo('ist')).toHaveLength(0);
  });

  it('a timezone change does not create a second issue or email for the same local day', async () => {
    await minute('2026-11-24T03:00:00Z');
    await minute('2026-11-24T05:00:00Z'); // Istanbul reader emailed
    const profile = await app.get(PreferenceService).getForUser(istanbul);
    await app.get(PreferenceService).replaceForUser(istanbul, {
      ...profile.reader,
      timezone: 'America/New_York',
      topics: profile.topics,
    });
    await minute('2026-11-24T11:00:00Z'); // 06:00 New York, same local date 2026-11-24
    await minute('2026-11-24T13:00:00Z'); // 08:00 New York
    expect(
      (await issues()).filter((i: { user_id: string }) => i.user_id === istanbul),
    ).toHaveLength(1);
    expect(sentTo('ist')).toHaveLength(1);
  });

  it('never retries an UNKNOWN delivery on later ticks', async () => {
    mail.results.push({ status: 'UNKNOWN', reason: 'connection lost after DATA' });
    await minute('2026-11-24T03:00:00Z');
    expect(
      (await minute('2026-11-24T05:00:00Z')).find((e) => e.userId === istanbul)!.delivery,
    ).toBe('UNKNOWN');
    await minute('2026-11-24T05:01:00Z');
    await app.close();
    await boot(true);
    await minute('2026-11-24T05:10:00Z');
    expect(sentTo('ist')).toHaveLength(1);
    expect((await db.query(`SELECT status FROM email_delivery`))[0].status).toBe('UNKNOWN');
  });

  it('dry-run plan reports what would happen and changes nothing', async () => {
    const plan = await scheduler.runDelivery(T('2026-11-24T05:00:00Z'), { dryRun: true });
    const prep = await scheduler.runPreparation(T('2026-11-24T05:00:00Z'), { dryRun: true });
    expect(prep.find((e) => e.userId === istanbul)).toMatchObject({
      preparation: 'WOULD_PREPARE',
      localTime: '08:00',
      issueDate: '2026-11-24',
    });
    expect(prep.find((e) => e.userId === newYork)).toMatchObject({
      preparation: 'NOT_DUE',
      localTime: '00:00',
    });
    expect(plan.find((e) => e.userId === istanbul)!.delivery).toBe('WOULD_SEND');
    expect(await issues()).toEqual([]);
    expect(mail.sent).toHaveLength(0);
  });

  it('follows DST for delivery (New York 08:00 = 12:00Z on 2026-03-08)', async () => {
    for (let i = 0; i < 2; i++)
      await seedAnalyzedPaper(app, 'robotics', { publishedAt: '2026-03-07' });
    await minute('2026-03-08T10:00:00Z'); // 06:00 EDT
    await minute('2026-03-08T11:59:00Z');
    expect(sentTo('nyc')).toHaveLength(0);
    await minute('2026-03-08T12:00:00Z'); // 08:00 EDT
    expect(sentTo('nyc')).toHaveLength(1);
  });

  it('cron handlers are no-ops when the scheduler is disabled (tests, CLI)', async () => {
    await scheduler.preparationTick();
    await scheduler.deliveryTick();
    expect(await issues()).toEqual([]);
  });
});
