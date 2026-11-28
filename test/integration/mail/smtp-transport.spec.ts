import { createServer } from 'net';
import { MailService } from '../../../src/service/mail/mail.service';
import type { MailMessage } from '../../../src/service/mail/mail-transport';
import { startSmtpSink, smtpError, SmtpSink } from '../../support/smtp-sink';
import { testConfig } from '../../support/test-config';

jest.setTimeout(30_000);

const pdf = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.alloc(50_000, 7),
  Buffer.from('\n%%EOF\n'),
]);
const message = (): MailMessage => ({
  to: 'reader@example.org',
  subject: 'PaperMorning · 24 Kasım 2026 — Işığı ölçen robotlar: çğıöşü ÇĞİÖŞÜ',
  text: 'Merhaba — ğüşıöç\nKaynak: https://arxiv.org/abs/2611.00001',
  html: '<p>Merhaba — ğüşıöç</p><p>&lt;b&gt;escaped&lt;/b&gt;</p>',
  attachments: [
    { filename: 'PaperMorning-2026-11-24.pdf', contentType: 'application/pdf', content: pdf },
  ],
});

function mail(port: number, env: Record<string, string> = {}) {
  return new MailService(
    testConfig({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: 'none',
      SMTP_ALLOW_INSECURE: 'true',
      SMTP_FROM: 'PaperMorning <papermorning@example.org>',
      SMTP_SOCKET_TIMEOUT_MS: '800',
      SMTP_CONNECTION_TIMEOUT_MS: '800',
      ...env,
    }),
  );
}

describe('MailService against a real local SMTP server', () => {
  let sink: SmtpSink | undefined;
  afterEach(async () => {
    await sink?.close();
    sink = undefined;
  });

  it('delivers a real MIME message: plain text + HTML + the exact PDF bytes', async () => {
    sink = await startSmtpSink();
    const result = await mail(sink.port).send(message());
    expect(result).toMatchObject({
      status: 'ACCEPTED',
      messageId: expect.stringMatching(/^<.+>$/),
    });

    const [received] = sink.received;
    // Turkish letters survive RFC 2047 header encoding unchanged.
    expect(received.subject).toBe(
      'PaperMorning · 24 Kasım 2026 — Işığı ölçen robotlar: çğıöşü ÇĞİÖŞÜ',
    );
    expect(received.from?.value[0]).toMatchObject({
      name: 'PaperMorning',
      address: 'papermorning@example.org',
    });
    expect(received.text).toContain('ğüşıöç');
    expect(received.html).toContain('&lt;b&gt;escaped&lt;/b&gt;');
    expect(received.attachments).toHaveLength(1);
    const [attachment] = received.attachments;
    expect(attachment.filename).toBe('PaperMorning-2026-11-24.pdf');
    expect(attachment.contentType).toBe('application/pdf');
    expect(attachment.content.equals(pdf)).toBe(true);
  });

  it('classifies a 5xx recipient rejection as permanent and a 4xx after DATA as temporary', async () => {
    sink = await startSmtpSink({
      onRcptTo: (_a, _s, cb) => cb(smtpError('Mailbox unavailable', 550)),
    });
    expect(await mail(sink.port).send(message())).toMatchObject({
      status: 'REJECTED',
      permanent: true,
    });
    await sink.close();

    sink = await startSmtpSink({
      onMessage: (_raw, _s, done) => done(smtpError('Try again later', 451)),
    });
    expect(await mail(sink.port).send(message())).toMatchObject({
      status: 'REJECTED',
      permanent: false,
    });
  });

  it('treats a timeout BEFORE DATA as not sent (temporary) ...', async () => {
    sink = await startSmtpSink({ onMailFrom: () => undefined /* never answers */ });
    const result = await mail(sink.port).send(message());
    expect(result).toMatchObject({ status: 'REJECTED', permanent: false });
    expect(sink.received).toHaveLength(0);
  });

  it('... but a timeout AFTER the message was transmitted as UNKNOWN (it may have been accepted)', async () => {
    sink = await startSmtpSink({
      onMessage: () => undefined /* receives the message, never confirms */,
    });
    const result = await mail(sink.port).send(message());
    expect(result).toMatchObject({ status: 'UNKNOWN' });
    expect(sink.received).toHaveLength(1); // the server really did get the full message
  });

  it('treats a refused connection as not sent', async () => {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    expect(await mail(port).send(message())).toMatchObject({
      status: 'REJECTED',
      permanent: false,
    });
  });

  it('reports authentication failures as retryable and never leaks credentials', async () => {
    sink = await startSmtpSink({
      authOptional: false,
      allowInsecureAuth: true,
      onAuth: (auth, _s, cb) =>
        auth.username === 'pm' && auth.password === 'right-secret'
          ? cb(null, { user: 'pm' })
          : cb(smtpError('Invalid login for pm', 535)),
    });
    const bad = await mail(sink.port, {
      SMTP_USER: 'pm',
      SMTP_PASSWORD: 'super-secret-password',
    }).send(message());
    expect(bad).toMatchObject({ status: 'REJECTED', permanent: false });
    expect(JSON.stringify(bad)).not.toContain('super-secret-password');
    expect(JSON.stringify(bad)).not.toMatch(/\bpm\b/);

    const good = await mail(sink.port, { SMTP_USER: 'pm', SMTP_PASSWORD: 'right-secret' }).send(
      message(),
    );
    expect(good.status).toBe('ACCEPTED');
  });

  it('requires STARTTLS with certificate validation, and refuses an untrusted certificate', async () => {
    sink = await startSmtpSink(); // smtp-server offers STARTTLS with a self-signed certificate
    const strict = await mail(sink.port, {
      SMTP_SECURE: 'starttls',
      SMTP_ALLOW_INSECURE: 'false',
    }).send(message());
    expect(strict).toMatchObject({ status: 'REJECTED', permanent: false });
    expect(sink.received).toHaveLength(0);

    const devOnly = await mail(sink.port, {
      SMTP_SECURE: 'starttls',
      SMTP_ALLOW_INSECURE: 'true',
    }).send(message());
    expect(devOnly.status).toBe('ACCEPTED');
    expect(sink.sessions[0].secure).toBe(true); // upgraded to TLS before sending
  });

  it('refuses to send when STARTTLS is required but the server does not offer it', async () => {
    sink = await startSmtpSink({ disabledCommands: ['STARTTLS'] });
    const result = await mail(sink.port, {
      SMTP_SECURE: 'starttls',
      SMTP_ALLOW_INSECURE: 'true',
    }).send(message());
    expect(result).toMatchObject({ status: 'REJECTED', permanent: false });
    expect(sink.received).toHaveLength(0);
  });

  it('supports implicit TLS', async () => {
    sink = await startSmtpSink({ secure: true });
    const result = await mail(sink.port, { SMTP_SECURE: 'tls', SMTP_ALLOW_INSECURE: 'true' }).send(
      message(),
    );
    expect(result.status).toBe('ACCEPTED');
    expect(sink.sessions[0].secure).toBe(true);
  });

  it('is disabled (not failing at startup) when SMTP is not configured', async () => {
    const service = new MailService(testConfig({}));
    expect(service.isEnabled()).toBe(false);
    expect(await service.send(message())).toMatchObject({ status: 'REJECTED', permanent: false });
  });
});
