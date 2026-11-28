import { Injectable } from '@nestjs/common';
import type { ResearchPaperView, ResearchQuery } from '../model/research-paper-view.model';
import {
  MAX_ANALYSIS_ATTEMPTS,
  PaperAnalysisRepositoryService,
} from '../repository/paper-analysis-repository.service';
import { PaperRepositoryService } from '../repository/paper-repository.service';
import { PaperScreeningRepositoryService } from '../repository/paper-screening-repository.service';
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_SCHEMA_VERSION } from './paper-analysis.service';

export interface FailedAnalysisView {
  analysisId: string;
  title: string;
  promptVersion: string;
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
  retryEligible: boolean;
  errorKind: string | null;
  error: string | null;
  updatedAt: string;
}

/**
 * Narrow read-only API for other domains. Returns analyzed, topic-accepted papers with full
 * provenance; one view per paper (its most recent analyzed version).
 */
@Injectable()
export class ResearchQueryService {
  constructor(
    private readonly analyses: PaperAnalysisRepositoryService,
    private readonly screenings: PaperScreeningRepositoryService,
    private readonly papers: PaperRepositoryService,
  ) {}

  async listAnalyzedPapers(query: ResearchQuery): Promise<ResearchPaperView[]> {
    if (query.topicKeys.length === 0) return [];
    const rows = await this.analyses.findCompletedWithVersions({
      publishedFrom: query.publishedFrom,
      publishedUntil: query.publishedUntil,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
    });
    const views = await this.toViews(rows, query.topicKeys);
    return query.limit ? views.slice(0, query.limit) : views;
  }

  /**
   * Recent FAILED analyses for the operator. `retryEligible`: a later research run will claim it
   * again (retryable, attempts left, written by the current prompt version).
   */
  async listFailedAnalyses(limit = 10): Promise<FailedAnalysisView[]> {
    const rows = await this.analyses.listFailed(limit);
    return rows.map((r) => ({
      analysisId: r.id,
      title: r.title,
      promptVersion: r.promptVersion,
      attempts: r.attempts,
      maxAttempts: MAX_ANALYSIS_ATTEMPTS,
      retryable: r.retryable,
      retryEligible:
        r.retryable &&
        r.attempts < MAX_ANALYSIS_ATTEMPTS &&
        r.promptVersion === ANALYSIS_PROMPT_VERSION,
      errorKind: r.errorKind,
      error: r.errorMessage?.slice(0, 300) ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getByAnalysisIds(analysisIds: string[], topicKeys: string[]): Promise<ResearchPaperView[]> {
    const rows = await this.analyses.findCompletedWithVersions({
      analysisIds,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
    });
    return this.toViews(rows, topicKeys, false);
  }

  private async toViews(
    rows: Awaited<ReturnType<PaperAnalysisRepositoryService['findCompletedWithVersions']>>,
    topicKeys: string[],
    latestPerPaper = true,
  ): Promise<ResearchPaperView[]> {
    const accepted = await this.screenings.findAccepted(
      rows.map((r) => r.version.id),
      topicKeys,
    );
    const papers = new Map(
      (await this.papers.findByIds([...new Set(rows.map((r) => r.version.paperId))])).map((p) => [
        p.id,
        p,
      ]),
    );
    const views = new Map<string, ResearchPaperView>();
    for (const { analysis, version } of rows) {
      const matches = accepted
        .filter((s) => s.paperVersionId === version.id)
        .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
      const paper = papers.get(version.paperId);
      if (matches.length === 0 || !paper || !analysis.content) continue;
      const key = latestPerPaper ? paper.id : analysis.id;
      const previous = views.get(key);
      if (previous && previous.publishedAt >= version.publishedAt) continue;
      views.set(key, {
        analysisId: analysis.id,
        analysisFingerprint: analysis.fingerprint,
        paperId: paper.id,
        paperVersionId: version.id,
        topicKey: matches[0].topicKey,
        topicKeys: [...new Set(matches.map((m) => m.topicKey))],
        relevanceScore: matches[0].relevanceScore ?? 0,
        title: version.title,
        authors: paper.authors,
        doi: paper.doi,
        arxivId: paper.arxivId,
        publicationStatus: version.publicationStatus,
        publishedAt: version.publishedAt,
        venue: version.venue,
        abstract: version.abstract,
        coverage: analysis.coverage,
        analysis: analysis.content,
        sourceReferences: analysis.sourceReferences,
        analyzedAt: analysis.completedAt ?? analysis.createdAt,
      });
    }
    return [...views.values()].sort(
      (a, b) => b.relevanceScore - a.relevanceScore || b.publishedAt.localeCompare(a.publishedAt),
    );
  }
}
