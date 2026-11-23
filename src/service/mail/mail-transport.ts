export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: MailAttachment[];
}

/**
 * ACCEPTED: the SMTP server accepted the message (not proof of inbox delivery).
 * REJECTED: definitively not accepted; `permanent` says whether a retry could help.
 * UNKNOWN: the outcome cannot be known (e.g. connection lost after DATA); never auto-resend.
 */
export type MailSendResult =
  | { status: 'ACCEPTED'; messageId: string | null }
  | { status: 'REJECTED'; permanent: boolean; reason: string }
  | { status: 'UNKNOWN'; reason: string };

export interface MailTransport {
  isEnabled(): boolean;
  send(message: MailMessage): Promise<MailSendResult>;
}
