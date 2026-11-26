import { ContentCoverage, PublicationStatus } from '../../common/enum/research.enum';
import { escapeHtml, safeHttpUrl } from '../../common/text/escape-html';
import type {
  IssueArticle,
  IssueContentModel,
} from '../../domain/publication/model/issue-content.model';
import type {
  OutlookClaim,
  OutlookMode,
  OutlookReportModel,
} from '../../domain/publication/model/outlook-report.model';

/**
 * issue-print-v2: adaptive layout.
 * - One article: compact research briefing (masthead strip, no cover page, no contents page, the
 *   Ufuk Raporu follows the article without a forced page break).
 * - Two or more: magazine (cover page with an inline "Bu sayıda" list, the cover story from a
 *   new page, features and two-column briefs flowing with strong separators, the Ufuk Raporu
 *   from a new page).
 * Source metadata and links sit directly under each headline so they never end up alone on a
 * page. Only small boxes avoid page breaks; long text flows (orphans/widows 2, headings kept with
 * the following text). The heading hierarchy (h1 brand > h2 articles/report > h3 sections) is what
 * Chromium turns into PDF bookmarks, so nothing decorative is marked up as a heading.
 */
export const ISSUE_TEMPLATE_VERSION = 'issue-print-v2';

export interface RenderIssueOptions {
  /** QA preview of an existing snapshot: visibly marked, never a published issue. */
  preview?: { note: string };
}

const STATUS: Record<PublicationStatus, string> = {
  [PublicationStatus.PREPRINT]: 'Ön baskı — hakem değerlendirmesinden geçmemiş',
  [PublicationStatus.PEER_REVIEWED]: 'Hakemli yayın',
  [PublicationStatus.UNKNOWN]: 'Yayın durumu bilinmiyor',
};
const ROLE: Record<IssueArticle['role'], string> = {
  COVER: 'Kapak dosyası',
  FEATURE: 'Dosya',
  BRIEF: 'Kısa haber',
};
const MATURITY: Record<string, string> = {
  RESEARCH: 'Araştırma aşaması',
  EARLY_PROTOTYPE: 'Erken prototip',
  FIELD_TESTED: 'Sahada sınanmış',
};
const SECTION_FALLBACK: Record<string, string> = {
  problem: 'Problem',
  before: 'Önceki durum',
  new: 'Yenilik',
  evidence: 'Kanıt',
  limits: 'Sınırlar',
};

const e = escapeHtml;
const list = (items: string[], cls = '') =>
  items.length
    ? `<ul${cls ? ` class="${cls}"` : ''}>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`
    : '';
const cites = (keys: string[]) => `<span class="cite">[${keys.map(e).join(', ')}]</span>`;
const link = (url: string, label: string) => {
  const safe = safeHttpUrl(url);
  return safe
    ? `<a href="${e(safe)}">${e(label)}</a> <span class="url">${e(safe)}</span>`
    : e(label);
};
/** Model text may contain line breaks: each non-empty line becomes its own paragraph. */
const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${e(p)}</p>`)
    .join('');

const CSS = `
@page { size: A4; margin: 16mm 16mm 18mm 16mm; }
:root {
  --ink: #16181d; --muted: #59606e; --rule: #d8d2c8; --paper-tint: #f7f3ec;
  --accent: #a4520a; --blue: #0b4f8a; --blue-tint: #eef3f8;
  --green: #2e6b34; --purple: #5e2a84;
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Noto Serif', 'DejaVu Serif', Georgia, 'Times New Roman', serif; font-size: 10pt;
  line-height: 1.45; color: var(--ink); margin: 0; overflow-wrap: break-word; }
