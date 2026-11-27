import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import {
  PublicationCheckpoint,
  PublicationRunModel,
  PublicationRunStatus,
  PublicationStage,
} from '../model/publication-run.model';
import { PublicationRunEntity } from './entity/publication-run.entity';

export type PublicationRunClaim =
  /** `claimToken` fences every later change of the run: a takeover replaces it. */
  | { outcome: 'CLAIMED'; run: PublicationRunModel; claimToken: string }
  | { outcome: 'COMPLETED' | 'BUSY' | 'EXHAUSTED' | 'BACKOFF'; run: PublicationRunModel };

@Injectable()
export class PublicationRunRepositoryService {
  constructor(
    @InjectRepository(PublicationRunEntity) private readonly repo: Repository<PublicationRunEntity>,
  ) {}

  /**
   * Creates or takes over the single run of a reader/day. A FAILED run is retried only while
   * retryable, under the attempt limit and after its back-off; an expired RUNNING lease
   * (crashed process) is taken over and resumes from its persisted stage. Every claim gets a
   * fresh fencing token; the previous owner can no longer checkpoint, complete or fail the run.
   */
  async claim(
    userId: string,
    issueDate: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<PublicationRunClaim> {
    const rows: { id: string; claim_token: string }[] = await this.repo.query(
      `INSERT INTO publication_run
         (user_id, issue_date, status, stage, attempt_count, lease_expires_at, claim_token)
       VALUES ($1, $2, 'RUNNING', 'SELECTING', 1, now() + make_interval(secs => $3),
               gen_random_uuid())
       ON CONFLICT (user_id, issue_date) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = publication_run.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             claim_token = EXCLUDED.claim_token,
             updated_at = now()
       WHERE (publication_run.status = 'FAILED' AND publication_run.retryable
               AND publication_run.attempt_count < $4
               AND (publication_run.next_attempt_at IS NULL OR publication_run.next_attempt_at <= now()))
          OR (publication_run.status = 'RUNNING' AND publication_run.lease_expires_at < now())
       RETURNING id, claim_token`,
      [userId, issueDate, leaseSeconds, maxAttempts],
    );
    const run = toModel(await this.repo.findOneByOrFail({ userId, issueDate }));
    if (rows.length > 0) return { outcome: 'CLAIMED', run, claimToken: rows[0].claim_token };
    if (run.status === PublicationRunStatus.COMPLETED) return { outcome: 'COMPLETED', run };
    if (run.status === PublicationRunStatus.RUNNING) return { outcome: 'BUSY', run };
    if (!run.retryable || run.attemptCount >= maxAttempts) return { outcome: 'EXHAUSTED', run };
    return { outcome: 'BACKOFF', run };
  }

  /** Persists a checkpoint and extends the lease (heartbeat) while the claim is held. */
  async checkpoint(
    id: string,
    claimToken: string,
    stage: PublicationStage,
    checkpoint: PublicationCheckpoint,
    leaseSeconds: number,
  ): Promise<PublicationRunModel> {
    await this.guardedUpdate(id, claimToken, {
      stage,
      checkpoint,
      leaseExpiresAt: () => `now() + make_interval(secs => ${Math.ceil(leaseSeconds)})`,
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Extends the lease if the claim is still held; false means another worker took over. */
  async renew(id: string, claimToken: string, leaseSeconds: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({ leaseExpiresAt: () => `now() + make_interval(secs => ${Math.ceil(leaseSeconds)})` })
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: PublicationRunStatus.RUNNING,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async complete(id: string, claimToken: string, issueId: string): Promise<PublicationRunModel> {
    await this.guardedUpdate(id, claimToken, {
      status: PublicationRunStatus.COMPLETED,
      stage: PublicationStage.READY,
      issueId,
      errorKind: null,
      errorMessage: null,
      leaseExpiresAt: null,
      claimToken: null,
      completedAt: new Date(),
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async fail(
    id: string,
    claimToken: string,
    error: { kind: string; message: string; retryable: boolean; nextAttemptAt: Date | null },
  ): Promise<PublicationRunModel> {
    await this.guardedUpdate(id, claimToken, {
      status: PublicationRunStatus.FAILED,
      errorKind: error.kind,
      errorMessage: error.message.slice(0, 2000),
      retryable: error.retryable,
      nextAttemptAt: error.nextAttemptAt,
      leaseExpiresAt: null,
      claimToken: null,
    });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /**
   * Records (once) that the reader's issue was not ready at the delivery deadline. A run that
   * already completed (issue READY) is never marked late afterwards.
   */
  async markLate(userId: string, issueDate: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ lateAt: at })
      .where(
        'user_id = :userId AND issue_date = :issueDate AND late_at IS NULL AND status <> :completed',
        { userId, issueDate, completed: PublicationRunStatus.COMPLETED },
      )
      .execute();
  }

  async findByUserDate(userId: string, issueDate: string): Promise<PublicationRunModel | null> {
    const entity = await this.repo.findOneBy({ userId, issueDate });
    return entity ? toModel(entity) : null;
  }

  async findById(id: string): Promise<PublicationRunModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  /** Applies a change only while `claimToken` is the current claim of a RUNNING run. */
  private async guardedUpdate(
    id: string,
    claimToken: string,
    patch: QueryDeepPartialEntity<PublicationRunEntity>,
  ): Promise<void> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set(patch)
      .where('id = :id AND claim_token = :claimToken AND status = :running', {
        id,
        claimToken,
        running: PublicationRunStatus.RUNNING,
      })
      .execute();
    if (!result.affected) throw new ClaimLostError(`Publication run ${id}`);
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
    leaseExpiresAt: e.leaseExpiresAt,
    lateAt: e.lateAt,
    issueId: e.issueId,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    updatedAt: e.updatedAt,
  };
}
