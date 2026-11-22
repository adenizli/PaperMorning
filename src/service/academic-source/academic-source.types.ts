import type { PublicationStatus } from '../../common/enum/research.enum';

export type AcademicSourceName = 'OPENALEX' | 'ARXIV';

/** One source revision/publication record, normalized but not yet deduplicated. */
export interface AcademicRecord {
  source: AcademicSourceName;
  /** Identity of this exact record at the source (e.g. "W4391", "2411.01234v2"). */
  sourceRecordId: string;
  versionLabel: string | null;
  title: string;
  authors: string[];
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  openAlexId: string | null;
  publicationStatus: PublicationStatus;
  /** First publication/submission date (YYYY-MM-DD). */
  publishedAt: string;
  /** Date this particular revision/metadata was last updated at the source. */
  sourceUpdatedAt: Date | null;
  venue: string | null;
  landingUrl: string;
  pdfUrl: string | null;
  categories: string[];
}

export interface AcademicQuery {
  keywords: string[];
  arxivCategories: string[];
  /** Inclusive YYYY-MM-DD window. */
  from: string;
  until: string;
  limit: number;
}

export interface AcademicSearchResult {
  records: AcademicRecord[];
  failures: { source: AcademicSourceName; message: string }[];
}

export type FetchFn = typeof fetch;
