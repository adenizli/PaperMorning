import { execFileSync } from 'child_process';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { PdfService } from '../../../src/service/pdf/pdf.service';
import { issueContentFixture, LONG_URL } from '../../fixtures/issue-content.fixture';
import { extractPdfText } from '../../support/pdf-text';
import { testConfig } from '../../support/test-config';

jest.setTimeout(120_000);

/** Chromium processes started by this Jest worker (children of this process). */
function childChromiumCount(): number {
  const out = execFileSync('ps', ['-A', '-o', 'ppid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => line.trim().startsWith(`${process.pid} `) && /chrom/i.test(line)).length;
}

const extract = (pdf: Buffer) => Promise.resolve(extractPdfText(pdf));

/** Real headless Chromium via Playwright (requires `npx playwright install chromium`). */
describe('PdfService (real Chromium)', () => {
  const service = (env: Record<string, string> = {}) => new PdfService(testConfig(env));

  it('renders a real multi-page PDF with Turkish text, clickable sources and the Ufuk Raporu last', async () => {
    const content = issueContentFixture();
    const pdf = await service().render(content);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-1024).toString('latin1')).toContain('%%EOF');
    const { text, pages } = await extract(pdf);
    expect(pages).toBeGreaterThanOrEqual(5);
    expect(text).toContain('ğüşıöç ĞÜŞİÖÇ');
    expect(text).toContain('Yalnızca özete dayalı analiz');
    expect(text).toContain('Ön baskı');
    const lastArticle = text.lastIndexOf(content.articles[3].headline);
    expect(lastArticle).toBeGreaterThan(0);
    expect(text.lastIndexOf('Ufuk Raporu')).toBeGreaterThan(lastArticle);
    expect(text.indexOf('Somut ilk adım')).toBeGreaterThan(lastArticle);

    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/\/URI \(https:\/\/arxiv\.org\/abs\/2611\.00001v1\)/);
    expect(raw).toContain('/URI (https://doi.org/10.1000/test.2)');
    expect(raw).toContain(
      encodeURI(LONG_URL)
        .slice(0, 40)
        .replace(/%C3%A7/g, '%C3%A7'),
    );
  });

  it('blocks every network and file request made by the document', async () => {
    let hits = 0;
    const server: Server = createServer((_req, res) => {
      hits++;
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="http://127.0.0.1:${port}/a.css"></head>
        <body><img src="http://127.0.0.1:${port}/b.png"><iframe src="file:///etc/passwd"></iframe>
        <script>fetch('http://127.0.0.1:${port}/c')</script><p>isolated</p></body></html>`;
      const pdf = await service().renderHtml(html);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(hits).toBe(0);
      expect((await extract(pdf)).text).not.toContain('root:');
    } finally {
      server.close();
    }
  });

  it('fails clearly on timeout and on oversized snapshots', async () => {
    await expect(service({ PDF_TIMEOUT_MS: '1' }).render(issueContentFixture())).rejects.toThrow(
      /exceeded 1 ms|PDF rendering failed/,
    );
    await expect(
      service({ PDF_MAX_SNAPSHOT_BYTES: '1024' }).render(issueContentFixture()),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('leaves no Chromium process behind after a timeout during launch', async () => {
    const pdfService = service({ PDF_TIMEOUT_MS: '1' });
    await expect(pdfService.render(issueContentFixture())).rejects.toThrow(/exceeded 1 ms/);
    // The slot is released only after the late-launched browser has been closed.
    const next = await service().renderHtml('<p>after timeout</p>');
    expect(next.subarray(0, 5).toString()).toBe('%PDF-');
    await new Promise((r) => setTimeout(r, 1500));
    await pdfService.renderHtml('<p>slot reusable</p>').catch(() => undefined);
    expect(childChromiumCount()).toBe(0);
  });

  it('serializes concurrent renders within the configured limit', async () => {
    const pdfService = service({ PDF_MAX_CONCURRENCY: '1' });
    const pdfs = await Promise.all(
      [1, 2, 3].map((n) => pdfService.render(issueContentFixture({ issueNumber: n }))),
    );
    expect(pdfs.every((p) => p.subarray(0, 5).toString() === '%PDF-')).toBe(true);
  });

  it('handles an issue with an empty outlook opportunity list and one article', async () => {
    const content = issueContentFixture();
    content.articles = content.articles.slice(0, 1);
    content.toc = [content.toc[0], content.toc.at(-1)!];
    content.outlook.academicOpportunities = [];
    content.outlook.insufficientEvidence.academic = 'Kanıt yetersiz.';
    const { text } = await extract(await service().render(content));
    expect(text).toContain('Kanıt sınırı: Kanıt yetersiz.');
  });
});
