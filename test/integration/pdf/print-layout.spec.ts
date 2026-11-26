import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IssueContentModel } from '../../../src/domain/publication/model/issue-content.model';
import { PdfService } from '../../../src/service/pdf/pdf.service';
import { firstIssueLike, multiPaperV2, singlePaperV2 } from '../../fixtures/print-fixtures';
import { inspectPdf, PdfInspection } from '../../support/pdf-text';
import { testConfig } from '../../support/test-config';

jest.setTimeout(180_000);

/**
 * issue-print-v2 on real Chromium: page counts, bookmarks, links and Turkish text for one-, two-
 * and multi-paper issues. Set PM_PRINT_QA_DIR to also keep each PDF and per-page PNGs for visual
 * inspection.
 */
describe('print layout (real Chromium, issue-print-v2)', () => {
  const service = new PdfService(testConfig());
  const qaDir = process.env.PM_PRINT_QA_DIR;

  async function render(name: string, content: IssueContentModel): Promise<PdfInspection> {
    const pdf = await service.render(content);
    let pngDir: string | undefined;
    if (qaDir) {
      pngDir = join(qaDir, name);
      mkdirSync(pngDir, { recursive: true });
      writeFileSync(join(qaDir, `${name}.pdf`), pdf);
    }
    const doc = inspectPdf(pdf, { pngDir });
    rendered.push(doc);
    return doc;
  }

  const pageOf = (doc: PdfInspection, needle: string) =>
    doc.pageTexts.findIndex((t) => t.replace(/\s+/g, ' ').includes(needle)) + 1;
  const titles = (nodes: PdfInspection['outline']): string[] =>
    nodes.flatMap((n) => [n.title, ...titles(n.items)]);
  /** Chromium on Linux repeats titles of headings layout moved to the next page (repaired). */
  const repeated = (doc: PdfInspection) =>
    titles(doc.outline).filter((t) => {
      for (let n = 2; n <= 4; n++) {
        const unit = t.length / n;
        if (Number.isInteger(unit) && unit > 0 && t === t.slice(0, unit).repeat(n)) return true;
      }
      return false;
    });

  afterEach(() => {
    for (const doc of rendered.splice(0)) expect(repeated(doc)).toEqual([]);
  });
  const rendered: PdfInspection[] = [];

  it('one paper (first-issue volume, v1 snapshot): a compact briefing instead of nine pages', async () => {
    const content = firstIssueLike();
    const doc = await render('single-v1-first-issue-volume', content);
    expect(doc.pages).toBeGreaterThanOrEqual(3);
    expect(doc.pages).toBeLessThanOrEqual(6);
    const article = content.articles[0];
    // Masthead, headline and source card share page 1: no cover page, no contents page.
    expect(pageOf(doc, 'PaperMorning')).toBe(1);
    expect(pageOf(doc, 'Araştırma brifingi')).toBe(1);
    expect(pageOf(doc, 'Kaynak:')).toBe(1);
    expect(doc.pageTexts.join('\n')).not.toContain('İçindekiler');
    expect(doc.links[0]).toEqual(
      expect.arrayContaining(article.source.references.map((r) => r.url)),
    );
    // The report follows the article without a forced break onto an otherwise empty page.
    expect(pageOf(doc, 'Ufuk Raporu')).toBeLessThanOrEqual(doc.pages);
    expect(pageOf(doc, 'Somut ilk adım')).toBe(doc.pages);
  });

  it('one paper (v2): compact report, Turkish text intact, clean bookmarks', async () => {
    const content = singlePaperV2();
    const doc = await render('single-v2', content);
    expect(doc.pages).toBeGreaterThanOrEqual(3);
    expect(doc.pages).toBeLessThanOrEqual(5);
    const text = doc.pageTexts.join('\n');
    // Every Turkish letter used in the snapshot survives into the PDF's text layer.
    const used = [...new Set(JSON.stringify(content).match(/[çğıöşüÇĞİÖŞÜ]/g))];
    expect(used.length).toBeGreaterThanOrEqual(10);
    for (const letter of used) expect(text).toContain(letter);
    expect(text).toContain('Kaynakta belirtilmeyenler'.toLocaleUpperCase('tr-TR'));
    expect(text).toContain('Bu çalışmanın değerlendirmesi');
    // Bookmarks: brand > [headline > sections, report > subsections]; no duplicates per level.
    expect(doc.outline.map((n) => n.title)).toEqual(['PaperMorning']);
    const level2 = doc.outline[0].items.map((n) => n.title);
    expect(level2).toEqual([content.articles[0].headline, content.outlook.title]);
    expect(doc.outline[0].items[0].items.map((n) => n.title)).toEqual(
      content.articles[0].sections.map((s) => s.heading),
    );
    for (const node of doc.outline[0].items) {
      const names = node.items.map((n) => n.title);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(titles(doc.outline).every((t) => t.trim().length > 0 && !/[<>&]/.test(t))).toBe(true);
  });

  it('two papers: magazine cover with inline contents, both articles, report last', async () => {
    const content = multiPaperV2(2);
    const doc = await render('multi-2', content);
    expect(doc.pages).toBeGreaterThanOrEqual(4);
    expect(doc.pages).toBeLessThanOrEqual(8);
    expect(pageOf(doc, 'BU SAYIDA')).toBe(1);
    // Headlines also appear in the cover's contents list; look for each article from page 2 on.
    const headlines = content.articles.map(
      (a) =>
        doc.pageTexts.findIndex(
          (t, i) => i > 0 && t.replace(/\s+/g, ' ').includes(a.headline.slice(0, 30)),
        ) + 1,
    );
    expect(headlines.every((p) => p >= 2)).toBe(true);
    expect(pageOf(doc, 'Uyuşmalar ve ayrışmalar')).toBeGreaterThan(Math.max(...headlines));
    expect(doc.outline[0].items.map((n) => n.title)).toEqual([
      ...content.articles.map((a) => a.headline),
      content.outlook.title,
    ]);
  });

  it('six papers: features, two-column briefs and a single bookmark per article', async () => {
    const content = multiPaperV2(6);
    const doc = await render('multi-6', content);
    expect(doc.pages).toBeGreaterThanOrEqual(6);
    expect(doc.pages).toBeLessThanOrEqual(14);
    const level2 = doc.outline[0].items.map((n) => n.title);
    expect(level2).toEqual([
      ...content.articles.filter((a) => a.role !== 'BRIEF').map((a) => a.headline),
      'Kısa haberler',
      content.outlook.title,
    ]);
    const briefs = doc.outline[0].items.find((n) => n.title === 'Kısa haberler')!;
    expect(briefs.items.map((n) => n.title)).toEqual(
      content.articles.filter((a) => a.role === 'BRIEF').map((a) => a.headline),
    );
    const allLinks = doc.links.flat();
    for (const article of content.articles) {
      for (const ref of article.source.references) expect(allLinks).toContain(ref.url);
    }
  });
});
