import { PublicationStatus, ContentCoverage } from '../../../common/enum/research.enum';
import { escapeHtml, safeHttpUrl } from '../../../common/text/escape-html';
import type { IssueContentModel } from '../model/issue-content.model';

export interface DigestInput {
  content: IssueContentModel;
  username: string;
  issueUrl: string | null;
  settingsUrl: string | null;
}

export const STATUS_LABEL_TR: Record<PublicationStatus, string> = {
  [PublicationStatus.PREPRINT]: 'Ön baskı (hakemsiz)',
  [PublicationStatus.PEER_REVIEWED]: 'Hakemli yayın',
  [PublicationStatus.UNKNOWN]: 'Yayın durumu bilinmiyor',
};

/**
 * Readable plain-text and HTML digest built only from the frozen snapshot. Every dynamic value is
 * HTML-escaped and only http(s) links are emitted.
 */
export function buildDigest(input: DigestInput): { subject: string; text: string; html: string } {
  const { content } = input;
  const subject = `PaperMorning | ${content.issueDate}`;
  const lines: string[] = [
    `Merhaba ${input.username},`,
    '',
    `PaperMorning — Sayı ${content.issueNumber} — ${content.issueDate}`,
    content.intro,
    '',
  ];
  for (const article of content.articles) {
    const link = article.source.references.map((r) => safeHttpUrl(r.url)).find(Boolean);
    const coverage =
      article.source.coverage === ContentCoverage.ABSTRACT_ONLY ? ' · Yalnızca özete dayalı' : '';
    lines.push(
      `■ ${article.headline} [${article.topicLabel}]`,
      `  ${article.dek}`,
      `  Kaynak: ${article.source.title} — ${STATUS_LABEL_TR[article.source.publicationStatus]}${coverage}`,
      ...(link ? [`  ${link}`] : []),
      '',
    );
  }
  lines.push(`Ufuk Raporu: ${content.outlook.teaser}`);
  if (input.issueUrl) lines.push(`Tam bölüm ve sayının tamamı: ${input.issueUrl}`);
  lines.push(
    '',
    `Sayının tam PDF sürümü bu e-postanın ekindedir (PaperMorning-${content.issueDate}.pdf).`,
    ...content.editorialNotes,
    '',
    input.settingsUrl
      ? `Günlük e-postayı durdurmak için: ${input.settingsUrl} (Ayarlar → Günlük e-posta)`
      : "Günlük e-postayı durdurmak için PaperMorning'de Ayarlar → Günlük e-posta seçeneğini kapatın.",
  );

  const articleHtml = content.articles
    .map((article) => {
      const link = article.source.references.map((r) => safeHttpUrl(r.url)).find(Boolean);
      const coverage =
        article.source.coverage === ContentCoverage.ABSTRACT_ONLY ? ' · Yalnızca özete dayalı' : '';
      return `<div style="margin:0 0 20px">
  <div style="font-size:12px;color:#666;text-transform:uppercase">${escapeHtml(article.topicLabel)}</div>
  <h2 style="font-size:18px;margin:4px 0">${escapeHtml(article.headline)}</h2>
  <p style="margin:4px 0">${escapeHtml(article.dek)}</p>
  <p style="font-size:13px;color:#444;margin:4px 0">Kaynak: ${escapeHtml(article.source.title)} — ${escapeHtml(STATUS_LABEL_TR[article.source.publicationStatus])}${escapeHtml(coverage)}${link ? ` · <a href="${escapeHtml(link)}">özgün çalışma</a>` : ''}</p>
</div>`;
    })
    .join('\n');
  const issueLink = input.issueUrl
    ? `<p><a href="${escapeHtml(input.issueUrl)}">Sayının tamamını ve Ufuk Raporu'nu web'de okuyun</a></p>`
    : '';
  const settings = input.settingsUrl
    ? `<a href="${escapeHtml(input.settingsUrl)}">Ayarlar → Günlük e-posta</a>`
    : 'PaperMorning Ayarlar → Günlük e-posta';
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Georgia,serif;max-width:640px;margin:auto;color:#111;line-height:1.5">
<p>Merhaba ${escapeHtml(input.username)},</p>
<h1 style="font-size:24px;margin:8px 0">PaperMorning <span style="font-weight:normal">— Sayı ${escapeHtml(content.issueNumber)} — ${escapeHtml(content.issueDate)}</span></h1>
<p>${escapeHtml(content.intro)}</p>
${articleHtml}
<div style="border-left:4px solid #b35c00;padding:8px 12px;background:#fff6ec">
  <strong>Ufuk Raporu</strong><p style="margin:4px 0">${escapeHtml(content.outlook.teaser)}</p>
</div>
${issueLink}
<p>Sayının tam PDF sürümü bu e-postanın ekindedir (PaperMorning-${escapeHtml(content.issueDate)}.pdf).</p>
<p style="font-size:12px;color:#666">${content.editorialNotes.map((n) => escapeHtml(n)).join('<br>')}</p>
<p style="font-size:12px;color:#666">Günlük e-postayı durdurmak için: ${settings}</p>
</body></html>`;
  return { subject, text: lines.join('\n'), html };
}
