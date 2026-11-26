export enum ResearchRunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/** Resumable stages; a restarted run continues from the persisted stage. */
export enum ResearchRunStage {
  DISCOVERY = 'DISCOVERY',
  SCREENING = 'SCREENING',
  ANALYSIS = 'ANALYSIS',
  DONE = 'DONE',
}

export interface ResearchRunCounts {
  discovered: number;
  newVersions: number;
  screened: number;
  accepted: number;
  candidates: number;
  analyzed: number;
  reused: number;
  analysisFailed: number;
}

export const EMPTY_RUN_COUNTS: ResearchRunCounts = {
  discovered: 0,
  newVersions: 0,
  screened: 0,
  accepted: 0,
  candidates: 0,
  analyzed: 0,
  reused: 0,
  analysisFailed: 0,
};

export interface ResearchRunModel {
  id: string;
  runKey: string;
  trigger: string;
  topicKey: string;
  windowFrom: string;
  windowUntil: string;
  status: ResearchRunStatus;
  stage: ResearchRunStage;
  counts: ResearchRunCounts;
  discoveredVersionIds: string[];
  candidateVersionIds: string[];
  errors: string[];
  attemptCount: number;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}