h1, h2, h3, h4, .sans, .kicker, .label, .badge, .box-title, .issue-line, .cite, dt {
  font-family: 'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif; }
/* pre-wrap: Chromium builds PDF bookmark titles from the laid-out heading text and drops the
   space at each line wrap ("drone uçuşunda" -> "droneuçuşunda") unless spaces are preserved. */
h1, h2, h3, h4 { line-height: 1.2; margin: 0; break-after: avoid; page-break-after: avoid; white-space: pre-wrap; }
h2 { font-size: 17pt; margin: 1mm 0 2mm; letter-spacing: -0.2pt; }
h3 { font-size: 11pt; margin: 4mm 0 1.2mm; color: #222; }
h4 { font-size: 10pt; margin: 3mm 0 1mm; }
p { margin: 0 0 2mm; orphans: 2; widows: 2; }
ul { margin: 0 0 2mm; padding-left: 4.5mm; }
li { margin: 0.5mm 0; orphans: 2; widows: 2; }
a { color: var(--blue); text-decoration: none; }
.url { display: block; font-size: 7.5pt; color: var(--muted); overflow-wrap: anywhere; word-break: break-all; }
.kicker { text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.9pt; color: var(--accent); font-weight: 600; }
.cite { font-size: 7.5pt; color: var(--muted); white-space: nowrap; }
.preview-banner { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 8.5pt; font-weight: 700;
  color: #7a1010; border: 1.5pt dashed #b02020; padding: 2mm 3mm; margin-bottom: 4mm; }

/* Masthead: a compact strip for briefings, the top of the cover for magazines. */
.masthead { display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 2.5pt solid var(--accent); padding-bottom: 1.5mm; margin-bottom: 4mm; }
.brand { font-size: 22pt; letter-spacing: -0.6pt; }
.issue-line { font-size: 8.5pt; color: var(--muted); text-align: right; }
.notes { font-size: 8pt; color: var(--muted); }
.notes p { margin: 0 0 0.8mm; }
.briefing-notes { border-bottom: 0.5pt solid var(--rule); padding-bottom: 2mm; margin-bottom: 4mm; }

/* Magazine cover */
.cover { break-after: page; }
.cover .masthead { margin-bottom: 14mm; }
.cover .brand { font-size: 38pt; letter-spacing: -1pt; }
.cover-story { border-left: 3pt solid var(--accent); padding-left: 5mm; margin-bottom: 8mm; }
.cover-headline { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-weight: 700; font-size: 24pt;
  line-height: 1.15; margin: 2mm 0 3mm; }
.cover-dek { font-size: 13pt; color: #333; }
.intro { font-size: 11pt; margin-bottom: 8mm; }
.contents { border-top: 0.75pt solid var(--rule); padding-top: 3mm; margin-bottom: 8mm; }
.contents ol { list-style: none; padding: 0; margin: 0; }
.contents li { display: flex; gap: 3mm; padding: 1.6mm 0; border-bottom: 0.5pt dotted var(--rule); }
.contents .c-role { flex: 0 0 26mm; font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 7.5pt;
  text-transform: uppercase; letter-spacing: 0.6pt; color: var(--accent); padding-top: 0.6mm; }
.contents a { color: var(--ink); }
.box-title { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7pt;
  color: var(--muted); margin-bottom: 1mm; }

/* Articles */
.article-head { break-inside: avoid; }
.dek { font-size: 11.5pt; color: #333; line-height: 1.35; margin-bottom: 3mm; }
.source-card { font-size: 8.5pt; line-height: 1.35; background: var(--paper-tint); border-left: 2pt solid var(--rule);
  padding: 2mm 3mm; margin: 0 0 3mm; break-inside: avoid; }
.source-card p { margin: 0 0 1mm; }
.source-card ul { list-style: none; padding: 0; margin: 1mm 0 0; }
.badges { margin-bottom: 1mm; }
.badge { display: inline-block; font-size: 7pt; padding: 0.3mm 1.6mm; border: 0.75pt solid #8a8a8a;
  border-radius: 1.5mm; margin: 0 1.5mm 0.8mm 0; }
.why { background: #fbf6ee; border-left: 3pt solid var(--accent); padding: 2mm 3.5mm; margin: 0 0 3mm;
  break-inside: avoid; }
.why p { margin: 0; }
.sec h3 { margin-top: 3.5mm; }
.unknowns { border: 0.75pt solid var(--rule); padding: 2mm 3mm; margin: 3mm 0; font-size: 9pt; break-inside: avoid; }
.unknowns ul { margin: 0; }
.glossary { font-size: 8.5pt; margin: 3mm 0 0; }
.glossary dl { margin: 0; column-count: 2; column-gap: 6mm; }
.glossary dt { font-weight: 700; break-after: avoid; }
.glossary dd { margin: 0 0 1.5mm; break-inside: avoid; }
/* Only the cover story starts a new page; features and briefs flow with a strong separator, so a
   few overflowing lines never leave a mostly empty page behind. */
.magazine .article.role-cover { break-before: page; }
.magazine .article.role-feature, .briefs { margin-top: 9mm; border-top: 2.5pt solid var(--accent); padding-top: 4mm; }
/* No text-transform on headings: it would leak into the PDF bookmark titles. */
.briefs > h2 { font-size: 13pt; letter-spacing: 0.4pt; color: var(--accent);
  margin-bottom: 3mm; }
.brief-list { column-count: 2; column-gap: 7mm; column-rule: 0.5pt solid var(--rule); }
.article.role-brief { font-size: 9.2pt; margin-bottom: 5mm; }
.article.role-brief h3.headline { font-size: 12pt; margin: 1mm 0 1.5mm; }
.article.role-brief .dek { font-size: 10pt; }
.article.role-brief h4 { font-size: 9.2pt; margin-top: 2mm; }
.article + .article.role-brief { border-top: 0.75pt solid var(--rule); padding-top: 3mm; }

/* Ufuk Raporu */
.outlook { border-top: 4pt solid var(--blue); padding-top: 4mm; }
.outlook.mode-single { margin-top: 7mm; }
.magazine .outlook { break-before: page; }
.outlook .kicker { color: var(--blue); }
.outlook-head { break-inside: avoid; }
.outlook-sub { color: var(--muted); font-size: 9pt; margin-bottom: 3mm; }
.synth { background: var(--blue-tint); padding: 2.5mm 3.5mm; margin-bottom: 2mm; break-inside: avoid; }
.label { display: inline-block; font-size: 7pt; font-weight: 700; letter-spacing: 0.3pt; padding: 0.3mm 1.6mm;
  border-radius: 1.2mm; color: #fff; margin-right: 1mm; vertical-align: 0.3mm; }
.label.evidence { background: var(--green); } .label.inference { background: var(--purple); }
.label.proposal { background: var(--accent); }
.claims { list-style: none; padding: 0; }
.claims li { margin: 0 0 1.6mm; break-inside: avoid; }
.gap { font-style: italic; color: var(--muted); font-size: 9pt; margin: 1mm 0 2mm; }
.card { border: 0.75pt solid var(--rule); border-radius: 1.5mm; padding: 2.5mm 3.5mm; margin: 0 0 2.5mm; break-inside: avoid; }
.card-head { margin-bottom: 1.2mm; }
.facts { display: grid; grid-template-columns: 25mm 1fr; column-gap: 3mm; row-gap: 0.8mm; margin: 0; font-size: 9pt; }
.facts dt { font-size: 7.5pt; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4pt; padding-top: 0.5mm; }
.facts dd { margin: 0; }
.dev-lists { display: flex; gap: 6mm; font-size: 9pt; }
.dev-lists > div { flex: 1; }
.next { border: 1.25pt solid var(--accent); padding: 2.5mm 3.5mm; break-inside: avoid; }
`;

function sourceCard(a: IssueArticle): string {
  const authors =
    a.source.authors.slice(0, 6).join(', ') + (a.source.authors.length > 6 ? ' ve diğerleri' : '');
  const meta = [authors, a.source.publishedAt, a.source.venue]
    .filter((v): v is string => Boolean(v))
    .map(e);
  const refs = a.source.references.map((r) => `<li>${link(r.url, r.label)}</li>`).join('');
  return `<aside class="source-card" aria-label="Kaynak">
    <div class="badges"><span class="badge">${e(STATUS[a.source.publicationStatus])}</span>${
      a.source.coverage === ContentCoverage.ABSTRACT_ONLY
        ? '<span class="badge">Yalnızca özete dayalı analiz</span>'
        : ''
    }</div>
    <p><strong class="sans">Kaynak:</strong> ${e(a.source.title)}</p>
    <p>${meta.join(' · ')}</p>
    <ul>${refs}</ul>
  </aside>`;
}

function article(a: IssueArticle, level: 2 | 3): string {
  const h = `h${level}`;
  const sub = `h${level + 1}`;
  const sections = a.sections
    .map(
      (s) =>
        `<section class="sec"><${sub}>${e(s.heading || SECTION_FALLBACK[s.key])}</${sub}>${paragraphs(s.body)}</section>`,
    )
    .join('');
  const unknowns = a.notReported?.length
    ? `<aside class="unknowns" aria-label="Kaynakta belirtilmeyenler"><div class="box-title">Kaynakta belirtilmeyenler</div>${list(a.notReported)}</aside>`
    : '';
  const glossary = a.glossary.length
    ? `<aside class="glossary" aria-label="Terimler"><div class="box-title">Terimler</div><dl>${a.glossary
        .map((g) => `<dt>${e(g.term)}</dt><dd>${e(g.explanation)}</dd>`)
        .join('')}</dl></aside>`
    : '';
  return `<article class="article role-${a.role.toLowerCase()}" id="${e(a.key)}">
  <div class="article-head">
    <div class="kicker">${e(ROLE[a.role])} · ${e(a.topicLabel)} · ${e(a.paperKey)}</div>
    <${h} class="headline">${e(a.headline)}</${h}>
    <p class="dek">${e(a.dek)}</p>
  </div>
  ${sourceCard(a)}
  <aside class="why"><p><strong class="sans">Neden önemli?</strong> ${e(a.whyItMatters)}</p></aside>
  ${sections}
  ${unknowns}
  ${glossary}
</article>`;
}

function claimList(items: OutlookClaim[], kind: 'evidence' | 'inference', label: string): string {
  return `<ul class="claims">${items
    .map(
      (c) =>
        `<li><span class="label ${kind}">${label}</span> ${e(c.statement)} ${cites(c.paperKeys)}</li>`,
    )
    .join('')}</ul>`;
}

function outlook(o: OutlookReportModel, mode: OutlookMode): string {
  const single = mode === 'SINGLE_STUDY';
  const gaps = [
    o.insufficientEvidence.synthesis,
    o.insufficientEvidence.academic,
    o.insufficientEvidence.industry,
  ]
    .filter((g): g is string => Boolean(g))
    .map((g) => `<p class="gap">Kanıt sınırı: ${e(g)}</p>`)
    .join('');
  const academic = o.academicOpportunities
    .map(
      (
        a,
      ) => `<div class="card"><div class="card-head"><span class="label proposal">Önerilen deney</span> <strong>${e(a.question)}</strong> ${cites(a.paperKeys)}</div>
  <dl class="facts"><dt>Hipotez</dt><dd>${e(a.hypothesis)}</dd><dt>İlk deney</dt><dd>${e(a.firstExperiment)}</dd><dt>Ölçülecekler</dt><dd>${a.metrics.map(e).join(' · ')}</dd><dt>Riskler</dt><dd>${e(a.risks)}</dd></dl></div>`,
    )
    .join('');
  const industry = o.industryOpportunities
    .map(
      (
        i,
      ) => `<div class="card"><div class="card-head"><span class="label proposal">Önerilen pilot</span> <strong>${e(i.idea)}</strong> ${cites(i.paperKeys)}</div>
  <dl class="facts"><dt>İhtiyaç</dt><dd>${e(i.need)}</dd><dt>Pilot</dt><dd>${e(i.pilot)}</dd><dt>Olgunluk</dt><dd>${e(MATURITY[i.maturity] ?? i.maturity)}</dd><dt>Ölçülecekler</dt><dd>${i.metrics.map(e).join(' · ')}</dd><dt>Engeller</dt><dd>${i.barriers.map(e).join(' · ')}</dd></dl></div>`,
    )
    .join('');
  const contrasts =
    !single && o.contrasts?.length
      ? `<h3>Uyuşmalar ve ayrışmalar</h3>${claimList(o.contrasts, 'inference', 'Karşılaştırma')}`
      : '';
  const none = '<p class="gap">Bu sayıda yeterli kanıt yok.</p>';
  return `<section class="outlook ${single ? 'mode-single' : 'mode-cross'}" id="outlook">
  <div class="outlook-head">
    <div class="kicker">Kapanış</div>
    <h2>${e(o.title)}</h2>
    <p class="outlook-sub">${
      single
        ? 'Tek çalışmanın eleştirel değerlendirmesi: ne gösterdi, neyi göstermedi, neler denenebilir.'
        : 'Bu sayının çalışmalarını birlikte okumak: nerede uyuşuyorlar, nerede ayrışıyorlar, neler denenebilir.'
    }</p>
  </div>
  <div class="synth"><span class="label inference">PaperMorning yorumu</span> <strong>${
    single ? 'Bu çalışmanın değerlendirmesi:' : 'Bu sayının ortak sonucu:'
  }</strong> ${e(o.synthesis.statement)} ${cites(o.synthesis.paperKeys)}</div>
  ${gaps}
  <h3>Kaynakların gösterdiği</h3>${claimList(o.evidence, 'evidence', 'Kaynak bulgusu')}
  ${o.inferences.length ? `<h3>PaperMorning yorumu</h3>${claimList(o.inferences, 'inference', 'Yorum / hipotez')}` : ''}
  ${contrasts}
  <h3>Akademik araştırma fırsatları</h3>${academic || none}
  <h3>Sektörel uygulama fırsatları</h3>${industry || none}
  <h3>Gelişim ihtimali ve belirsizlik</h3>
  <p><span class="label inference">Yorum</span> ${e(o.development.direction)}</p>
  <div class="dev-lists">
    <div><div class="box-title">Belirsizlikler</div>${list(o.development.uncertainties)}</div>
    ${o.development.falsifiers.length ? `<div><div class="box-title">Bu yorumu çürütebilecek koşullar</div>${list(o.development.falsifiers)}</div>` : ''}
  </div>
  <h3>Somut ilk adım</h3>
  <div class="next"><span class="label proposal">Öneri</span> ${e(o.nextStep.action)} — <em>Ölçüt:</em> ${e(o.nextStep.measure)}</div>
</section>`;
}

function issueLine(content: IssueContentModel, kind: string): string {
  return `Sayı ${e(content.issueNumber)} · ${e(content.issueDate)} · ${kind}`;
}

function notes(content: IssueContentModel, cls: string): string {
  return content.editorialNotes.length
    ? `<div class="notes ${cls}">${content.editorialNotes.map((n) => `<p>${e(n)}</p>`).join('')}</div>`
    : '';
}

function briefing(content: IssueContentModel): string {
  const [only] = content.articles;
  return `<header class="masthead"><h1 class="brand">${e(content.publicationName)}</h1>
  <div class="issue-line">${issueLine(content, 'Araştırma brifingi')}<br>${e(only.topicLabel)}</div></header>
${notes(content, 'briefing-notes')}
${article(only, 2)}`;
}

function magazine(content: IssueContentModel): string {
  const cover =
    content.articles.find((a) => a.key === content.cover.articleKey) ?? content.articles[0];
  const byKey = new Map(content.articles.map((a) => [a.key, a]));
  const contents = content.toc
    .map((t) => {
      const role = t.kind === 'OUTLOOK' ? 'Kapanış' : ROLE[byKey.get(t.key)?.role ?? 'FEATURE'];
      return `<li><span class="c-role">${e(role)}</span><a href="#${e(t.key)}">${e(t.title)}</a></li>`;
    })
    .join('');
  const main = content.articles.filter((a) => a.role !== 'BRIEF');
  const briefs = content.articles.filter((a) => a.role === 'BRIEF');
  return `<section class="cover">
  <header class="masthead"><h1 class="brand">${e(content.publicationName)}</h1>
    <div class="issue-line">${issueLine(content, 'Kişisel bilim dergisi')}</div></header>
  <div class="cover-story">
    <div class="kicker">${e(ROLE.COVER)} · ${e(cover.topicLabel)}</div>
    <p class="cover-headline">${e(content.cover.headline)}</p>
    <p class="cover-dek">${e(content.cover.dek)}</p>
  </div>
  <p class="intro">${e(content.intro)}</p>
  <nav class="contents" aria-label="Bu sayıda"><div class="box-title">Bu sayıda</div><ol>${contents}</ol></nav>
  ${notes(content, '')}
</section>
${main.map((a) => article(a, 2)).join('\n')}
${
  briefs.length
    ? `<section class="briefs"><h2>Kısa haberler</h2><div class="brief-list">${briefs
        .map((a) => article(a, 3))
        .join('\n')}</div></section>`
    : ''
}`;
}

/**
 * Deterministic print HTML for one frozen issue snapshot (schema v1 and v2). All text is escaped,
 * only http(s) links are emitted, and nothing references external resources (no fonts, images or
 * scripts).
 */
export function renderIssueHtml(
  content: IssueContentModel,
  options: RenderIssueOptions = {},
): string {
  const single = content.articles.length === 1;
  const mode: OutlookMode = content.outlook.mode ?? (single ? 'SINGLE_STUDY' : 'CROSS_STUDY');
  const banner = options.preview
    ? `<div class="preview-banner" role="note">${e(options.preview.note)}</div>`
    : '';
  return `<!doctype html>
<html lang="${e(content.language)}"><head><meta charset="utf-8">
<meta name="generator" content="PaperMorning ${ISSUE_TEMPLATE_VERSION}">
<title>${e(content.publicationName)} — Sayı ${e(content.issueNumber)} — ${e(content.issueDate)}</title>
<style>${CSS}</style></head>
<body class="${single ? 'briefing' : 'magazine'}">
${banner}
${single ? briefing(content) : magazine(content)}
${outlook(content.outlook, mode)}
</body></html>`;
}
