import type { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import type { KnowledgeLevel } from '../../account';
import type { SourceReferenceModel } from '../../research';

export enum GenerationStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export const ARTICLE_SECTION_KEYS = ['problem', 'before', 'new', 'evidence', 'limits'] as const;
export type ArticleSectionKey = (typeof ARTICLE_SECTION_KEYS)[number];

export interface ArticleSection {
  key: ArticleSectionKey;
  heading: string;
  body: string;
}

export interface ArticleContent {
  headline: string;
  dek: string;
  whyItMatters: string;
  sections: ArticleSection[];
  glossary: { term: string; explanation: string }[];
  /**
   * What a reader would naturally ask but the source does not report (schema v2+). Always framed
   * as unknown, never answered. Absent on variants written before article-v2.
   */
  notReported?: string[];
}

/**
 * A reader-level narration of one shared analysis, reusable by every reader with the same
 * language and knowledge level. Not owned by a user. Source facts come from the analysis.
 */
export interface ArticleVariantModel {
  id: string;
  analysisId: string;
  analysisFingerprint: string;
  language: string;
  knowledgeLevel: KnowledgeLevel;
  generationFingerprint: string;
  status: GenerationStatus;
  content: ArticleContent | null;
  sourceReferences: SourceReferenceModel[];
  coverage: ContentCoverage;
  publicationStatus: PublicationStatus;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  attemptCount: number;
  retryable: boolean;
  errorKind: string | null;
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  completedAt: Date | null;
  createdAt: Date;
}
