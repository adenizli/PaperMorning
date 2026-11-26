import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/** Extracts text and page count from real PDF bytes using pdf.js in a separate Node process. */
export function extractPdfText(pdf: Buffer): { text: string; pages: number } {
  const file = join(mkdtempSync(join(tmpdir(), 'pm-pdf-')), 'issue.pdf');
  writeFileSync(file, pdf);
  const output = execFileSync(process.execPath, [join(__dirname, 'extract-pdf-text.mjs'), file], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(output) as { text: string; pages: number };
}

export interface PdfInspection {
  pages: number;
  outline: { title: string; items: PdfInspection['outline'] }[];
  pageTexts: string[];
  links: string[][];
  png?: string[];
}

/** Page texts, bookmark tree and link URLs of real PDF bytes (pdf.js in a separate process). */
export function inspectPdf(pdf: Buffer, options: { pngDir?: string } = {}): PdfInspection {
  const file = join(mkdtempSync(join(tmpdir(), 'pm-pdf-')), 'issue.pdf');
  writeFileSync(file, pdf);
  const args = [join(__dirname, 'inspect-pdf.mjs'), file];
  if (options.pngDir) args.push('--png', options.pngDir);
  const output = execFileSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(output) as PdfInspection;
}
