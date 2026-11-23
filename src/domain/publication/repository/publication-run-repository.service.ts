import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PublicationCheckpoint,
  PublicationRunModel,
  PublicationRunStatus,
  PublicationStage,
} from '../model/publication-run.model';
import { PublicationRunEntity } from './entity/publication-run.entity';

export type PublicationRunClaim = {
  outcome: 'CLAIMED' | 'COMPLETED' | 'BUSY' | 'EXHAUSTED' | 'BACKOFF';
  run: PublicationRunModel;
};

@Injectable()
export class PublicationRunRepositoryService {
  constructor(
    @InjectRepository(PublicationRunEntity) private readonly repo: Repository<PublicationRunEntity>,
  ) {}

  /**
   * Creates or takes over the single run of a reader/day. A FAILED run is retried only while
   * retryable, under the attempt limit and after its back-off; an expired RUNNING lease
   * (crashed process) is taken over and resumes from its persisted stage.
   */
  async claim(
    userId: string,
    issueDate: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<PublicationRunClaim> {
    const rows: { id: string }[] = await this.repo.query(
      `INSERT INTO publication_run (user_id, issue_date, status, stage, attempt_count, lease_expires_at)
       VALUES ($1, $2, 'RUNNING', 'SELECTING', 1, now() + make_interval(secs => $3))
       ON CONFLICT (user_id, issue_date) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = publication_run.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             updated_at = now()
       WHERE (publication_run.status = 'FAILED' AND publication_run.retryable
               AND publication_run.attempt_count < $4
               AND (publication_run.next_attempt_at IS NULL OR publication_run.next_attempt_at <= now()))
          OR (publication_run.status = 'RUNNING' AND publication_run.lease_expires_at < now())
       RETURNING id`,
      [userId, issueDate, leaseSeconds, maxAttempts],
    );
    const run = toModel(await this.repo.findOneByOrFail({ userId, issueDate }));
    if (rows.length > 0) return { outcome: 'CLAIMED', run };
    if (run.status === PublicationRunStatus.COMPLETED) return { outcome: 'COMPLETED', run };
    if (run.status === PublicationRunStatus.RUNNING) return { outcome: 'BUSY', run };
    if (!run.retryable || run.attemptCount >= maxAttempts) return { outcome: 'EXHAUSTED', run };
    return { outcome: 'BACKOFF', run };
  }

  async checkpoint(
    id: string,
    stage: PublicationStage,
    checkpoint: PublicationCheckpoint,
  ): Promise<PublicationRunModel> {
    await this.repo.update({ id }, { stage, checkpoint });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async complete(id: string, issueId: string): Promise<PublicationRunModel> {
    await this.repo.update(
      { id },
      {
        status: PublicationRunStatus.COMPLETED,
        stage: PublicationStage.READY,
        issueId,
        errorKind: null,
        errorMessage: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    );
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async fail(
    id: string,
    error: { kind: string; message: string; retryable: boolean; nextAttemptAt: Date | null },
  ): Promise<PublicationRunModel> {
    await this.repo.update(
      { id },
      {
        status: PublicationRunStatus.FAILED,
        errorKind: error.kind,
        errorMessage: error.message.slice(0, 2000),
        retryable: error.retryable,
        nextAttemptAt: error.nextAttemptAt,
        leaseExpiresAt: null,
      },
    );
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Records (once) that the reader's issue was not ready at the delivery deadline. */
  async markLate(userId: string, issueDate: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ lateAt: at })
      .where('user_id = :userId AND issue_date = :issueDate AND late_at IS NULL', {
        userId,
        issueDate,
      })
      .execute();
  }

  async findByUserDate(userId: string, issueDate: string): Promise<PublicationRunModel | null> {
    const entity = await this.repo.findOneBy({ userId, issueDate });
    return entity ? toModel(entity) : null;
  }
}

function toModel(e: PublicationRunEntity): PublicationRunModel {
  return {
    id: e.id,
    userId: e.userId,
    issueDate: e.issueDate,
    status: e.status,
    stage: e.stage,
    checkpoint: e.checkpoint ?? {},
    attemptCount: e.attemptCount,
    retryable: e.retryable,
    errorKind: e.errorKind,
    errorMessage: e.errorMessage,
    nextAttemptAt: e.nextAttemptAt,
    lateAt: e.lateAt,
    issueId: e.issueId,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    updatedAt: e.updatedAt,
  };
}
