import { XMLParser } from 'fast-xml-parser';
import { PublicationStatus } from '../../common/enum/research.enum';
import type { AcademicQuery, AcademicRecord, FetchFn } from './academic-source.types';
import { getText, HttpOptions } from './http';
import { normalizeDoi, parseArxivId } from './identifiers';

const BASE_URL = 'https://export.arxiv.org/api/query';
/** arXiv asks API clients to wait ~3 seconds between consecutive requests. */
const MIN_INTERVAL_MS = 3_000;

interface AtomEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: { name?: string }[];
  link?: { '@_href'?: string; '@_title'?: string; '@_rel'?: string }[];
  category?: { '@_term'?: string }[];
  'arxiv:doi'?: string | { '#text'?: string };
  'arxiv:journal_ref'?: string | { '#text'?: string };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['entry', 'author', 'link', 'category'].includes(name),
});

/** Preprint discovery through the documented arXiv Atom API. */
export class ArxivClient {
  private lastRequestAt = 0;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly http: HttpOptions,
    private readonly minIntervalMs = MIN_INTERVAL_MS,
  ) {}

  async search(query: AcademicQuery): Promise<AcademicRecord[]> {
    if (query.arxivCategories.length === 0) return [];
    const categories = query.arxivCategories.map((c) => `cat:${c}`).join(' OR ');
    const window = `submittedDate:[${compact(query.from)}0000 TO ${compact(query.until)}2359]`;
    const params = new URLSearchParams({
      search_query: `(${categories}) AND ${window}`,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(Math.min(query.limit, 200)),
    });
    await this.throttle();
    const xml = await getText(this.fetchFn, `${BASE_URL}?${params.toString()}`, this.http);
    return parseArxivFeed(xml);
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }
}

export function parseArxivFeed(xml: string): AcademicRecord[] {
  const feed = parser.parse(xml) as { feed?: { entry?: AtomEntry[] } };
  return (feed.feed?.entry ?? [])
    .map(mapEntry)
    .filter((record): record is AcademicRecord => record !== null);
}

function mapEntry(entry: AtomEntry): AcademicRecord | null {
  const identifier = parseArxivId(entry.id);
  const title = collapse(entry.title);
  if (!identifier || !title || !entry.published) return null;
  const version = identifier.version ?? 'v1';
  const links = entry.link ?? [];
  return {
    source: 'ARXIV',
    sourceRecordId: `${identifier.id}${version}`,
    versionLabel: version,
    title,
    authors: (entry.author ?? []).map((a) => collapse(a.name)).filter(Boolean),
    abstract: collapse(entry.summary) || null,
    // arXiv's own DOI field links this preprint to its verified journal publication.
    doi: normalizeDoi(text(entry['arxiv:doi'])),
    arxivId: identifier.id,
    openAlexId: null,
    publicationStatus: PublicationStatus.PREPRINT,
    publishedAt: entry.published.slice(0, 10),
    sourceUpdatedAt: entry.updated ? new Date(entry.updated) : null,
    venue: collapse(text(entry['arxiv:journal_ref'])) || 'arXiv',
    landingUrl: `https://arxiv.org/abs/${identifier.id}${version}`,
    pdfUrl: links.find((l) => l['@_title'] === 'pdf')?.['@_href'] ?? null,
    categories: (entry.category ?? []).map((c) => c['@_term']).filter((t): t is string => !!t),
  };
}

function text(value: string | { '#text'?: string } | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.['#text'];
}

function collapse(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(date: string): string {
  return date.replace(/-/g, '');
}
