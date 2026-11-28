import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import {
  ArticleContent,
  ArticleVariantModel,
  GenerationStatus,
} from '../model/article-variant.model';
import { ArticleVariantEntity } from './entity/article-variant.entity';

export const MAX_VARIANT_ATTEMPTS = 3;

/** A failed generation as the operator sees it (read-only status). */
export interface FailedGenerationRow {
  id: string;
  label: string;
  promptVersion: string;
  attempts: number;
  retryable: boolean;
  errorKind: string | null;
  errorMessage: string | null;
  updatedAt: Date;
}

export type VariantClaimInput = Pick<
  ArticleVariantModel,
  | 'analysisId'
  | 'analysisFingerprint'
  | 'language'
  | 'knowledgeLevel'
  | 'generationFingerprint'
  | 'sourceReferences'
  | 'coverage'
  | 'publicationStatus'
  | 'model'
  | 'promptVersion'
  | 'schemaVersion'
> & { leaseSeconds: number };

export type VariantClaim =
  /** `claimToken` fences completion/failure: a takeover replaces it. */
  | { outcome: 'CLAIMED'; variant: ArticleVariantModel; claimToken: string }
  | { outcome: 'COMPLETED' | 'BUSY'; variant: ArticleVariantModel };

@Injectable()
export class ArticleVariantRepositoryService {
  constructor(
    @InjectRepository(ArticleVariantEntity) private readonly repo: Repository<ArticleVariantEntity>,
  ) {}

  async findByFingerprint(generationFingerprint: string): Promise<ArticleVariantModel | null> {
    const entity = await this.repo.findOneBy({ generationFingerprint });
    return entity ? toModel(entity) : null;
  }

  /** Most recent FAILED variants (operator status; read-only). */
  async listFailed(limit: number): Promise<FailedGenerationRow[]> {
    const rows: Record<string, unknown>[] = await this.repo.query(
      `SELECT id, generation_fingerprint, knowledge_level, prompt_version, attempt_count, retryable,
              error_kind, error_message, updated_at
         FROM article_variant WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      label: `${(r.generation_fingerprint as string).slice(0, 12)} (${r.knowledge_level as string})`,
      promptVersion: r.prompt_version as string,
      attempts: Number(r.attempt_count),
      retryable: Boolean(r.retryable),
      errorKind: (r.error_kind as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async findById(id: string): Promise<ArticleVariantModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  async findByIds(ids: string[]): Promise<ArticleVariantModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.findBy({ id: In(ids) })).map(toModel);
  }

  /**
   * Same single-statement claim protocol as research analyses: one billable writer per key, and a
   * fresh fencing token per claim so a writer whose lease was taken over cannot overwrite it.
   */
  async claim(input: VariantClaimInput): Promise<VariantClaim> {
    const rows: { id: string; claim_token: string }[] = await this.repo.query(
      `INSERT INTO article_variant
         (analysis_id, analysis_fingerprint, language, knowledge_level, generation_fingerprint,
          status, source_references, coverage, publication_status, model, prompt_version,
          schema_version, attempt_count, retryable, lease_expires_at, claim_token)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8, $9, $10, $11, 1, true,
               now() + make_interval(secs => $12), gen_random_uuid())
       ON CONFLICT (generation_fingerprint) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = article_variant.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             claim_token = EXCLUDED.claim_token,
             error_kind = NULL,
             error_message = NULL,
             updated_at = now()
       WHERE (article_variant.status = 'FAILED' AND article_variant.retryable
               AND article_variant.attempt_count < $13)
          OR (article_variant.status = 'RUNNING' AND article_variant.lease_expires_at < now())
       RETURNING id, claim_token`,
      [
        input.analysisId,
        input.analysisFingerprint,
        input.language,
        input.knowledgeLevel,
        input.generationFingerprint,
        JSON.stringify(input.sourceReferences),
        input.coverage,
        input.publicationStatus,
        input.model,
        input.promptVersion,
        input.schemaVersion,
        input.leaseSeconds,
        MAX_VARIANT_ATTEMPTS,
      ],
    );
    const variant = toModel(
      await this.repo.findOneByOrFail({ generationFingerprint: input.generationFingerprint }),
    );
    if (rows.length > 0) return { outcome: 'CLAIMED', variant, claimToken: rows[0].claim_token };
    if (variant.status === GenerationStatus.COMPLETED) return { outcome: 'COMPLETED', variant };
    return { outcome: 'BUSY', variant };
  }

  /** Stores the article while the claim is held; ClaimLostError for a stale writer. */
  async complete(
    id: string,
    claimToken: string,
    result: {
      content: ArticleContent;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    },
  ): Promise<ArticleVariantModel> {
    const updated = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: GenerationStatus.COMPLETED,
        content: result.content,
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
        running: GenerationStatus.RUNNING,
      })
      .execute();
    if (!updated.affected) throw new ClaimLostError(`Article variant ${id}`);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Records a failure while the claim is held; false if a newer writer owns the row. */
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
        status: GenerationStatus.FAILED,
        errorKind,
        errorMessage: errorMessage.slice(0, 2000),
        retryable,
        leaseExpiresAt: null,
        claimToken: null,
      })
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: GenerationStatus.RUNNING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}

function toModel(e: ArticleVariantEntity): ArticleVariantModel {
  return {
    id: e.id,
    analysisId: e.analysisId,
    analysisFingerprint: e.analysisFingerprint,
    language: e.language,
    knowledgeLevel: e.knowledgeLevel,
    generationFingerprint: e.generationFingerprint,
    status: e.status,
    content: e.content,
    sourceReferences: e.sourceReferences,
    coverage: e.coverage,
    publicationStatus: e.publicationStatus,
    model: e.model,
    promptVersion: e.promptVersion,
    schemaVersion: e.schemaVersion,
    attemptCount: e.attemptCount,
    retryable: e.retryable,
    errorKind: e.errorKind,
    errorMessage: e.errorMessage,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    costUsd: e.costUsd,
    completedAt: e.completedAt,
    createdAt: e.createdAt,
  };
}
