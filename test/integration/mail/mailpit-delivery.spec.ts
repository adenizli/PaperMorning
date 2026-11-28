import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { cliCommands } from '../../../src/bootstrap/cli';
import { envelope } from '../../../src/bootstrap/cli-outcome';
import { sha256Hex } from '../../../src/common/text/fingerprint';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { FakeAnthropic } from '../../support/fake-anthropic';
import {
  createReader,
  routingHandler,
  seedAnalyzedPaper,
  taskOf,
} from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

jest.setTimeout(180_000);

/**
 * End to end against a real Mailpit (the development mail sink from docker-compose.yml):
 * real Chromium PDF -> real private storage -> real SMTP -> Mailpit API. Runs when MAILPIT_API_URL
 * and MAILPIT_SMTP_PORT point at a disposable Mailpit (CI starts one); never at a real provider.
 * Recipients are unique per run, so a shared development Mailpit is never cleared.
 */
const API = process.env.MAILPIT_API_URL;
const SMTP_PORT = process.env.MAILPIT_SMTP_PORT;
const SMTP_HOST = process.env.MAILPIT_SMTP_HOST ?? '127.0.0.1';
const DATE = '2026-11-26';
const run = Math.random().toString(36).slice(2, 8);
const topics = [
  { topicKey: 'robotics', priority: TopicPriority.HIGH, knowledgeLevel: KnowledgeLevel.BEGINNER },
];

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}
interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  To: { Address: string }[];
  Cc: unknown[] | null;
  Bcc: unknown[] | null;
  Attachments: { PartID: string; FileName: string; ContentType: string; Size: number }[];
}

