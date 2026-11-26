import type { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import type { KnowledgeLevel, TopicPriority } from '../../account';
import type { SourceReferenceModel } from '../../research';
import type { ArticleSection } from './article-variant.model';
import type { OutlookReportModel } from './outlook-report.model';

export const ISSUE_CONTENT_SCHEMA_VERSION = 1;
export const OUTLOOK_CONTENT_KEY = 'outlook';

export type ArticleRole = 'COVER' | 'FEATURE' | 'BRIEF';

export interface IssueArticle {
  /** Stable key inside this issue (e.g. "a1"); used for feedback and TOC anchors. */
  key: string;
  /** Citation label used by the Ufuk Raporu (e.g. "P1"). */
  paperKey: string;
  role: ArticleRole;
  topicKey: string;
  topicLabel: string;
  priority: TopicPriority;
  knowledgeLevel: KnowledgeLevel;
  headline: string;
  dek: string;
  whyItMatters: string;
  sections: ArticleSection[];
  glossary: { term: string; explanation: string }[];
  source: {
    title: string;
    authors: string[];
    publishedAt: string;
    venue: string | null;
    publicationStatus: PublicationStatus;
    coverage: ContentCoverage;
    references: SourceReferenceModel[];
  };
  provenance: { analysisId: string; variantId: string; paperId: string; paperVersionId: string };
}

/**
 * The canonical frozen issue snapshot (JSONB on Issue). The web API and the PDF renderer both
 * read exactly this object; it is never regenerated after publication.
 */
export interface IssueContentModel {
  schemaVersion: number;
  publicationName: string;
  issueDate: string;
  issueNumber: number;
  language: string;
  generatedAt: string;
  cover: { headline: string; dek: string; articleKey: string };
  intro: string;
  toc: { key: string; title: string; kind: 'ARTICLE' | 'OUTLOOK' }[];
  articles: IssueArticle[];
  /** Always the last section of the issue. */
  outlook: OutlookReportModel;
  editorialNotes: string[];
}
