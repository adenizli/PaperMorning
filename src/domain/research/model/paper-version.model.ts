import type { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';

/** A specific source revision/publication of a paper, with the content that may be analyzed. */
export interface PaperVersionModel {
  id: string;
  paperId: string;
  source: 'OPENALEX' | 'ARXIV';
  sourceRecordId: string;
  versionLabel: string | null;
  publicationStatus: PublicationStatus;
  /** First publication/submission date (YYYY-MM-DD). */
  publishedAt: string;
  sourceUpdatedAt: Date | null;
  title: string;
  abstract: string | null;
  /** What content is stored for analysis (abstract only unless permitted full text exists). */
  contentCoverage: ContentCoverage;
  venue: string | null;
  landingUrl: string;
  pdfUrl: string | null;
  categories: string[];
  contentFingerprint: string;
  createdAt: Date;
}
