// Runs outside Jest (pdf.js needs native dynamic import).
// Usage: node inspect-pdf.mjs <file.pdf> [--png <dir>]
// Prints JSON: page count, per-page text, PDF outline (bookmark tree) and per-page link URLs.
// With --png, also writes one PNG per page (for visual QA; uses pdf.js + @napi-rs/canvas).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFParse } from 'pdf-parse';

const [file, flag, pngDir] = process.argv.slice(2);
const parser = new PDFParse({ data: new Uint8Array(readFileSync(file)) });
const tree = (nodes) => (nodes ?? []).map((n) => ({ title: n.title, items: tree(n.items) }));
try {
  const info = await parser.getInfo({ parsePageInfo: true });
  const text = await parser.getText();
  const result = {
    pages: info.total,
    outline: tree(info.outline),
    pageTexts: text.pages.map((p) => p.text),
    links: info.pages.map((p) => p.links.map((l) => l.url)),
  };
  if (flag === '--png' && pngDir) {
    const shots = await parser.getScreenshot({
      scale: 1.4,
      imageBuffer: true,
      imageDataUrl: false,
    });
    result.png = shots.pages.map((p, i) => {
      const out = join(pngDir, `page-${String(i + 1).padStart(2, '0')}.png`);
      writeFileSync(out, Buffer.from(p.data));
      return out;
    });
  }
  process.stdout.write(JSON.stringify(result));
} finally {
  await parser.destroy();
}
