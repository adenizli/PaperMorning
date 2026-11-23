// Runs outside Jest (pdf.js needs native dynamic import). Usage: node extract-pdf-text.mjs <file.pdf>
import { readFileSync } from 'node:fs';
import { PDFParse } from 'pdf-parse';

const parser = new PDFParse({ data: new Uint8Array(readFileSync(process.argv[2])) });
try {
  const result = await parser.getText();
  process.stdout.write(JSON.stringify({ text: result.text, pages: result.total }));
} finally {
  await parser.destroy();
}