async function messagesTo(address: string): Promise<MailpitSummary[]> {
  const response = await fetch(
    `${API}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  return ((await response.json()) as { messages: MailpitSummary[] }).messages;
}
const message = async (id: string) =>
  (await (await fetch(`${API}/api/v1/message/${id}`)).json()) as MailpitMessage;
const part = async (id: string, partId: string) =>
  Buffer.from(await (await fetch(`${API}/api/v1/message/${id}/part/${partId}`)).arrayBuffer());

(API && SMTP_PORT ? describe : describe.skip)('daily email through Mailpit (real SMTP)', () => {
  let app: INestApplication;
  const dataDir = resolve(process.env.DATA_DIR!, `mailpit-${run}`);
  const smtpEnv = {
    SMTP_HOST,
    SMTP_PORT: SMTP_PORT!,
    SMTP_SECURE: 'none',
    SMTP_ALLOW_INSECURE: 'true', // Mailpit is a plaintext development sink
    SMTP_FROM: 'PaperMorning <papermorning@example.org>',
  };

  async function boot(env: Record<string, string>) {
    app = await createResearchApp({
      anthropic: new FakeAnthropic(routingHandler()),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      env: { RESEARCH_HAIKU_SCREENING: 'false', DATA_DIR: dataDir, ...env },
    });
    await seedAnalyzedPaper(app, 'robotics');
  }
  afterEach(() => app?.close());

  const cli = (command: string, args: Record<string, string>) =>
    cliCommands[command](app, args).then((result) => envelope(command, result));

  it('opted-in reader: exactly one message, PDF attached byte for byte; no duplicate on repeat', async () => {
    await boot(smtpEnv);
    const name = `mp_in_${run}`;
    await createReader(app, name, topics, { dailyEmailEnabled: true });
    const address = `${name}@example.org`;
    expect(await cli('publication:prepare', { user: name, date: DATE })).toMatchObject({
      outcome: 'READY',
      exitCode: 0,
    });

    expect(await cli('delivery:send', { user: name, date: DATE })).toMatchObject({
      outcome: 'SENT',
      exitCode: 0,
      status: 'SENT',
    });
    const [summary, ...others] = await messagesTo(address);
    expect(others).toEqual([]);
    const full = await message(summary.ID);
    expect(full.To.map((t) => t.Address)).toEqual([address]); // only the owner, no cc/bcc
    expect(full.Cc ?? []).toEqual([]);
    expect(full.Bcc ?? []).toEqual([]);
    // Turkish letters decoded correctly from the RFC 2047 subject and the UTF-8 body.
    expect(full.Subject).toMatch(/^PaperMorning · 26 Kasım 2026 — \S/);
    expect(full.Text).toContain('Sayının tam PDF sürümü bu e-postanın ekindedir');
    expect(full.Text).toContain('Günlük e-postayı durdurmak için');
    expect(full.Attachments).toHaveLength(1);
    const [attachment] = full.Attachments;
    expect(attachment).toMatchObject({
      FileName: `PaperMorning-${DATE}.pdf`,
      ContentType: 'application/pdf',
    });
    const [issue] = await app.get(DataSource).query(
      `SELECT i.pdf_sha256, i.pdf_size_bytes FROM issue i JOIN users u ON u.id = i.user_id
          WHERE u.username = $1 AND i.issue_date = $2 AND i.status = 'READY'`,
      [name, DATE],
    );
    const bytes = await part(summary.ID, attachment.PartID);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBe(Number(issue.pdf_size_bytes));
    expect(sha256Hex(bytes)).toBe(issue.pdf_sha256);

    // Repeat and a scheduler tick at 08:00 local: still exactly one message.
    expect(await cli('delivery:send', { user: name, date: DATE })).toMatchObject({
      outcome: 'ALREADY_SENT',
      exitCode: 0,
    });
    await cli('scheduler:tick', { at: '2026-11-26T05:00:00Z', send: 'true' });
    expect(await messagesTo(address)).toHaveLength(1);
  });

  it('never emails a reader who has not opted in, nor another reader’s issue', async () => {
    await boot(smtpEnv);
    const out = `mp_out_${run}`;
    const other = `mp_other_${run}`;
    await createReader(app, out, topics, { dailyEmailEnabled: false });
    await createReader(app, other, topics, { dailyEmailEnabled: true });
    await cli('publication:prepare', { user: out, date: DATE });

    expect(await cli('delivery:send', { user: out, date: DATE })).toMatchObject({
      outcome: 'NOT_OPTED_IN',
      exitCode: 3,
    });
    // `other` opted in but has no issue for this date: nothing of `out` is ever sent to them.
    expect(await cli('delivery:send', { user: other, date: DATE })).toMatchObject({
      outcome: 'NOT_READY',
      exitCode: 3,
    });
    expect(await messagesTo(`${out}@example.org`)).toEqual([]);
    expect(await messagesTo(`${other}@example.org`)).toEqual([]);
  });

  it('MAIL_ENABLED=false or no SMTP host: DISABLED, nothing reaches Mailpit', async () => {
    for (const env of [{ ...smtpEnv, MAIL_ENABLED: 'false' }, { MAIL_ENABLED: 'true' }]) {
      await boot(env);
      const name = `mp_off_${randomBytes(3).toString('hex')}`;
      await createReader(app, name, topics, { dailyEmailEnabled: true });
      await cli('publication:prepare', { user: name, date: DATE });
      expect(await cli('delivery:send', { user: name, date: DATE })).toMatchObject({
        outcome: 'DISABLED',
        exitCode: 3,
        status: 'DISABLED',
      });
      expect(await messagesTo(`${name}@example.org`)).toEqual([]);
      await app.close();
    }
  });

  it('mail:verify checks connectivity without sending; a failure is reported without secrets', async () => {
    await boot(smtpEnv);
    const before = (await (await fetch(`${API}/api/v1/messages?limit=1`)).json()) as {
      total: number;
    };
    expect(await cli('mail:verify', {})).toMatchObject({
      outcome: 'OK',
      exitCode: 0,
      security: 'none',
      messagesSent: 0,
    });
    const after = (await (await fetch(`${API}/api/v1/messages?limit=1`)).json()) as {
      total: number;
    };
    expect(after.total).toBe(before.total);
    await app.close();

    // Nothing listens on port 1: connection refused, reported as FAILED (exit 1).
    await boot({
      ...smtpEnv,
      SMTP_PORT: '1',
      SMTP_USER: 'pm-user-should-not-leak',
      SMTP_PASSWORD: 'pm-password-should-not-leak',
    });
    const failed = await cli('mail:verify', {});
    expect(failed).toMatchObject({ outcome: 'FAILED', exitCode: 1, authConfigured: true });
    expect(JSON.stringify(failed)).not.toMatch(/should-not-leak/);
  });

  it('mail:test sends one synthetic message with a Turkish subject and the PDF, and writes nothing', async () => {
    await boot(smtpEnv);
    const address = `mp_test_${run}@example.org`;
    const db = app.get(DataSource);
    const deliveries = async () =>
      (await db.query(`SELECT count(*)::int AS n FROM email_delivery`))[0].n as number;
    const before = await deliveries();

    await expect(cli('mail:test', { to: 'a@example.org,b@example.org' })).rejects.toThrow(
      /exactly one explicit recipient/,
    );
    const result = await cli('mail:test', { to: address });
    expect(result).toMatchObject({ outcome: 'SENT', exitCode: 0, to: address, databaseWrites: 0 });
    const [summary, ...others] = await messagesTo(address);
    expect(others).toEqual([]);
    const full = await message(summary.ID);
    expect(full.Subject).toBe('PaperMorning SMTP testi — çğıöşü ÇĞİÖŞÜ');
    expect(full.Text).toContain('Türkçe karakter denetimi: çğıöşü ÇĞİÖŞÜ');
    expect(full.To.map((t) => t.Address)).toEqual([address]);
    const [attachment] = full.Attachments;
    expect(attachment).toMatchObject({
      FileName: 'PaperMorning-SMTP-testi.pdf',
      ContentType: 'application/pdf',
    });
    const bytes = await part(summary.ID, attachment.PartID);
    expect(sha256Hex(bytes)).toBe((result.attachment as { sha256: string }).sha256);
    expect(await deliveries()).toBe(before);

    await app.close();
    await boot({ ...smtpEnv, MAIL_ENABLED: 'false' });
    expect(await cli('mail:test', { to: address })).toMatchObject({
      outcome: 'DISABLED',
      exitCode: 3,
    });
    expect(await messagesTo(address)).toHaveLength(1);
  });

  it('scheduler:plan is a dry run: reports WOULD_PREPARE, sends and writes nothing, no Claude call', async () => {
    const fake = new FakeAnthropic(routingHandler());
    app = await createResearchApp({
      anthropic: fake,
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      env: { RESEARCH_HAIKU_SCREENING: 'false', DATA_DIR: dataDir, ...smtpEnv },
    });
    await seedAnalyzedPaper(app, 'robotics');
    const name = `mp_plan_${run}`;
    const userId = await createReader(app, name, topics, { dailyEmailEnabled: true });
    const db = app.get(DataSource);
    const count = async (table: string) =>
      (await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n as number;
    const before = {
      issues: await count('issue'),
      runs: await count('publication_run'),
      deliveries: await count('email_delivery'),
      writes: fake.calls.filter((c) => taskOf(c) === 'ARTICLE').length,
    };

    const plan = await cli('scheduler:plan', { at: '2026-11-26T03:00:00Z' }); // 06:00 Istanbul
    const entry = (plan.readers as { userId: string; preparation: string }[]).find(
      (r) => r.userId === userId,
    );
    expect(plan).toMatchObject({ outcome: 'OK', exitCode: 0, dryRun: true });
    expect(entry).toMatchObject({ preparation: 'WOULD_PREPARE' });
    expect({
      issues: await count('issue'),
      runs: await count('publication_run'),
      deliveries: await count('email_delivery'),
      writes: fake.calls.filter((c) => taskOf(c) === 'ARTICLE').length,
    }).toEqual(before);
    expect(await messagesTo(`${name}@example.org`)).toEqual([]);
  });
});
