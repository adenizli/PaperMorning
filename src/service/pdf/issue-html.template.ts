import { ContentCoverage, PublicationStatus } from '../../common/enum/research.enum';
import { escapeHtml, safeHttpUrl } from '../../common/text/escape-html';
import type {
  IssueArticle,
  IssueContentModel,
} from '../../domain/publication/model/issue-content.model';
import type {
  OutlookClaim,
  OutlookReportModel,
} from '../../domain/publication/model/outlook-report.model';

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
const list = (items: string[]) =>
  items.length ? `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : '';
const cites = (keys: string[]) => `<span class="cite">[${keys.map(e).join(', ')}]</span>`;
const link = (url: string, label: string) => {
  const safe = safeHttpUrl(url);
  return safe
    ? `<a href="${e(safe)}">${e(label)}</a> <span class="url">${e(safe)}</span>`
    : e(label);
};

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Noto Serif', 'DejaVu Serif', Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.5; color: #111; margin: 0; }
h1, h2, h3, h4 { font-family: 'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif; line-height: 1.2; break-after: avoid; }
a { color: #0b4f8a; text-decoration: none; }
.url { display: block; font-size: 8pt; color: #555; overflow-wrap: anywhere; word-break: break-all; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; border-top: 6pt solid #b35c00; padding-top: 12mm; break-after: page; }
.masthead { font-size: 40pt; letter-spacing: -1pt; margin: 0; }
.issue-meta { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; color: #444; font-size: 11pt; }
.cover-headline { font-size: 24pt; margin: 0 0 6mm; }
.cover-dek { font-size: 13pt; color: #333; }
.notes { font-size: 8.5pt; color: #555; border-top: 1px solid #ccc; padding-top: 3mm; }
.toc { break-after: page; }
.toc ol { padding-left: 6mm; }
.toc li { margin: 2mm 0; }
.article { break-before: page; }
.article.brief { break-before: auto; border-top: 1px solid #ccc; padding-top: 4mm; margin-top: 6mm; }
.kicker { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; text-transform: uppercase; font-size: 8pt; letter-spacing: 1pt; color: #b35c00; }
.dek { font-size: 12pt; color: #333; }
.why { background: #f5f1ea; padding: 3mm 4mm; border-left: 3pt solid #b35c00; break-inside: avoid; }
.section { break-inside: avoid-page; }
.glossary dt { font-weight: bold; }
.source { font-size: 9pt; background: #f4f6f8; padding: 3mm 4mm; margin-top: 4mm; break-inside: avoid; }
.badge { display: inline-block; font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 8pt; padding: 0.5mm 2mm; border: 1px solid #888; border-radius: 2mm; margin-right: 2mm; }
.outlook { break-before: page; border-top: 6pt solid #0b4f8a; padding-top: 6mm; }
.outlook h2 { font-size: 20pt; }
.label { font-family: 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 8pt; font-weight: bold; letter-spacing: 0.3pt; padding: 0.5mm 2mm; border-radius: 1.5mm; color: #fff; }
.label.evidence { background: #2e7d32; } .label.inference { background: #6a1b9a; } .label.proposal { background: #b35c00; }
.block { break-inside: avoid; margin: 3mm 0; }
.cite { font-size: 8pt; color: #555; }
.gap { font-style: italic; color: #555; }
`;

function article(a: IssueArticle): string {
  const sections = a.sections
    .map(
      (s) =>
        `<div class="section"><h3>${e(s.heading || SECTION_FALLBACK[s.key])}</h3><p>${e(s.body)}</p></div>`,
    )
    .join('');
  const glossary = a.glossary.length
    ? `<h4>Terimler</h4><dl class="glossary">${a.glossary.map((g) => `<dt>${e(g.term)}</dt><dd>${e(g.explanation)}</dd>`).join('')}</dl>`
    : '';
  const refs = a.source.references.map((r) => `<li>${link(r.url, r.label)}</li>`).join('');
  return `<article class="article ${a.role === 'BRIEF' ? 'brief' : ''}" id="${e(a.key)}">
  <div class="kicker">${e(ROLE[a.role])} · ${e(a.topicLabel)} · ${e(a.paperKey)}</div>
  <h2>${e(a.headline)}</h2>
  <p class="dek">${e(a.dek)}</p>
  <p class="why"><strong>Neden önemli?</strong> ${e(a.whyItMatters)}</p>
  ${sections}
  ${glossary}
  <div class="source">
    <span class="badge">${e(STATUS[a.source.publicationStatus])}</span>
    ${a.source.coverage === ContentCoverage.ABSTRACT_ONLY ? '<span class="badge">Yalnızca özete dayalı analiz</span>' : ''}
    <p><strong>Kaynak:</strong> ${e(a.source.title)} — ${e(a.source.authors.slice(0, 6).join(', '))}${a.source.authors.length > 6 ? ' ve diğerleri' : ''} (${e(a.source.publishedAt)}${a.source.venue ? `, ${e(a.source.venue)}` : ''})</p>
    <ul>${refs}</ul>
  </div>
</article>`;
}

