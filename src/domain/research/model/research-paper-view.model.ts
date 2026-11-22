import type { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import type { PaperAnalysisContent, SourceReferenceModel } from './paper-analysis.model';

/**
 * Read-only public view of an analyzed paper, as consumed by other domains (Publication).
 * Contains provenance needed to cite the source honestly; no persistence internals.
 */
export interface ResearchPaperView {
  analysisId: string;
  analysisFingerprint: string;
  paperId: string;
  paperVersionId: string;
  /** Best-matching requested topic and every requested topic this version was accepted for. */
  topicKey: string;
  topicKeys: string[];
  relevanceScore: number;
  title: string;
  authors: string[];
  doi: string | null;
  arxivId: string | null;
  publicationStatus: PublicationStatus;
  publishedAt: string;
  venue: string | null;
  abstract: string | null;
  coverage: ContentCoverage;
  analysis: PaperAnalysisContent;
  sourceReferences: SourceReferenceModel[];
  analyzedAt: Date;
}

export interface ResearchQuery {
  topicKeys: string[];
  /** Inclusive YYYY-MM-DD bounds on first publication date. */
  publishedFrom: string;
  publishedUntil?: string;
  limit?: number;
}
