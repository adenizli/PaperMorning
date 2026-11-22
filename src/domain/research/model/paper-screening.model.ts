export enum ScreeningDecision {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum ScreeningMethod {
  RULES = 'RULES',
  LLM = 'LLM',
}

/**
 * Topic relevance decision for one paper version. The score is relevance to a reader topic,
 * NOT a scientific-quality or peer-review verdict.
 */
export interface PaperScreeningModel {
  id: string;
  paperVersionId: string;
  topicKey: string;
  criteriaVersion: string;
  decision: ScreeningDecision;
  method: ScreeningMethod;
  relevanceScore: number | null;
  reason: string;
  model: string | null;
  promptVersion: string | null;
  createdAt: Date;
}
