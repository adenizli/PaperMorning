import { findUnsupportedNumbers } from '../../../common/text/numeric-claims';
import type { PaperAnalysisContent } from '../model/paper-analysis.model';

export class AnalysisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisValidationError';
  }
}

export const ABSTRACT_ONLY_LIMITATION =
  'This analysis is based on the abstract and metadata only; the full text was not reviewed.';

const str = (value: unknown, field: string, max = 2000, allowEmpty = false): string => {
  if (typeof value !== 'string') throw new AnalysisValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new AnalysisValidationError(`${field} is empty`);
  return trimmed.slice(0, max);
};

const arr = (value: unknown, field: string, min: number, max: number): unknown[] => {
  if (!Array.isArray(value)) throw new AnalysisValidationError(`${field} must be an array`);
  if (value.length < min)
    throw new AnalysisValidationError(`${field} needs at least ${min} item(s)`);
  return value.slice(0, max);
};

/**
 * Validates structured Claude output before it may be stored as shared scientific analysis.
 * Rejects missing structure and any number that does not appear in the source text.
 */
export function validateAnalysisOutput(
  data: unknown,
  sourceText: string,
  abstractOnly: boolean,
): PaperAnalysisContent {
  if (typeof data !== 'object' || data === null)
    throw new AnalysisValidationError('Output is not an object');
  const d = data as Record<string, unknown>;
  const content: PaperAnalysisContent = {
    summary: str(d.summary, 'summary', 1200),
    problem: str(d.problem, 'problem'),
    priorApproach: str(d.priorApproach, 'priorApproach'),
    contribution: str(d.contribution, 'contribution'),
    methods: str(d.methods, 'methods'),
    findings: arr(d.findings, 'findings', 1, 8).map((f, i) => {
      const item = (f ?? {}) as Record<string, unknown>;
      return {
        statement: str(item.statement, `findings[${i}].statement`, 800),
        evidence: str(item.evidence, `findings[${i}].evidence`, 800),
      };
    }),
    limitations: arr(d.limitations, 'limitations', 1, 8).map((l, i) =>
      str(l, `limitations[${i}]`, 600),
    ),
    keyTerms: arr(d.keyTerms, 'keyTerms', 0, 8).map((t, i) => {
      const item = (t ?? {}) as Record<string, unknown>;
      return {
        term: str(item.term, `keyTerms[${i}].term`, 100),
        explanation: str(item.explanation, `keyTerms[${i}].explanation`, 500),
      };
    }),
    openQuestions: arr(d.openQuestions, 'openQuestions', 0, 6).map((q, i) =>
      str(q, `openQuestions[${i}]`, 500),
    ),
  };

  const generated = JSON.stringify(content);
  const unsupported = findUnsupportedNumbers(generated, sourceText);
  if (unsupported.length > 0) {
    throw new AnalysisValidationError(
      `Numbers not present in the source text: ${unsupported.slice(0, 5).join(', ')}`,
    );
  }
  if (abstractOnly && !content.limitations.includes(ABSTRACT_ONLY_LIMITATION)) {
    content.limitations.unshift(ABSTRACT_ONLY_LIMITATION);
  }
  return content;
}
