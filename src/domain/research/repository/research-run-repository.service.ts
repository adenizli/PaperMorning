import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import {
  EMPTY_RUN_COUNTS,
  ResearchRunCounts,
  ResearchRunModel,
  ResearchRunStage,
  ResearchRunStatus,
} from '../model/research-run.model';
import { ResearchRunEntity } from './entity/research-run.entity';

export const MAX_RUN_ATTEMPTS = 5;

export type RunClaim =
  /** `claimToken` fences every later change: a takeover replaces it. */
  | { outcome: 'CLAIMED'; run: ResearchRunModel; claimToken: string }
  | { outcome: 'COMPLETED'; run: ResearchRunModel }
  | { outcome: 'BUSY'; run: ResearchRunModel };

export type RunCheckpoint = Partial<
  Pick<
    ResearchRunModel,
    'stage' | 'counts' | 'discoveredVersionIds' | 'candidateVersionIds' | 'errors'
  >
>;

@Injectable()
export class ResearchRunRepositoryService {
  constructor(
    @InjectRepository(ResearchRunEntity) private readonly repo: Repository<ResearchRunEntity>,
  ) {}

  /**
   * Creates or takes over the run for a key, keeping its persisted stage and checkpoints. Each
   * claim gets a fresh fencing token; the previous owner's checkpoints and terminal updates are
   * rejected from then on.
   */
  async claim(input: {
    runKey: string;
    trigger: string;
    topicKey: string;
    windowFrom: string;
    windowUntil: string;
    leaseSeconds: number;
  }): Promise<RunClaim> {
    const rows: { id: string; claim_token: string }[] = await this.repo.query(
      `INSERT INTO research_run
         (run_key, trigger, topic_key, window_from, window_until, status, stage, counts,
          attempt_count, lease_expires_at, claim_token)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'DISCOVERY', $6, 1, now() + make_interval(secs => $7),
               gen_random_uuid())
       ON CONFLICT (run_key) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = research_run.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             claim_token = EXCLUDED.claim_token,
             updated_at = now()
       WHERE (research_run.status = 'FAILED' AND research_run.attempt_count < $8)
          OR (research_run.status = 'RUNNING' AND research_run.lease_expires_at < now())
       RETURNING id, claim_token`,
      [
        input.runKey,
        input.trigger,
        input.topicKey,
        input.windowFrom,
        input.windowUntil,
        JSON.stringify(EMPTY_RUN_COUNTS),
        input.leaseSeconds,
        MAX_RUN_ATTEMPTS,
      ],
    );
    const run = toModel(await this.repo.findOneByOrFail({ runKey: input.runKey }));
    if (rows.length > 0) return { outcome: 'CLAIMED', run, claimToken: rows[0].claim_token };
    if (run.status === ResearchRunStatus.COMPLETED) return { outcome: 'COMPLETED', run };
    return { outcome: 'BUSY', run };
  }

  /**
   * Persists progress and extends the lease (heartbeat) while the caller still owns the claim.
   * Throws ClaimLostError for a stale worker.
   */
  async checkpoint(
    id: string,
    claimToken: string,
    patch: RunCheckpoint,
    leaseSeconds: number,
  ): Promise<ResearchRunModel> {
    await this.guardedUpdate(id, claimToken, {
      ...patch,
      leaseExpiresAt: () => `now() + make_interval(secs => ${Math.ceil(leaseSeconds)})`,
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Extends the lease if the claim is still held; false means another worker took over. */
  async renew(id: string, claimToken: string, leaseSeconds: number): Promise<boolean> {
    try {
      await this.checkpoint(id, claimToken, {}, leaseSeconds);
      return true;
    } catch (error) {
      if (error instanceof ClaimLostError) return false;
      throw error;
    }
  }

  async complete(
    id: string,
    claimToken: string,
    counts: ResearchRunCounts,
    errors: string[],
  ): Promise<ResearchRunModel> {
    await this.guardedUpdate(id, claimToken, {
      status: ResearchRunStatus.COMPLETED,
      stage: ResearchRunStage.DONE,
      counts,
      errors,
      leaseExpiresAt: null,
      claimToken: null,
      completedAt: new Date(),
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async fail(id: string, claimToken: string, errors: string[]): Promise<ResearchRunModel> {
    await this.guardedUpdate(id, claimToken, {
      status: ResearchRunStatus.FAILED,
      errors,
      leaseExpiresAt: null,
      claimToken: null,
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async findById(id: string): Promise<ResearchRunModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  /** Applies a change only if `claimToken` is still the current claim of a RUNNING run. */
  private async guardedUpdate(
    id: string,
    claimToken: string,
    patch: QueryDeepPartialEntity<ResearchRunEntity>,
  ): Promise<void> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set(patch)
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: ResearchRunStatus.RUNNING,
      })
      .execute();
    if (!result.affected) throw new ClaimLostError(`Research run ${id}`);
  }

  async findByKey(runKey: string): Promise<ResearchRunModel | null> {
    const entity = await this.repo.findOneBy({ runKey });
    return entity ? toModel(entity) : null;
  }
}

function toModel(entity: ResearchRunEntity): ResearchRunModel {
  return {
    id: entity.id,
    runKey: entity.runKey,
    trigger: entity.trigger,
    topicKey: entity.topicKey,
    windowFrom: entity.windowFrom,
    windowUntil: entity.windowUntil,
    status: entity.status,
    stage: entity.stage,
    counts: { ...EMPTY_RUN_COUNTS, ...entity.counts },
    discoveredVersionIds: entity.discoveredVersionIds,
    candidateVersionIds: entity.candidateVersionIds,
    errors: entity.errors,
    attemptCount: entity.attemptCount,
    startedAt: entity.startedAt,
    completedAt: entity.completedAt,
    updatedAt: entity.updatedAt,
  };
}
