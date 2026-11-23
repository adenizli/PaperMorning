import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ArticleContent,
  ArticleVariantModel,
  GenerationStatus,
} from '../model/article-variant.model';
import { ArticleVariantEntity } from './entity/article-variant.entity';

export const MAX_VARIANT_ATTEMPTS = 3;

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

export type VariantClaim = {
  outcome: 'CLAIMED' | 'COMPLETED' | 'BUSY';
  variant: ArticleVariantModel;
};

@Injectable()
export class ArticleVariantRepositoryService {
  constructor(
    @InjectRepository(ArticleVariantEntity) private readonly repo: Repository<ArticleVariantEntity>,
  ) {}

  async findByFingerprint(generationFingerprint: string): Promise<ArticleVariantModel | null> {
    const entity = await this.repo.findOneBy({ generationFingerprint });
    return entity ? toModel(entity) : null;
  }

  async findById(id: string): Promise<ArticleVariantModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  async findByIds(ids: string[]): Promise<ArticleVariantModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.findBy({ id: In(ids) })).map(toModel);
  }

  /** Same single-statement claim protocol as research analyses: one billable writer per key. */
  async claim(input: VariantClaimInput): Promise<VariantClaim> {
    const rows: { id: string }[] = await this.repo.query(
      `INSERT INTO article_variant
         (analysis_id, analysis_fingerprint, language, knowledge_level, generation_fingerprint,
          status, source_references, coverage, publication_status, model, prompt_version,
          schema_version, attempt_count, retryable, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8, $9, $10, $11, 1, true,
               now() + make_interval(secs => $12))
       ON CONFLICT (generation_fingerprint) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = article_variant.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             error_kind = NULL,
             error_message = NULL,
             updated_at = now()
       WHERE (article_variant.status = 'FAILED' AND article_variant.retryable
               AND article_variant.attempt_count < $13)
          OR (article_variant.status = 'RUNNING' AND article_variant.lease_expires_at < now())
       RETURNING id`,
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
    if (rows.length > 0) return { outcome: 'CLAIMED', variant };
    if (variant.status === GenerationStatus.COMPLETED) return { outcome: 'COMPLETED', variant };
    return { outcome: 'BUSY', variant };
  }

  async complete(
    id: string,
    result: {
      content: ArticleContent;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    },
  ): Promise<ArticleVariantModel> {
    await this.repo
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
      })
      .where('id = :id AND status = :running', { id, running: GenerationStatus.RUNNING })
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
        status: GenerationStatus.FAILED,
        errorKind,
        errorMessage: errorMessage.slice(0, 2000),
        retryable,
        leaseExpiresAt: null,
      })
      .where('id = :id AND status = :running', { id, running: GenerationStatus.RUNNING })
      .execute();
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
