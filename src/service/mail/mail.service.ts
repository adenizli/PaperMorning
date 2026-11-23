import { Injectable, Logger } from '@nestjs/common';
import { format } from 'util';
import * as nodemailer from 'nodemailer';
import { AppConfig } from '../../config/app.config';
import { MailMessage, MailSendResult, MailTransport } from './mail-transport';

/** Codes meaning the message itself or its envelope is unacceptable: retrying cannot help. */
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE', 'EMAXRECIPIENTS']);
/** Authentication / TLS setup failures: the message was never handed over. */
const CONFIGURATION_CODES = new Set(['EAUTH', 'ENOAUTH', 'ETLS', 'EREQUIRETLS']);

/** The parts of Nodemailer's SMTP send result this adapter relies on. */
interface SmtpSendInfo {
  messageId?: string;
  rejected?: unknown[];
  response?: string;
}

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  command?: string;
}

/**
 * Self-hosted SMTP transport (Nodemailer). Owns SMTP configuration, TLS, timeouts, MIME and
 * result classification only; recipients, opt-in and delivery state belong to DeliveryService.
 *
 * Classification: a definitive SMTP reply (4xx/5xx) is REJECTED (temporary or permanent). A lost
 * connection or timeout before the server's 354 (go ahead with DATA) means nothing was handed over
 * (REJECTED, temporary). The same failure after 354 may already have been accepted: UNKNOWN.
 */
@Injectable()
export class MailService implements MailTransport {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: AppConfig) {}

  isEnabled(): boolean {
    return this.config.mail.enabled;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.isEnabled())
      return { status: 'REJECTED', permanent: false, reason: 'SMTP is not configured' };
    const stage = { dataSent: false };
    const transport = this.createTransport(stage);
    try {
      const info = (await transport.sendMail({
        from: this.config.mail.from,
        replyTo: this.config.mail.replyTo,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      })) as SmtpSendInfo;
      const rejected = (info.rejected ?? []).map(String);
      if (rejected.length > 0) {
        return {
          status: 'REJECTED',
          permanent: true,
          reason: `Recipient rejected: ${this.sanitize(info.response ?? '')}`,
        };
      }
      return { status: 'ACCEPTED', messageId: info.messageId ?? null };
    } catch (error) {
      const result = this.classify(error as SmtpError, stage.dataSent);
      this.logger.warn(`SMTP send ${result.status}: ${result.reason}`);
      return result;
    } finally {
      transport.close();
    }
  }

  private classify(
    error: SmtpError,
    dataSent: boolean,
  ): Exclude<MailSendResult, { status: 'ACCEPTED' }> {
    const reason = this.sanitize(
      `${error.code ?? 'ERROR'}${error.responseCode ? ` ${error.responseCode}` : ''}: ${error.message}`,
    );
    // Bad credentials or TLS negotiation failures are operator configuration problems: nothing was
    // sent, and a retry is reasonable once the configuration is fixed.
    if (error.code && CONFIGURATION_CODES.has(error.code)) {
      return { status: 'REJECTED', permanent: false, reason };
    }
    if (error.responseCode && error.responseCode >= 500)
      return { status: 'REJECTED', permanent: true, reason };
    if (error.responseCode && error.responseCode >= 400)
      return { status: 'REJECTED', permanent: false, reason };
    if (error.code && PERMANENT_CODES.has(error.code))
      return { status: 'REJECTED', permanent: true, reason };
    if (dataSent)
      return {
        status: 'UNKNOWN',
        reason: `Connection failed after the message was transmitted: ${reason}`,
      };
    return { status: 'REJECTED', permanent: false, reason };
  }

  /** Never let credentials reach logs or the delivery record. */
  private sanitize(text: string): string {
    let clean = text;
    for (const secret of [this.config.mail.password, this.config.mail.user]) {
      if (secret) clean = clean.split(secret).join('***');
    }
    return clean.slice(0, 500);
  }

  private createTransport(stage: { dataSent: boolean }) {
    const { mail } = this.config;
    const noop = () => undefined;
    const protocolLogger = {
      level: noop,
      trace: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
      // Nodemailer pipelines MAIL FROM / RCPT TO / DATA, so the DATA command alone proves nothing.
      // The server's 354 reply is the point after which the message body is handed over.
      debug: (meta: { tnx?: string } | undefined, message: string, ...args: unknown[]) => {
        if (meta?.tnx === 'server' && /^354\b/.test(format(message, ...args).trim())) {
          stage.dataSent = true;
        }
      },
    };
    return nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.security === 'tls',
      requireTLS: mail.security === 'starttls',
      ignoreTLS: mail.security === 'none',
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
      tls: {
        rejectUnauthorized: !mail.allowInsecure,
        minVersion: 'TLSv1.2',
        servername: mail.host,
      },
      connectionTimeout: mail.connectionTimeoutMs,
      greetingTimeout: mail.connectionTimeoutMs,
      socketTimeout: mail.socketTimeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
      transactionLog: true,
      logger: protocolLogger,
    } as unknown as Parameters<typeof nodemailer.createTransport>[0]);
  }
}
