/**
 * Repairs PDF bookmark (outline) titles produced by Chromium.
 *
 * Chromium builds each bookmark title from the laid-out text of its heading. On Linux (the
 * production container and CI), a heading that layout moved to the next page — keep-with-next,
 * break-inside: avoid on an enclosing block, column balancing — is collected twice, giving titles
 * such as "Ne yaptılar, ne buldular?Ne yaptılar, ne buldular?". Avoiding every such move would
 * leave orphaned headings, so the titles are repaired instead.
 *
 * The repair is deliberately narrow and byte-safe:
 * - only `/Title <FEFF…>` hex strings (UTF-16BE, as Chromium writes them) are considered;
 * - a title is changed only if it is exactly one of the document's own headings repeated k ≥ 2
 *   times, and it becomes that heading;
 * - the replacement is padded with whitespace inside the hex string (ignored by PDF readers), so
 *   the file keeps its exact length and every cross-reference offset stays valid.
 * Anything unexpected (literal strings, object streams) is left untouched.
 */

const TITLE = /\/Title\s*<([0-9A-Fa-f\s]*)>/g;

function decodeUtf16Be(hex: string): string | null {
  const clean = hex.replace(/\s+/g, '');
  if (!/^FEFF/i.test(clean) || clean.length % 4 !== 0) return null;
  const bytes = Buffer.from(clean.slice(4), 'hex');
  const units: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) units.push((bytes[i] << 8) | bytes[i + 1]);
  return String.fromCharCode(...units);
}

function encodeUtf16Be(text: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
  return hex.toUpperCase();
}

/** The text of every h1–h6 in the rendered HTML, as Chromium shows it (tags stripped, unescaped). */
export function headingTexts(html: string): string[] {
  const unescape = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)]
    .map((m) => unescape(m[2].replace(/<[^>]*>/g, '')).trim())
    .filter(Boolean);
}

export function repairOutlineTitles(
  pdf: Buffer,
  headings: string[],
): { pdf: Buffer; repaired: number } {
  const candidates = [...new Set(headings)].sort((a, b) => b.length - a.length);
  const raw = pdf.toString('latin1');
  let out: Buffer | null = null;
  let repaired = 0;
  for (const match of raw.matchAll(TITLE)) {
    const title = decodeUtf16Be(match[1]);
    if (!title) continue;
    const heading = candidates.find(
      (h) =>
        h.length > 0 &&
        title.length > h.length &&
        title.length % h.length === 0 &&
        title === h.repeat(title.length / h.length),
    );
    if (!heading) continue;
    const replacement = encodeUtf16Be(heading).padEnd(match[1].length, ' ');
    if (replacement.length !== match[1].length) continue;
    out ??= Buffer.from(pdf);
    const start = match.index + match[0].indexOf('<') + 1;
    out.write(replacement, start, 'latin1');
    repaired++;
  }
  return { pdf: out ?? pdf, repaired };
}
