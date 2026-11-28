import type { MailMessage } from '../service/mail/mail-transport';

/** Turkish letters that must survive subject (RFC 2047), body (UTF-8) and the PDF attachment. */
export const MAIL_TEST_MARKER = 'çğıöşü ÇĞİÖŞÜ';
export const MAIL_TEST_SUBJECT = `PaperMorning SMTP testi — ${MAIL_TEST_MARKER}`;
export const MAIL_TEST_ATTACHMENT = 'PaperMorning-SMTP-testi.pdf';

/** A plain, clearly labelled operator test message; it carries no issue and no reader data. */
export function mailTestMessage(to: string, pdf: Buffer): MailMessage {
  const lines = [
    'Bu bir PaperMorning SMTP deneme iletisidir.',
    `Türkçe karakter denetimi: ${MAIL_TEST_MARKER}`,
    `Ekteki PDF (${MAIL_TEST_ATTACHMENT}) yapay bir test belgesidir; yayımlanmış bir sayı değildir.`,
    'Hiçbir okur kaydı, sayı veya teslim durumu değiştirilmedi.',
  ];
  return {
    to,
    subject: MAIL_TEST_SUBJECT,
    text: lines.join('\n'),
    html: `<!doctype html><html lang="tr"><head><meta charset="utf-8"></head><body>${lines
      .map((l) => `<p>${l}</p>`)
      .join('')}</body></html>`,
    attachments: [{ filename: MAIL_TEST_ATTACHMENT, contentType: 'application/pdf', content: pdf }],
  };
}

/** One explicit recipient; no lists, no display names, no header injection. */
export function isSingleAddress(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(value));
}
