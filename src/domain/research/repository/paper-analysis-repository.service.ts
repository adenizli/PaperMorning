import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  | { outcome: 'CLAIMED'; analysis: PaperAnalysisModel }
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

  async findById(id: string): Promise<PaperAnalysisModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  /**
   * Atomically claims the right to perform one billable analysis. Exactly one caller can win the
   * INSERT or the takeover of a retryable FAILED row / an expired RUNNING lease; everyone else
   * sees the existing row. Runs as a single statement, never across a network call.
   */
  async claim(input: AnalysisClaimInput): Promise<ClaimOutcome> {
    const rows: { id: string }[] = await this.repo.query(
      `INSERT INTO paper_analysis
         (fingerprint, paper_version_id, status, coverage, model, prompt_version, schema_version,
          attempt_count, retryable, lease_expires_at)
       VALUES ($1, $2, 'RUNNING', $3, $4, $5, $6, 1, true, now() + make_interval(secs => $7))
       ON CONFLICT (fingerprint) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = paper_analysis.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             error_kind = NULL,
             error_message = NULL,
             updated_at = now()
       WHERE (paper_analysis.status = 'FAILED' AND paper_analysis.retryable
               AND paper_analysis.attempt_count < $8)
          OR (paper_analysis.status = 'RUNNING' AND paper_analysis.lease_expires_at < now())
       RETURNING id`,
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
    if (rows.length > 0) return { outcome: 'CLAIMED', analysis };
    if (analysis.status === AnalysisStatus.COMPLETED) return { outcome: 'COMPLETED', analysis };
    return { outcome: 'BUSY', analysis };
  }

  /** Commits a result only while the claim is still held (status RUNNING). */
  async complete(
    id: string,
    result: {
      content: PaperAnalysisContent;
      sourceReferences: SourceReferenceModel[];
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    },
  ): Promise<PaperAnalysisModel> {
    await this.repo
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
      })
      .where('id = :id AND status = :running', { id, running: AnalysisStatus.RUNNING })
      .execute();
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async fail(
    id: string,
    errorKind: string,
    errorMessage: string,
    retryable: boolean,
  ): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: AnalysisStatus.FAILED,
        errorKind,
        errorMessage: errorMessage.slice(0, 2000),
        retryable,
        leaseExpiresAt: null,
      })
      .where('id = :id AND status = :running', { id, running: AnalysisStatus.RUNNING })
      .execute();
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
