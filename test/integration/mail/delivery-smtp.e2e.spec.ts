import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { DeliveryService } from '../../../src/domain/publication/service/delivery.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import { FakeAnthropic } from '../../support/fake-anthropic';
import {
  createReader,
  routingHandler,
  seedAnalyzedPaper,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';
import { startSmtpSink, SmtpSink } from '../../support/smtp-sink';

jest.setTimeout(120_000);
const DATE = '2026-11-24';

/** Real Chromium PDF -> real private storage -> real DeliveryService -> real SMTP (local server). */
describe('Daily email over real SMTP with the real PDF attached', () => {
  let app: INestApplication;
  let sink: SmtpSink;
  let reader: string;
  const dataDir = resolve(process.env.DATA_DIR!, `smtp-${Date.now()}`);

  async function boot(sinkOptions: Parameters<typeof startSmtpSink>[0] = {}) {
    sink = await startSmtpSink(sinkOptions);
    app = await createResearchApp({
      anthropic: new FakeAnthropic(routingHandler()),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      env: {
        RESEARCH_HAIKU_SCREENING: 'false',
        DATA_DIR: dataDir,
        PUBLIC_BASE_URL: 'https://paper.example.org',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(sink.port),
        SMTP_SECURE: 'starttls',
        SMTP_ALLOW_INSECURE: 'true', // local sink uses a self-signed certificate
        SMTP_FROM: 'PaperMorning <papermorning@example.org>',
        SMTP_SOCKET_TIMEOUT_MS: '1500',
      },
    });
    await seedAnalyzedPaper(app, 'robotics');
    await seedAnalyzedPaper(app, 'quantum-physics');
    reader = await createReader(
      app,
      'mail_reader',
      [
        {
          topicKey: 'robotics',
          priority: TopicPriority.HIGH,
          knowledgeLevel: KnowledgeLevel.BEGINNER,
        },
        {
          topicKey: 'quantum-physics',
          priority: TopicPriority.LOW,
          knowledgeLevel: KnowledgeLevel.ADVANCED,
        },
      ],
      { dailyEmailEnabled: true },
    );
    expect((await app.get(PublicationService).prepareIssue(reader, DATE)).outcome).toBe('READY');
  }

  afterEach(async () => {
    await app.close();
    await sink.close();
  });

  it('sends exactly one message whose PDF attachment equals the stored issue PDF', async () => {
    await boot();
    const result = await app.get(DeliveryService).sendReadyIssue(reader, DATE);
    expect(result.outcome).toBe('SENT');
    expect(result.delivery).toMatchObject({
      status: 'SENT',
      providerMessageId: expect.stringMatching(/^<.+>$/),
    });
    expect((await app.get(DeliveryService).sendReadyIssue(reader, DATE)).outcome).toBe(
      'ALREADY_SENT',
    );
    expect(sink.received).toHaveLength(1);

    const [issue] = await app
      .get(DataSource)
      .query('SELECT id, pdf_storage_key, content FROM issue');
    const stored = readFileSync(join(dataDir, 'private', issue.pdf_storage_key));
    const [email] = sink.received;
    expect(sink.sessions[0].secure).toBe(true); // STARTTLS was used
    expect(email.subject).toBe(`PaperMorning | ${DATE}`);
    expect(email.to && 'text' in email.to ? email.to.text : '').toBe('mail_reader@example.org');
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0]).toMatchObject({
      filename: `PaperMorning-${DATE}.pdf`,
      contentType: 'application/pdf',
    });
    expect(email.attachments[0].content.equals(stored)).toBe(true);
    expect(email.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    for (const article of issue.content.articles) {
      expect(email.text).toContain(article.headline);
      expect(email.text).toContain(article.source.references[0].url);
    }
    expect(email.text).toContain(issue.content.outlook.teaser);
    expect(email.text).toContain(`https://paper.example.org/issues/${issue.id}`);
    expect(email.html).toContain('Ufuk Raporu');
  });

  it('records UNKNOWN when the server takes the message but never confirms, and does not resend', async () => {
    await boot({ onMessage: () => undefined });
    const first = await app.get(DeliveryService).sendReadyIssue(reader, DATE);
    expect(first).toMatchObject({ outcome: 'UNKNOWN', delivery: { status: 'UNKNOWN' } });
    const second = await app.get(DeliveryService).sendReadyIssue(reader, DATE);
    expect(second.outcome).toBe('UNKNOWN');
    expect(sink.received).toHaveLength(1);
  });
});
