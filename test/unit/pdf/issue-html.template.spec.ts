import { renderIssueHtml } from '../../../src/service/pdf/issue-html.template';
import { issueContentFixture, LONG_URL } from '../../fixtures/issue-content.fixture';

describe('renderIssueHtml', () => {
  it('renders cover, contents, all articles and the Ufuk Raporu as the last section', () => {
    const content = issueContentFixture();
    const html = renderIssueHtml(content);
    const positions = content.articles.map((a) => html.indexOf(`id="${a.key}"`));
    const outlook = html.indexOf('id="outlook"');
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(outlook).toBeGreaterThan(Math.max(...positions));
    expect(html.indexOf('<section', outlook + 1)).toBe(-1);
    expect(html.indexOf('<article', outlook)).toBe(-1);
    // Contents live on the cover ("Bu sayıda"); there is no separate, mostly empty contents page.
    expect(html).toContain('aria-label="Bu sayıda"');
    expect(html).not.toContain('İçindekiler');
    expect(html).toContain('Sayı 7 · 2026-11-24');
  });

  it('labels review status, abstract-only coverage and evidence vs inference vs proposal', () => {
    const html = renderIssueHtml(issueContentFixture());
    expect(html).toContain('Ön baskı — hakem değerlendirmesinden geçmemiş');
    expect(html).toContain('Hakemli yayın');
    expect(html).toContain('Yalnızca özete dayalı analiz');
    expect(html).toContain('class="label evidence">Kaynak bulgusu');
    expect(html).toContain('class="label inference">Yorum / hipotez');
    expect(html).toContain('class="label proposal">Önerilen deney');
    expect(html).toContain('class="label proposal">Önerilen pilot');
    expect(html).toContain('[P1, P2]');
  });

  it('escapes model text and drops non-http links; references no external resources', () => {
    const content = issueContentFixture();
    content.articles[0].headline = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    content.articles[0].source.references.push({
      kind: 'LANDING',
      label: 'evil',
      url: 'javascript:alert(1)',
    });
    content.articles[0].source.references.push({
      kind: 'LANDING',
      label: 'local',
      url: 'file:///etc/passwd',
    });
    const html = renderIssueHtml(content);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<(script|img|link|iframe)\b/);
    expect(html).not.toMatch(/href="(javascript|file):/);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).toContain(new URL(LONG_URL).toString().replace(/&/g, '&amp;'));
  });

  it('shows honest evidence gaps instead of empty opportunity sections', () => {
    const content = issueContentFixture();
    content.outlook.industryOpportunities = [];
    content.outlook.insufficientEvidence.industry = 'Sektör pilotu için kanıt yetersiz.';
    const html = renderIssueHtml(content);
    expect(html).toContain('Kanıt sınırı: Sektör pilotu için kanıt yetersiz.');
    expect(html).toContain('Bu sayıda yeterli kanıt yok.');
  });

  describe('issue-print-v3 adaptive layout', () => {
    const single = () => {
      const content = issueContentFixture();
      content.articles = [content.articles[0]];
      content.toc = [content.toc[0], content.toc[content.toc.length - 1]];
      content.outlook.synthesis.paperKeys = ['P1'];
      content.outlook.inferences = [{ statement: 'Tek çalışmanın yorumu.', paperKeys: ['P1'] }];
      content.outlook.industryOpportunities[0].paperKeys = ['P1'];
      return content;
    };
    const headings = (html: string) =>
      [...html.matchAll(/<h([1-4])\b[^>]*>(.*?)<\/h\1>/g)].map((m) => `h${m[1]}:${m[2]}`);

    it('renders a one-paper issue as a compact briefing: no cover page, no contents page', () => {
      const html = renderIssueHtml(single());
      expect(html).toContain('<body class="briefing">');
      expect(html).not.toContain('class="cover"');
      expect(html).not.toContain('aria-label="Bu sayıda"');
      expect(html).toContain('Araştırma brifingi');
      expect(html).toContain('class="outlook mode-single"');
      expect(html).toContain('Bu çalışmanın değerlendirmesi:');
      expect(html).not.toContain('Bu sayının ortak sonucu:');
    });

    it('keeps the source card with its article: directly under the headline, before the text', () => {
      const html = renderIssueHtml(single());
      const headline = html.indexOf('class="headline"');
      const source = html.indexOf('class="source-card"');
      const firstSection = html.indexOf('class="sec"');
      expect(headline).toBeGreaterThan(0);
      expect(source).toBeGreaterThan(headline);
      expect(source).toBeLessThan(firstSection);
      expect(html).toContain('href="https://arxiv.org/abs/2611.00001v1"');
    });

    it('marks up exactly one heading per outline entry (no duplicated cover headline)', () => {
      const content = issueContentFixture();
      const list = headings(renderIssueHtml(content));
      expect(list.filter((h) => h.startsWith('h1:'))).toEqual(['h1:PaperMorning']);
      const h2 = list.filter((h) => h.startsWith('h2:'));
      expect(h2).toEqual([
        ...content.articles.filter((a) => a.role !== 'BRIEF').map((a) => `h2:${a.headline}`),
        'h2:Kısa haberler',
        `h2:${content.outlook.title}`,
      ]);
      expect(new Set(h2).size).toBe(h2.length);
      // Briefs nest under "Kısa haberler".
      for (const brief of content.articles.filter((a) => a.role === 'BRIEF')) {
        expect(list).toContain(`h3:${brief.headline}`);
      }
    });

    it('uses page breaks only between major magazine parts', () => {
      const html = renderIssueHtml(issueContentFixture());
      expect(html).toContain('<body class="magazine">');
      expect(html).not.toMatch(/\.section\s*\{[^}]*break-inside:\s*avoid-page/);
      expect(html).toMatch(/p \{[^}]*orphans: 2; widows: 2;/);
      // Only the cover story and the report force a new page in the magazine layout.
      expect(html.match(/break-before: page/g)).toHaveLength(2);
    });

    it('shows the "not reported" box and cross-study contrasts only where they exist', () => {
      const content = issueContentFixture();
      content.articles[0].notReported = ['Kalan bir kombinasyonun sonucu özette belirtilmiyor.'];
      content.outlook.mode = 'CROSS_STUDY';
      content.outlook.contrasts = [{ statement: 'İki çalışma uyuşuyor.', paperKeys: ['P1', 'P2'] }];
      const html = renderIssueHtml(content);
      expect(html).toContain('Özette belirtilmeyenler');
      expect(html).toContain('Kalan bir kombinasyonun sonucu özette belirtilmiyor.');
      expect(html).toContain('Uyuşmalar ve ayrışmalar');
      const one = single();
      one.outlook.mode = 'SINGLE_STUDY';
      one.outlook.contrasts = [{ statement: 'Görünmemeli.', paperKeys: ['P1', 'P2'] }];
      const singleHtml = renderIssueHtml(one);
      expect(singleHtml).not.toContain('Uyuşmalar ve ayrışmalar');
      expect(singleHtml).not.toContain('Özette belirtilmeyenler');
    });

    it('still renders v1 snapshots (no mode, no contrasts, no notReported)', () => {
      const v1 = issueContentFixture({ schemaVersion: 1 });
      delete v1.outlook.mode;
      delete v1.outlook.contrasts;
      expect(() => renderIssueHtml(v1)).not.toThrow();
      expect(renderIssueHtml(v1)).toContain('class="outlook mode-cross"');
    });

    it('marks a QA preview visibly and escapes its note', () => {
      const html = renderIssueHtml(single(), { preview: { note: 'QA <önizleme>' } });
      expect(html).toContain('class="preview-banner"');
      expect(html).toContain('QA &lt;önizleme&gt;');
      expect(renderIssueHtml(single())).not.toContain('class="preview-banner"');
    });
  });
});
