import type { ContentCoverage } from '../../../common/enum/research.enum';

export enum AnalysisStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** A finding together with the source-backed evidence the analysis saw for it. */
export interface ResearchEvidenceModel {
  statement: string;
  evidence: string;
}

export interface SourceReferenceModel {
  kind: 'LANDING' | 'DOI' | 'ARXIV' | 'PDF';
  label: string;
  url: string;
}

export interface PaperAnalysisContent {
  summary: string;
  problem: string;
  priorApproach: string;
  contribution: string;
  methods: string;
  findings: ResearchEvidenceModel[];
  limitations: string[];
  keyTerms: { term: string; explanation: string }[];
  openQuestions: string[];
}

/** Shared, version-specific scientific analysis. Owned by no user; reused by every reader. */
export interface PaperAnalysisModel {
  id: string;
  paperVersionId: string;
  fingerprint: string;
  status: AnalysisStatus;
  coverage: ContentCoverage;
  content: PaperAnalysisContent | null;
  sourceReferences: SourceReferenceModel[];
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
