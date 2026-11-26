import type { KnowledgeLevel, TopicPriority } from '../../account';
import type { ArticleRole } from './issue-content.model';
import type { OutlookReportModel } from './outlook-report.model';

export enum PublicationRunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum PublicationStage {
  SELECTING = 'SELECTING',
  WRITING = 'WRITING',
  OUTLOOK = 'OUTLOOK',
  RENDERING = 'RENDERING',
  READY = 'READY',
}

export interface SelectedArticle {
  analysisId: string;
  paperId: string;
  topicKey: string;
  role: ArticleRole;
  priority: TopicPriority;
  knowledgeLevel: KnowledgeLevel;
}

/** Persisted checkpoints: a restarted run resumes here instead of repeating paid work. */
export interface PublicationCheckpoint {
  selection?: SelectedArticle[];
  variantIds?: Record<string, string>;
  outlook?: OutlookReportModel;
}

export interface PublicationRunModel {
  id: string;
  userId: string;
  issueDate: string;
  status: PublicationRunStatus;
  stage: PublicationStage;
  checkpoint: PublicationCheckpoint;
  attemptCount: number;
  retryable: boolean;
  errorKind: string | null;
  errorMessage: string | null;
  nextAttemptAt: Date | null;
  lateAt: Date | null;
  issueId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}
