/** Deterministic identifier normalization. Records are only linked through these values. */

const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;
const NEW_ARXIV = /^(\d{4}\.\d{4,5})(v\d+)?$/i;
const OLD_ARXIV = /^([a-z-]+(?:\.[a-z-]+)?\/\d{7})(v\d+)?$/i;

export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const doi = raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

export interface ArxivIdentifier {
  id: string;
  version: string | null;
}

export function parseArxivId(raw: string | null | undefined): ArxivIdentifier | null {
  if (!raw) return null;
  const value = raw
    .trim()
    .replace(/^https?:\/\/(export\.)?arxiv\.org\/(abs|pdf)\//i, '')
    .replace(/^arxiv:/i, '')
    .replace(/\.pdf$/i, '');
  const match = NEW_ARXIV.exec(value) ?? OLD_ARXIV.exec(value);
  if (!match) return null;
  return { id: match[1].toLowerCase(), version: match[2]?.toLowerCase() ?? null };
}

/** arXiv's DataCite DOIs (10.48550/arXiv.<id>) identify the preprint, not a journal article. */
export function arxivIdFromDoi(doi: string | null): string | null {
  if (!doi) return null;
  const match = ARXIV_DOI.exec(doi);
  return match ? (parseArxivId(match[1])?.id ?? null) : null;
}

export function normalizeOpenAlexId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /(W\d+)$/i.exec(raw.trim());
  return match ? match[1].toUpperCase() : null;
}
