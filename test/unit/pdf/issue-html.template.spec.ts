import { renderIssueHtml } from '../../../src/service/pdf/issue-html.template';
import { issueContentFixture, LONG_URL } from '../../fixtures/issue-content.fixture';

describe('renderIssueHtml', () => {
  it('renders cover, TOC, all articles and the Ufuk Raporu as the last section', () => {
    const content = issueContentFixture();
    const html = renderIssueHtml(content);
    const positions = content.articles.map((a) => html.indexOf(`id="${a.key}"`));
    const outlook = html.indexOf('id="outlook"');
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(outlook).toBeGreaterThan(Math.max(...positions));
    expect(html.indexOf('<section', outlook + 1)).toBe(-1);
    expect(html.indexOf('<article', outlook)).toBe(-1);
    expect(html).toContain('İçindekiler');
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
});