function claims(items: OutlookClaim[], kind: 'evidence' | 'inference', label: string): string {
  return items
    .map(
      (c) =>
        `<div class="block"><span class="label ${kind}">${label}</span> ${e(c.statement)} ${cites(c.paperKeys)}</div>`,
    )
    .join('');
}

function outlook(o: OutlookReportModel): string {
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
      ) => `<div class="block"><span class="label proposal">Önerilen deney</span> <strong>${e(a.question)}</strong> ${cites(a.paperKeys)}
  <p><em>Hipotez:</em> ${e(a.hypothesis)}</p><p><em>İlk deney:</em> ${e(a.firstExperiment)}</p>
  <p><em>Ölçülecekler:</em></p>${list(a.metrics)}<p><em>Riskler:</em> ${e(a.risks)}</p></div>`,
    )
    .join('');
  const industry = o.industryOpportunities
    .map(
      (
        i,
      ) => `<div class="block"><span class="label proposal">Önerilen pilot</span> <strong>${e(i.idea)}</strong> ${cites(i.paperKeys)}
  <p><em>İhtiyaç:</em> ${e(i.need)}</p><p><em>Pilot:</em> ${e(i.pilot)}</p><p><em>Olgunluk:</em> ${e(MATURITY[i.maturity] ?? i.maturity)}</p>
  <p><em>Ölçülecekler:</em></p>${list(i.metrics)}<p><em>Engeller:</em></p>${list(i.barriers)}</div>`,
    )
    .join('');
  return `<section class="outlook" id="outlook">
  <div class="kicker">Kapanış</div>
  <h2>${e(o.title)}</h2>
  <div class="block"><span class="label inference">PaperMorning yorumu</span> <strong>Bu sayının ortak sonucu:</strong> ${e(o.synthesis.statement)} ${cites(o.synthesis.paperKeys)}</div>
  ${gaps}
  <h3>Kaynakların gösterdiği</h3>${claims(o.evidence, 'evidence', 'Kaynak bulgusu')}
  <h3>PaperMorning yorumu</h3>${claims(o.inferences, 'inference', 'Yorum / hipotez')}
  <h3>Akademik araştırma fırsatları</h3>${academic || '<p class="gap">Bu sayıda yeterli kanıt yok.</p>'}
  <h3>Sektörel uygulama fırsatları</h3>${industry || '<p class="gap">Bu sayıda yeterli kanıt yok.</p>'}
  <h3>Gelişim ihtimali ve belirsizlik</h3>
  <div class="block"><span class="label inference">Yorum</span> ${e(o.development.direction)}</div>
  <p><em>Belirsizlikler:</em></p>${list(o.development.uncertainties)}
  ${o.development.falsifiers.length ? `<p><em>Bu yorumu çürütebilecek koşullar:</em></p>${list(o.development.falsifiers)}` : ''}
  <h3>Somut ilk adım</h3>
  <div class="block"><span class="label proposal">Öneri</span> ${e(o.nextStep.action)} — <em>Ölçüt:</em> ${e(o.nextStep.measure)}</div>
</section>`;
}

/**
 * Deterministic print HTML for one frozen issue snapshot. All text is escaped, only http(s)
 * links are emitted, and nothing references external resources (no fonts, images or scripts).
 */
export function renderIssueHtml(content: IssueContentModel): string {
  const toc = content.toc
    .map(
      (t) =>
        `<li><a href="#${e(t.key)}">${e(t.title)}</a>${t.kind === 'OUTLOOK' ? ' <em>(kapanış)</em>' : ''}</li>`,
    )
    .join('');
  return `<!doctype html>
<html lang="${e(content.language)}"><head><meta charset="utf-8"><title>${e(content.publicationName)} — ${e(content.issueDate)}</title>
<style>${CSS}</style></head>
<body>
<section class="cover">
  <div>
    <h1 class="masthead">${e(content.publicationName)}</h1>
    <div class="issue-meta">Sayı ${e(content.issueNumber)} · ${e(content.issueDate)} · Kişisel bilim dergisi</div>
  </div>
  <div>
    <h2 class="cover-headline">${e(content.cover.headline)}</h2>
    <p class="cover-dek">${e(content.cover.dek)}</p>
    <p>${e(content.intro)}</p>
  </div>
  <div class="notes">${content.editorialNotes.map(e).join('<br>')}</div>
</section>
<nav class="toc"><h2>İçindekiler</h2><ol>${toc}</ol></nav>
${content.articles.map(article).join('\n')}
${outlook(content.outlook)}
</body></html>`;
}
