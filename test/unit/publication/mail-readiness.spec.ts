import {
  isSingleAddress,
  MAIL_TEST_ATTACHMENT,
  MAIL_TEST_MARKER,
  mailTestMessage,
} from '../../../src/bootstrap/mail-test';
import type { IssueContentModel } from '../../../src/domain/publication';
import { digestSubject, turkishDate } from '../../../src/domain/publication/service/issue-digest';

describe('email subject and operator test message', () => {
  const content = (headline: string, issueDate = '2026-11-28') =>
    ({ issueDate, cover: { headline, dek: '', articleKey: 'a1' } }) as unknown as IssueContentModel;

  it('formats Turkish dates without locale data', () => {
    expect(turkishDate('2026-11-28')).toBe('28 Kasım 2026');
    expect(turkishDate('2027-02-01')).toBe('1 Şubat 2027');
    expect(turkishDate('2027-08-09')).toBe('9 Ağustos 2027');
  });

  it('puts the date and the cover headline (with Turkish letters) in the subject', () => {
    expect(digestSubject(content('Dil modelleri 3B kavramada zorlanıyor'))).toBe(
      'PaperMorning · 28 Kasım 2026 — Dil modelleri 3B kavramada zorlanıyor',
    );
  });

  it('keeps the subject on one line and bounded', () => {
    const subject = digestSubject(content(`Çok\nuzun ${'başlık '.repeat(30)}`));
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual('PaperMorning · 28 Kasım 2026 — '.length + 90);
    expect(subject.endsWith('…')).toBe(true);
  });

  it('builds a clearly labelled test message with Turkish text and the PDF attached', () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
    const message = mailTestMessage('operator@example.org', pdf);
    expect(message.to).toBe('operator@example.org');
    expect(message.subject).toContain(MAIL_TEST_MARKER);
    expect(message.text).toContain(MAIL_TEST_MARKER);
    expect(message.text).toContain('yayımlanmış bir sayı değildir');
    expect(message.attachments).toEqual([
      { filename: MAIL_TEST_ATTACHMENT, contentType: 'application/pdf', content: pdf },
    ]);
  });

  it.each([
    ['operator@example.org', true],
    ['a.b+c@mail.example.co', true],
    ['', false],
    [undefined, false],
    ['two@example.org,three@example.org', false],
    ['Name <x@example.org>', false],
    ['x@example.org\r\nBcc: y@example.org', false],
    ['no-at-sign.example.org', false],
  ])('single explicit recipient: %j -> %s', (value, ok) => {
    expect(isSingleAddress(value)).toBe(ok);
  });
});
