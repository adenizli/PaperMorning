import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config';
import { ContentCoverage } from '../../../common/enum/research.enum';
import { fingerprint } from '../../../common/text/fingerprint';
import { LlmService } from '../../../service/llm/llm.service';
import { LlmError, LlmTask } from '../../../service/llm/llm.types';
import type { PaperAnalysisModel, SourceReferenceModel } from '../model/paper-analysis.model';
import { AnalysisStatus } from '../model/paper-analysis.model';
import type { PaperModel } from '../model/paper.model';
import type { PaperVersionModel } from '../model/paper-version.model';
import { PaperAnalysisRepositoryService } from '../repository/paper-analysis-repository.service';
import { PaperRepositoryService } from '../repository/paper-repository.service';
import { PaperVersionRepositoryService } from '../repository/paper-version-repository.service';
import { AnalysisValidationError, validateAnalysisOutput } from './analysis-output.validator';

export const ANALYSIS_PROMPT_VERSION = 'analysis-v1';
export const ANALYSIS_SCHEMA_VERSION = 1;

export type AnalysisOutcome =
  | { status: 'COMPLETED'; analysis: PaperAnalysisModel; reused: boolean }
  | { status: 'IN_PROGRESS'; analysis: PaperAnalysisModel }
  | {
      status: 'FAILED';
      analysis: PaperAnalysisModel | null;
      errorKind: string;
      message: string;
      retryable: boolean;
    };

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    problem: { type: 'string' },
    priorApproach: { type: 'string' },
    contribution: { type: 'string' },
    methods: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { statement: { type: 'string' }, evidence: { type: 'string' } },
        required: ['statement', 'evidence'],
        additionalProperties: false,
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
    keyTerms: {
      type: 'array',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, explanation: { type: 'string' } },
        required: ['term', 'explanation'],
        additionalProperties: false,
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary',
    'problem',
    'priorApproach',
    'contribution',
    'methods',
    'findings',
    'limitations',
    'keyTerms',
    'openQuestions',
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a careful scientific analyst preparing a shared, reusable analysis of one research paper.
Rules:
- Use ONLY the title, metadata and text provided. Do not use outside knowledge about this paper.
- You are given the abstract only unless stated otherwise. Never claim to have read the full text, figures or tables.
- Never invent numbers, datasets, baselines, citations or results. Every number you write must appear in the provided text.
- If the text does not state something (e.g. the prior approach or the baseline), say explicitly that the abstract does not state it.
- For each finding, "evidence" must describe what the provided text says supports it (experiment, comparison, data), or state that the abstract gives no supporting detail.
- Separate what the authors claim from what is demonstrated. Keep certainty no higher than the evidence.
- Do not treat a preprint as peer reviewed.
- Write in clear English. Be concise.`;

/**
 * Shared, cached scientific analysis (Sonnet). The fingerprint covers the exact paper version,
 * its content, the coverage and the model/prompt/schema configuration. A claim in PostgreSQL
 * guarantees that concurrent callers never pay twice for the same fingerprint.
 */
@Injectable()
export class PaperAnalysisService {
  private readonly logger = new Logger(PaperAnalysisService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly llm: LlmService,
    private readonly analyses: PaperAnalysisRepositoryService,
    private readonly versions: PaperVersionRepositoryService,
    private readonly papers: PaperRepositoryService,
  ) {}

  fingerprintFor(
    version: PaperVersionModel,
    model = this.llm.modelFor(LlmTask.PAPER_ANALYSIS),
  ): string {
    return analysisFingerprint(version, {
      model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
    });
  }

  async analyze(
    versionId: string,
    options: { waitMs?: number; pollMs?: number } = {},
  ): Promise<AnalysisOutcome> {
    const version = await this.versions.findById(versionId);
    if (!version) throw new Error(`Paper version ${versionId} not found`);
    const [paper] = await this.papers.findByIds([version.paperId]);
    const model = this.llm.modelFor(LlmTask.PAPER_ANALYSIS);
    const fp = this.fingerprintFor(version, model);

    // Cheap read first: identical analysis already exists -> no claim, no LLM call.
    const existing = await this.analyses.findByFingerprint(fp);
    if (existing?.status === AnalysisStatus.COMPLETED) {
      return { status: 'COMPLETED', analysis: existing, reused: true };
    }
    if (!this.llm.isAvailable()) {
      return {
        status: 'FAILED',
        analysis: existing,
        errorKind: 'NOT_CONFIGURED',
        message: 'ANTHROPIC_API_KEY is not configured; analysis was not attempted',
        retryable: true,
      };
    }

    const claim = await this.analyses.claim({
      fingerprint: fp,
      paperVersionId: version.id,
      coverage: version.contentCoverage,
      model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      leaseSeconds: this.config.research.leaseSeconds,
    });
    if (claim.outcome === 'COMPLETED')
      return { status: 'COMPLETED', analysis: claim.analysis, reused: true };
    if (claim.outcome === 'BUSY') return this.waitForOther(claim.analysis, options);

    return this.performClaimed(claim.analysis, version, paper);
  }

  /** Runs outside any DB transaction: the claim is already committed. */
  private async performClaimed(
    claimed: PaperAnalysisModel,
    version: PaperVersionModel,
    paper: PaperModel,
  ): Promise<AnalysisOutcome> {
    const abstractOnly = version.contentCoverage === ContentCoverage.ABSTRACT_ONLY;
    const sourceText = `${version.title}\n${version.abstract ?? ''}`;
    try {
      const result = await this.llm.generateJson({
        task: LlmTask.PAPER_ANALYSIS,
        system: SYSTEM_PROMPT,
        schema: ANALYSIS_SCHEMA,
        maxTokens: 8000,
        prompt: buildPrompt(version, paper),
      });
      const content = validateAnalysisOutput(result.data, sourceText, abstractOnly);
      const analysis = await this.analyses.complete(claimed.id, {
        content,
        sourceReferences: buildSourceReferences(version, paper),
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      });
      if (analysis.status !== AnalysisStatus.COMPLETED) {
        return { status: 'IN_PROGRESS', analysis };
      }
      return { status: 'COMPLETED', analysis, reused: false };
    } catch (error) {
      const { kind, retryable } = classify(error);
      const message = (error as Error).message;
      this.logger.warn(`Analysis ${claimed.fingerprint.slice(0, 12)} failed (${kind}): ${message}`);
      await this.analyses.fail(claimed.id, kind, message, retryable);
      const analysis = await this.analyses.findById(claimed.id);
      return { status: 'FAILED', analysis, errorKind: kind, message, retryable };
    }
  }

  private async waitForOther(
    busy: PaperAnalysisModel,
    { waitMs = 0, pollMs = 500 }: { waitMs?: number; pollMs?: number },
  ): Promise<AnalysisOutcome> {
    const deadline = Date.now() + waitMs;
    let current = busy;
    for (let first = true; first || Date.now() < deadline; first = false) {
      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        current = (await this.analyses.findById(busy.id)) ?? current;
      }
      if (current.status === AnalysisStatus.COMPLETED) {
        return { status: 'COMPLETED', analysis: current, reused: true };
      }
      if (current.status === AnalysisStatus.FAILED) {
        return {
          status: 'FAILED',
          analysis: current,
          errorKind: current.errorKind ?? 'UNKNOWN',
          message: current.errorMessage ?? 'Analysis failed in another worker',
          retryable: current.retryable,
        };
      }
    }
    return { status: 'IN_PROGRESS', analysis: current };
  }
}

/**
 * Cache key of a shared analysis: exact version + its content + coverage + model/prompt/schema.
 * Changing any of these produces a new key, so stale analyses are never silently reused.
 */
export function analysisFingerprint(
  version: Pick<
    PaperVersionModel,
    'id' | 'contentFingerprint' | 'publicationStatus' | 'contentCoverage'
  >,
  config: { model: string; promptVersion: string; schemaVersion: number },
): string {
  return fingerprint({
    paperVersionId: version.id,
    contentFingerprint: version.contentFingerprint,
    publicationStatus: version.publicationStatus,
    coverage: version.contentCoverage,
    ...config,
  });
}

function classify(error: unknown): { kind: string; retryable: boolean } {
  if (error instanceof LlmError) return { kind: error.kind, retryable: error.retryable };
  if (error instanceof AnalysisValidationError)
    return { kind: 'VALIDATION_FAILED', retryable: true };
  return { kind: 'UNEXPECTED', retryable: true };
}

function buildPrompt(version: PaperVersionModel, paper: PaperModel): string {
  return [
    `Title: ${version.title}`,
    `Authors: ${paper.authors.slice(0, 12).join(', ') || 'not listed'}`,
    `Publication status (from source metadata): ${version.publicationStatus}`,
    `Venue: ${version.venue ?? 'not stated'}`,
    `First published: ${version.publishedAt}`,
    `Available content: ${version.contentCoverage === ContentCoverage.ABSTRACT_ONLY ? 'ABSTRACT ONLY' : 'FULL TEXT'}`,
    '',
    'Abstract:',
    version.abstract ?? '(no abstract)',
  ].join('\n');
}

/** Source links are derived deterministically from stored metadata, never from LLM output. */
export function buildSourceReferences(
  version: PaperVersionModel,
  paper: PaperModel,
): SourceReferenceModel[] {
  const refs: SourceReferenceModel[] = [
    { kind: 'LANDING', label: 'Source page', url: version.landingUrl },
  ];
  if (paper.doi)
    refs.push({ kind: 'DOI', label: `DOI ${paper.doi}`, url: `https://doi.org/${paper.doi}` });
  if (paper.arxivId) {
    refs.push({
      kind: 'ARXIV',
      label: `arXiv:${paper.arxivId}`,
      url: `https://arxiv.org/abs/${paper.arxivId}`,
    });
  }
  if (version.pdfUrl) refs.push({ kind: 'PDF', label: 'PDF', url: version.pdfUrl });
  const seen = new Set<string>();
  return refs.filter((ref) => (seen.has(ref.url) ? false : (seen.add(ref.url), true)));
}
