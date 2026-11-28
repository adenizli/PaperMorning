import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import type { ContentCoverage } from '../../../common/enum/research.enum';
import {
  AnalysisStatus,
  PaperAnalysisContent,
  PaperAnalysisModel,
  SourceReferenceModel,
} from '../model/paper-analysis.model';
import type { PaperVersionModel } from '../model/paper-version.model';
import { PaperAnalysisEntity } from './entity/paper-analysis.entity';
import { toVersionModel } from './paper-version-repository.service';

export const MAX_ANALYSIS_ATTEMPTS = 3;

export type ClaimOutcome =
  /** `claimToken` fences every later change: a newer claim invalidates it. */
  | { outcome: 'CLAIMED'; analysis: PaperAnalysisModel; claimToken: string }
  | { outcome: 'COMPLETED'; analysis: PaperAnalysisModel }
  | { outcome: 'BUSY'; analysis: PaperAnalysisModel };

export interface AnalysisClaimInput {
  fingerprint: string;
  paperVersionId: string;
  coverage: ContentCoverage;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  leaseSeconds: number;
}

export interface AnalysisWithVersion {
  analysis: PaperAnalysisModel;
  version: PaperVersionModel;
}

@Injectable()
export class PaperAnalysisRepositoryService {
  constructor(
    @InjectRepository(PaperAnalysisEntity) private readonly repo: Repository<PaperAnalysisEntity>,
  ) {}

  async findByFingerprint(fingerprint: string): Promise<PaperAnalysisModel | null> {
    const entity = await this.repo.findOneBy({ fingerprint });
    return entity ? toModel(entity) : null;
  }

