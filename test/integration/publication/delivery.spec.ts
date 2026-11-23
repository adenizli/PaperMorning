import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { PreferenceService } from '../../../src/domain/account/service/preference.service';
import { DeliveryService } from '../../../src/domain/publication/service/delivery.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
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
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

const DATE = '2026-11-22';

describe('DeliveryService (PostgreSQL)', () => {
  let app: INestApplication;
  let mail: FakeMailTransport;
  let storage: InMemoryFileStorage;
  let db: DataSource;
  let reader: string;

  async function boot(
    env: Record<string, string> = {},
    handler = routingHandler(),
    pdfPadding = 0,
  ) {
    const pdf = new FakePdfRenderer();
    pdf.padBytes = pdfPadding;
    mail = new FakeMailTransport();
    storage = new InMemoryFileStorage();
    app = await createResearchApp({
      anthropic: new FakeAnthropic(handler),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      pdf,
      storage,
      mail,
      env: {
        RESEARCH_HAIKU_SCREENING: 'false',
        PUBLIC_BASE_URL: 'https://paper.example.org',
        ...env,
      },
    });
    db = app.get(DataSource);
    await seedAnalyzedPaper(app, 'robotics');
    await seedAnalyzedPaper(app, 'robotics');
    reader = await createReader(
      app,
      'reader_a',
      [
        {
          topicKey: 'robotics',
          priority: TopicPriority.HIGH,
          knowledgeLevel: KnowledgeLevel.BEGINNER,
        },
      ],
      { dailyEmailEnabled: true },
    );
    expect((await app.get(PublicationService).prepareIssue(reader, DATE)).outcome).toBe('READY');
  }
  const send = () => app.get(DeliveryService).sendReadyIssue(reader, DATE);

  afterEach(() => app.close());

  it('sends a readable digest with the actual stored PDF attached', async () => {
    await boot();
    const result = await send();
    expect(result.outcome).toBe('SENT');
    expect(result.delivery).toMatchObject({
      status: 'SENT',
      recipient: 'reader_a@example.org',
      providerMessageId: '<msg-1@test>',
      attemptCount: 1,
    });

    const [message] = mail.sent;
    const [issue] = await db.query(`SELECT id, pdf_storage_key, content FROM issue`);
    expect(message.to).toBe('reader_a@example.org');
    expect(message.subject).toBe(`PaperMorning | ${DATE}`);
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      filename: `PaperMorning-${DATE}.pdf`,
      contentType: 'application/pdf',
    });
    expect(message.attachments[0].content.equals(storage.files.get(issue.pdf_storage_key)!)).toBe(
      true,
    );
    expect(message.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');

    for (const article of issue.content.articles) {
      expect(message.text).toContain(article.headline);
      expect(message.text).toContain(article.source.references[0].url);
    }
    expect(message.text).toContain(issue.content.outlook.teaser);
    expect(message.text).toContain(`https://paper.example.org/issues/${issue.id}`);
    expect(message.text).toMatch(/Yalnızca özete dayalı/);
    expect(message.html).toContain('Ufuk Raporu');
    expect(message.html).toContain('https://paper.example.org/settings');
  });

  it('escapes model-written text in the HTML body', async () => {
    await boot(
      {},
      routingHandler({
        ARTICLE: () => ({ data: cannedArticle('<script>alert(1)</script> & "quotes"') }),
      }),
    );
    await send();
    expect(mail.sent[0].html).not.toContain('<script>');
    expect(mail.sent[0].html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;',
    );
  });

  it('never emails a reader who has not opted in', async () => {
    await boot();
    const profile = await app.get(PreferenceService).getForUser(reader);
    await app.get(PreferenceService).replaceForUser(reader, {
      ...profile.reader,
      dailyEmailEnabled: false,
      topics: profile.topics,
    });
    expect(await send()).toMatchObject({ outcome: 'NOT_OPTED_IN', delivery: null });
    expect(mail.sent).toHaveLength(0);
  });

  it('does not duplicate SENT on repeats or concurrent triggers', async () => {
    await boot();
    mail.delayMs = 100;
    const results = await Promise.all(Array.from({ length: 5 }, () => send()));
    expect(results.filter((r) => r.outcome === 'SENT')).toHaveLength(1);
    expect((await send()).outcome).toBe('ALREADY_SENT');
    expect(mail.sent).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int AS n FROM email_delivery'))[0].n).toBe(1);
  });

  it('records an ambiguous SMTP outcome as UNKNOWN and never resends it automatically', async () => {
    await boot();
    mail.results.push({ status: 'UNKNOWN', reason: 'connection lost after DATA' });
    expect((await send()).outcome).toBe('UNKNOWN');
    expect((await send()).outcome).toBe('UNKNOWN');
    expect(mail.sent).toHaveLength(1);

    const [row] = await db.query(`SELECT id FROM email_delivery`);
    await app.get(DeliveryService).resolveUnknown(row.id, 'RETRY');
    expect((await send()).outcome).toBe('SENT');
    expect(mail.sent).toHaveLength(2);
  });

  it('retries temporary rejections after back-off but not permanent ones', async () => {
    await boot();
    mail.results.push({ status: 'REJECTED', permanent: false, reason: '451 try later' });
    const first = await send();
    expect(first).toMatchObject({
      outcome: 'FAILED',
      delivery: { status: 'FAILED', errorCode: 'SMTP_TEMPORARY', retryable: true },
    });
    expect((await send()).outcome).toBe('FAILED'); // still in back-off
    await db.query(`UPDATE email_delivery SET next_attempt_at = now() - interval '1 second'`);
    mail.results.push({ status: 'REJECTED', permanent: true, reason: '550 mailbox unavailable' });
    expect((await send()).delivery).toMatchObject({
      status: 'FAILED',
      errorCode: 'SMTP_REJECTED',
      retryable: false,
    });
    await db.query(`UPDATE email_delivery SET next_attempt_at = now() - interval '1 second'`);
    expect((await send()).outcome).toBe('FAILED');
    expect(mail.sent).toHaveLength(2);
  });

  it('marks delivery DISABLED when mail is not configured and sends once it is', async () => {
    await boot();
    mail.enabled = false;
    expect(await send()).toMatchObject({ outcome: 'DISABLED', delivery: { status: 'DISABLED' } });
    expect(mail.sent).toHaveLength(0);
    mail.enabled = true;
    expect((await send()).outcome).toBe('SENT');
  });

  it('fails instead of sending when the stored PDF does not match its checksum', async () => {
    await boot();
    const [issue] = await db.query(`SELECT pdf_storage_key FROM issue`);
    storage.files.set(
      issue.pdf_storage_key,
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5000), Buffer.from('%%EOF')]),
    );
    const result = await send();
    expect(result).toMatchObject({
      outcome: 'FAILED',
      delivery: { errorCode: 'PDF_INTEGRITY', retryable: false },
    });
    expect(mail.sent).toHaveLength(0);
  });

  it('rejects an oversized (but authentic) PDF before any SMTP call', async () => {
    // 2 KB PDF -> ~2.7 KB after base64/MIME encoding, above a 2 KB limit.
    await boot({ MAIL_MAX_ATTACHMENT_BYTES: '2048' }, routingHandler(), 2000);
    const result = await send();
    expect(result).toMatchObject({
      outcome: 'FAILED',
      delivery: { status: 'FAILED', errorCode: 'ATTACHMENT_TOO_LARGE', retryable: false },
    });
    expect(mail.sent).toHaveLength(0);
  });

  it('turns a send interrupted by a crash into UNKNOWN rather than resending', async () => {
    await boot();
    const [issue] = await db.query(`SELECT id FROM issue`);
    await db.query(
      `INSERT INTO email_delivery (issue_id, user_id, channel, status, recipient, attempt_count, lease_expires_at)
       VALUES ($1, $2, 'EMAIL', 'SENDING', 'reader_a@example.org', 1, now() - interval '1 minute')`,
      [issue.id, reader],
    );
    expect(await send()).toMatchObject({
      outcome: 'UNKNOWN',
      delivery: { errorCode: 'INTERRUPTED' },
    });
    expect(mail.sent).toHaveLength(0);
  });

  it('does not send an issue that is not READY', async () => {
    await boot();
    expect(await app.get(DeliveryService).sendReadyIssue(reader, '2026-11-23')).toMatchObject({
      outcome: 'NOT_READY',
    });
  });
});
