import { PublicationStatus } from '../../common/enum/research.enum';
import type { AcademicQuery, AcademicRecord, FetchFn } from './academic-source.types';
import { getText, HttpOptions } from './http';
import { arxivIdFromDoi, normalizeDoi, normalizeOpenAlexId, parseArxivId } from './identifiers';

const BASE_URL = 'https://api.openalex.org/works';
const SELECT =
  'id,doi,ids,display_name,authorships,abstract_inverted_index,publication_date,updated_date,type,primary_location';

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  ids?: { doi?: string; arxiv?: string };
  display_name?: string | null;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  publication_date?: string | null;
  updated_date?: string | null;
  type?: string | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    version?: string | null;
    source?: { display_name?: string | null; type?: string | null } | null;
  } | null;
}

/** Broad academic discovery through the documented OpenAlex Works API. */
export class OpenAlexClient {
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly http: HttpOptions,
    private readonly mailto?: string,
  ) {}

  async search(query: AcademicQuery): Promise<AcademicRecord[]> {
    const params = new URLSearchParams({
      search: query.keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' OR '),
      filter: `from_publication_date:${query.from},to_publication_date:${query.until},has_abstract:true`,
      sort: 'publication_date:desc',
      'per-page': String(Math.min(query.limit, 200)),
      select: SELECT,
    });
    if (this.mailto) params.set('mailto', this.mailto);
    const body = await getText(this.fetchFn, `${BASE_URL}?${params.toString()}`, this.http);
    const parsed = JSON.parse(body) as { results?: OpenAlexWork[] };
    return (parsed.results ?? [])
      .map((work) => mapOpenAlexWork(work))
      .filter((record): record is AcademicRecord => record !== null);
  }
}

export function mapOpenAlexWork(work: OpenAlexWork): AcademicRecord | null {
  const openAlexId = normalizeOpenAlexId(work.id);
  const title = collapse(work.display_name);
  if (!openAlexId || !title || !work.publication_date) return null;

  const rawDoi = normalizeDoi(work.doi ?? work.ids?.doi);
  const arxivFromDoi = arxivIdFromDoi(rawDoi);
  const arxivId = arxivFromDoi ?? parseArxivId(work.ids?.arxiv)?.id ?? null;
  // A 10.48550/arXiv DOI identifies the preprint itself, so it is not kept as a journal DOI.
  const doi = arxivFromDoi ? null : rawDoi;
  const location = work.primary_location ?? undefined;

  return {
    source: 'OPENALEX',
    sourceRecordId: openAlexId,
    versionLabel: location?.version ?? null,
    title,
    authors: (work.authorships ?? [])
      .map((a) => collapse(a.author?.display_name))
      .filter((name): name is string => Boolean(name)),
    abstract: rebuildAbstract(work.abstract_inverted_index),
    doi,
    arxivId,
    openAlexId,
    publicationStatus: openAlexStatus(work, arxivFromDoi !== null),
    publishedAt: work.publication_date,
    sourceUpdatedAt: work.updated_date ? new Date(work.updated_date) : null,
    venue: collapse(location?.source?.display_name) || null,
    landingUrl: location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : work.id),
    pdfUrl: location?.pdf_url ?? null,
    categories: [],
  };
}

/**
 * Conservative status mapping: PEER_REVIEWED only for the published version in a journal;
 * repository/preprint records are PREPRINT; everything else stays UNKNOWN.
 */
function openAlexStatus(work: OpenAlexWork, isArxivDoi: boolean): PublicationStatus {
  const sourceType = work.primary_location?.source?.type;
  if (isArxivDoi || work.type === 'preprint' || sourceType === 'repository') {
    return PublicationStatus.PREPRINT;
  }
  if (
    work.type === 'article' &&
    sourceType === 'journal' &&
    work.primary_location?.version === 'publishedVersion'
  ) {
    return PublicationStatus.PEER_REVIEWED;
  }
  return PublicationStatus.UNKNOWN;
}

export function rebuildAbstract(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  const text = words
    .filter((w) => w !== undefined)
    .join(' ')
    .trim();
  return text.length > 0 ? text : null;
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