  /** Most recent FAILED analyses with their paper title (operator status; read-only). */
  async listFailed(limit: number): Promise<
    {
      id: string;
      title: string;
      promptVersion: string;
      attempts: number;
      retryable: boolean;
      errorKind: string | null;
      errorMessage: string | null;
      updatedAt: Date;
    }[]
  > {
    const rows: Record<string, unknown>[] = await this.repo.query(
      `SELECT a.id, v.title, a.prompt_version, a.attempt_count, a.retryable, a.error_kind,
              a.error_message, a.updated_at
         FROM paper_analysis a JOIN paper_version v ON v.id = a.paper_version_id
        WHERE a.status = 'FAILED'
        ORDER BY a.updated_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      promptVersion: r.prompt_version as string,
      attempts: Number(r.attempt_count),
      retryable: Boolean(r.retryable),
      errorKind: (r.error_kind as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async findById(id: string): Promise<PaperAnalysisModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  /**
   * Atomically claims the right to perform one billable analysis. Exactly one caller can win the
   * INSERT or the takeover of a retryable FAILED row / an expired RUNNING lease; everyone else
   * sees the existing row. Runs as a single statement, never across a network call. Every claim
   * (insert or takeover) gets a fresh fencing token, so a worker whose lease expired can no longer
   * complete or fail the row once someone else has taken it over.
   */
  async claim(input: AnalysisClaimInput): Promise<ClaimOutcome> {
    const rows: { id: string; claim_token: string }[] = await this.repo.query(
      `INSERT INTO paper_analysis
         (fingerprint, paper_version_id, status, coverage, model, prompt_version, schema_version,
          attempt_count, retryable, lease_expires_at, claim_token)
       VALUES ($1, $2, 'RUNNING', $3, $4, $5, $6, 1, true, now() + make_interval(secs => $7),
               gen_random_uuid())
       ON CONFLICT (fingerprint) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = paper_analysis.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             claim_token = EXCLUDED.claim_token,
             error_kind = NULL,
             error_message = NULL,
             updated_at = now()
       WHERE (paper_analysis.status = 'FAILED' AND paper_analysis.retryable
               AND paper_analysis.attempt_count < $8)
          OR (paper_analysis.status = 'RUNNING' AND paper_analysis.lease_expires_at < now())
       RETURNING id, claim_token`,
      [
        input.fingerprint,
        input.paperVersionId,
        input.coverage,
        input.model,
        input.promptVersion,
        input.schemaVersion,
        input.leaseSeconds,
        MAX_ANALYSIS_ATTEMPTS,
      ],
    );
    const analysis = toModel(await this.repo.findOneByOrFail({ fingerprint: input.fingerprint }));
    if (rows.length > 0) return { outcome: 'CLAIMED', analysis, claimToken: rows[0].claim_token };
    if (analysis.status === AnalysisStatus.COMPLETED) return { outcome: 'COMPLETED', analysis };
    return { outcome: 'BUSY', analysis };
  }

  /**
   * Extends the lease while the caller still owns the claim (same token, still RUNNING).
   * Returns false when the claim was lost; the caller must then stop without paying or writing.
   */
  async renew(id: string, claimToken: string, leaseSeconds: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({ leaseExpiresAt: () => `now() + make_interval(secs => ${Math.ceil(leaseSeconds)})` })
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: AnalysisStatus.RUNNING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Commits a result only while the caller still owns the claim. A stale worker (token replaced by
   * a takeover) gets ClaimLostError and must not overwrite the newer owner's row.
   */
  async complete(
    id: string,
    claimToken: string,
    result: {
      content: PaperAnalysisContent;
      sourceReferences: SourceReferenceModel[];
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    },
  ): Promise<PaperAnalysisModel> {
    const updated = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: AnalysisStatus.COMPLETED,
        content: result.content,
        sourceReferences: result.sourceReferences,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        completedAt: () => 'now()',
        leaseExpiresAt: null,
        claimToken: null,
      })
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: AnalysisStatus.RUNNING,
      })
      .execute();
    if (!updated.affected) throw new ClaimLostError(`Paper analysis ${id}`);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Records a failure only while the caller still owns the claim; returns false if it was lost. */
  async fail(
    id: string,
    claimToken: string,
    errorKind: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: AnalysisStatus.FAILED,
        errorKind,
        errorMessage: errorMessage.slice(0, 2000),
        retryable,
        leaseExpiresAt: null,
        claimToken: null,
      })
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: AnalysisStatus.RUNNING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** Completed analyses (current prompt/schema) with their versions, for the public query API. */
  async findCompletedWithVersions(filter: {
    paperVersionIds?: string[];
    analysisIds?: string[];
    publishedFrom?: string;
    publishedUntil?: string;
    promptVersion: string;
    schemaVersion: number;
  }): Promise<AnalysisWithVersion[]> {
    const query = this.repo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.paperVersion', 'v')
      .where('a.status = :status', { status: AnalysisStatus.COMPLETED })
      .andWhere('a.prompt_version = :pv AND a.schema_version = :sv', {
        pv: filter.promptVersion,
        sv: filter.schemaVersion,
      });
    if (filter.paperVersionIds) {
      if (filter.paperVersionIds.length === 0) return [];
      query.andWhere('a.paper_version_id IN (:...vids)', { vids: filter.paperVersionIds });
    }
    if (filter.analysisIds) {
      if (filter.analysisIds.length === 0) return [];
      query.andWhere('a.id IN (:...aids)', { aids: filter.analysisIds });
    }
    if (filter.publishedFrom)
      query.andWhere('v.published_at >= :from', { from: filter.publishedFrom });
    if (filter.publishedUntil) {
      query.andWhere('v.published_at <= :until', { until: filter.publishedUntil });
    }
    const entities = await query.orderBy('v.published_at', 'DESC').getMany();
    return entities.map((entity) => ({
      analysis: toModel(entity),
      version: toVersionModel(entity.paperVersion!),
    }));
  }
}

function toModel(entity: PaperAnalysisEntity): PaperAnalysisModel {
  return {
    id: entity.id,
    paperVersionId: entity.paperVersionId,
    fingerprint: entity.fingerprint,
    status: entity.status,
    coverage: entity.coverage,
    content: entity.content,
    sourceReferences: entity.sourceReferences,
    model: entity.model,
    promptVersion: entity.promptVersion,
    schemaVersion: entity.schemaVersion,
    attemptCount: entity.attemptCount,
    retryable: entity.retryable,
    errorKind: entity.errorKind,
    errorMessage: entity.errorMessage,
    inputTokens: entity.inputTokens,
    outputTokens: entity.outputTokens,
    costUsd: entity.costUsd,
    completedAt: entity.completedAt,
    createdAt: entity.createdAt,
  };
}
