import { AddressInfo } from 'net';
import { simpleParser, ParsedMail } from 'mailparser';
import {
  SMTPServer,
  SMTPServerOptions,
  SMTPServerDataStream,
  SMTPServerSession,
} from 'smtp-server';

export interface SmtpSink {
  port: number;
  received: ParsedMail[];
  sessions: SMTPServerSession[];
  close(): Promise<void>;
}

type DataHook = (
  raw: Buffer,
  session: SMTPServerSession,
  done: (err?: Error | null) => void,
) => void;

/** Real SMTP server on localhost for byte-level tests (never part of production). */
export async function startSmtpSink(
  options: Partial<SMTPServerOptions> & { onMessage?: DataHook } = {},
): Promise<SmtpSink> {
  const received: ParsedMail[] = [];
  const sessions: SMTPServerSession[] = [];
  const { onMessage, ...serverOptions } = options;
  const server = new SMTPServer({
    secure: false,
    authOptional: true,
    logger: false,
    ...serverOptions,
    onData(
      stream: SMTPServerDataStream,
      session: SMTPServerSession,
      callback: (err?: Error | null) => void,
    ) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks);
        sessions.push(session);
        void simpleParser(raw).then((mail) => {
          received.push(mail);
          if (onMessage) onMessage(raw, session, callback);
          else callback();
        });
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.server.address() as AddressInfo;
  return {
    port,
    received,
    sessions,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const smtpError = (message: string, responseCode: number) =>
  Object.assign(new Error(message), { responseCode });
