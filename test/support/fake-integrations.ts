import { createHash } from 'crypto';
import type { IssueContentModel } from '../../src/domain/publication/model/issue-content.model';
import {
  FileStorage,
  FileStorageError,
  StoredFileInfo,
} from '../../src/service/file-storage/file-storage';
import type {
  MailMessage,
  MailSendResult,
  MailTransport,
} from '../../src/service/mail/mail-transport';
import type { PdfRenderer } from '../../src/service/pdf/pdf-renderer';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Produces a small but structurally complete PDF whose body embeds the snapshot hash. */
export class FakePdfRenderer implements PdfRenderer {
  readonly rendered: IssueContentModel[] = [];
  failNext = 0;
  /** Extra padding bytes, to produce authentic but large PDFs. */
  padBytes = 0;

  render(content: IssueContentModel): Promise<Buffer> {
    this.rendered.push(structuredClone(content));
    if (this.failNext > 0) {
      this.failNext--;
      return Promise.reject(new Error('simulated renderer crash'));
    }
    const body = `%PDF-1.4\n% PaperMorning test ${content.issueDate} ${sha(Buffer.from(JSON.stringify(content)))}\n${'%'.repeat(this.padBytes)}\n%%EOF\n`;
    return Promise.resolve(Buffer.from(body, 'latin1'));
  }
}

export class InMemoryFileStorage implements FileStorage {
  readonly files = new Map<string, Buffer>();

  write(key: string, bytes: Buffer): Promise<StoredFileInfo> {
    this.files.set(key, Buffer.from(bytes));
    return Promise.resolve({ key, sizeBytes: bytes.length, sha256: sha(bytes) });
  }
  read(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    return file
      ? Promise.resolve(Buffer.from(file))
      : Promise.reject(new FileStorageError(`missing ${key}`, 'NOT_FOUND'));
  }
  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.files.has(key));
  }
}

export class FakeMailTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  enabled = true;
  results: MailSendResult[] = [];
  delayMs = 0;

  isEnabled(): boolean {
    return this.enabled;
  }
  async send(message: MailMessage): Promise<MailSendResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    this.sent.push(message);
    return (
      this.results.shift() ?? { status: 'ACCEPTED', messageId: `<msg-${this.sent.length}@test>` }
    );
  }
}
