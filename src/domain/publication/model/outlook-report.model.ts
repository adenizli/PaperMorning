/**
 * Closing "Ufuk Raporu" (nested in the issue snapshot, not a table). Every item cites the
 * issue's own papers by key (e.g. "P1"). Source-backed evidence, PaperMorning inference and
 * proposed actions live in separate arrays so they can never be presented as the same thing.
 */
export type OutlookMaturity = 'RESEARCH' | 'EARLY_PROTOTYPE' | 'FIELD_TESTED';

export interface OutlookClaim {
  statement: string;
  paperKeys: string[];
}

export interface AcademicOpportunity {
  question: string;
  hypothesis: string;
  firstExperiment: string;
  metrics: string[];
  risks: string;
  paperKeys: string[];
}

export interface IndustryOpportunity {
  idea: string;
  need: string;
  pilot: string;
  metrics: string[];
  barriers: string[];
  maturity: OutlookMaturity;
  paperKeys: string[];
}

export interface OutlookReportModel {
  fingerprint: string;
  title: string;
  synthesis: OutlookClaim;
  /** "Kaynakların gösterdiği": facts reported by the cited papers. */
  evidence: OutlookClaim[];
  /** "PaperMorning yorumu": cross-paper inference, explicitly not established fact. */
  inferences: OutlookClaim[];
  academicOpportunities: AcademicOpportunity[];
  industryOpportunities: IndustryOpportunity[];
  development: { direction: string; uncertainties: string[]; falsifiers: string[] };
  nextStep: { action: string; measure: string };
  /** Honest gaps instead of invented opportunities. */
  insufficientEvidence: {
    academic: string | null;
    industry: string | null;
    synthesis: string | null;
  };
  /** One-to-two sentence preview for the email. */
  teaser: string;
  model: string;
  promptVersion: string;
}
