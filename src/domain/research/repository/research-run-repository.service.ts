import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  | { outcome: 'CLAIMED'; run: ResearchRunModel }
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

  /** Creates or takes over the run for a key, keeping its persisted stage and checkpoints. */
  async claim(input: {
    runKey: string;
    trigger: string;
    topicKey: string;
    windowFrom: string;
    windowUntil: string;
    leaseSeconds: number;
  }): Promise<RunClaim> {
    const rows: { id: string }[] = await this.repo.query(
      `INSERT INTO research_run
         (run_key, trigger, topic_key, window_from, window_until, status, stage, counts,
          attempt_count, lease_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'DISCOVERY', $6, 1, now() + make_interval(secs => $7))
       ON CONFLICT (run_key) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = research_run.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             updated_at = now()
       WHERE (research_run.status = 'FAILED' AND research_run.attempt_count < $8)
          OR (research_run.status = 'RUNNING' AND research_run.lease_expires_at < now())
       RETURNING id`,
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
    if (rows.length > 0) return { outcome: 'CLAIMED', run };
    if (run.status === ResearchRunStatus.COMPLETED) return { outcome: 'COMPLETED', run };
    return { outcome: 'BUSY', run };
  }

  async checkpoint(id: string, patch: RunCheckpoint): Promise<ResearchRunModel> {
    await this.repo.update({ id }, patch);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async complete(
    id: string,
    counts: ResearchRunCounts,
    errors: string[],
  ): Promise<ResearchRunModel> {
    await this.repo.update(
      { id },
      {
        status: ResearchRunStatus.COMPLETED,
        stage: ResearchRunStage.DONE,
        counts,
        errors,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    );
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async fail(id: string, errors: string[]): Promise<ResearchRunModel> {
    await this.repo.update(
      { id },
      { status: ResearchRunStatus.FAILED, errors, leaseExpiresAt: null },
    );
    return toModel(await this.repo.findOneByOrFail({ id }));
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
