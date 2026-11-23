import type { IssueContentModel } from './issue-content.model';

/** FROZEN: snapshot persisted, PDF pending. READY: snapshot + verified private PDF. */
export enum IssueStatus {
  FROZEN = 'FROZEN',
  READY = 'READY',
}

export interface IssueModel {
  id: string;
  userId: string;
  /** Reader-local calendar date (YYYY-MM-DD). */
  issueDate: string;
  timezone: string;
  language: string;
  status: IssueStatus;
  content: IssueContentModel;
  contentHash: string;
  pdfStorageKey: string | null;
  pdfSha256: string | null;
  pdfSizeBytes: number | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface IssueSummary {
  id: string;
  issueDate: string;
  issueNumber: number;
  status: IssueStatus;
  coverHeadline: string;
  articleCount: number;
  publishedAt: Date | null;
}
