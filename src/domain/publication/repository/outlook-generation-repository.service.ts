import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { GenerationStatus } from '../model/article-variant.model';
import type { OutlookReportModel } from '../model/outlook-report.model';
import { OutlookGenerationEntity } from './entity/outlook-generation.entity';

import type { FailedGenerationRow } from './article-variant-repository.service';

export const MAX_OUTLOOK_ATTEMPTS = 3;

/** Technical state of one shared Ufuk Raporu generation (see OutlookGenerationEntity). */
export interface OutlookGenerationRecord {
  id: string;
  fingerprint: string;
  status: GenerationStatus;
  report: OutlookReportModel | null;
  attemptCount: number;
  retryable: boolean;
  errorKind: string | null;
  errorMessage: string | null;
}

export type OutlookGenerationClaim =
  | { outcome: 'CLAIMED'; record: OutlookGenerationRecord; claimToken: string }
  | { outcome: 'COMPLETED' | 'BUSY'; record: OutlookGenerationRecord };

@Injectable()
export class OutlookGenerationRepositoryService {
  constructor(
    @InjectRepository(OutlookGenerationEntity)
    private readonly repo: Repository<OutlookGenerationEntity>,
  ) {}

  async findByFingerprint(fingerprint: string): Promise<OutlookGenerationRecord | null> {
    const entity = await this.repo.findOneBy({ fingerprint });
    return entity ? toRecord(entity) : null;
  }

  /** Most recent FAILED reports (operator status; read-only). */
  async listFailed(limit: number): Promise<FailedGenerationRow[]> {
    const rows: Record<string, unknown>[] = await this.repo.query(
      `SELECT id, fingerprint, prompt_version, attempt_count, retryable, error_kind, error_message,
              updated_at
         FROM outlook_generation WHERE status = 'FAILED'
        ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      label: (r.fingerprint as string).slice(0, 12),
      promptVersion: r.prompt_version as string,
      attempts: Number(r.attempt_count),
      retryable: Boolean(r.retryable),
      errorKind: (r.error_kind as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      updatedAt: new Date(r.updated_at as string),
    }));
  }

  async findById(id: string): Promise<OutlookGenerationRecord | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toRecord(entity) : null;
  }

  /**
   * Single-statement claim: exactly one caller wins the insert, the retry of a retryable FAILED
   * row, or the takeover of an expired RUNNING lease. Each win gets a fresh fencing token.
   */
  async claim(input: {
    fingerprint: string;
    model: string;
    promptVersion: string;
    leaseSeconds: number;
  }): Promise<OutlookGenerationClaim> {
    const rows: { claim_token: string }[] = await this.repo.query(
      `INSERT INTO outlook_generation
         (fingerprint, status, model, prompt_version, attempt_count, retryable, lease_expires_at,
          claim_token)
       VALUES ($1, 'RUNNING', $2, $3, 1, true, now() + make_interval(secs => $4), gen_random_uuid())
       ON CONFLICT (fingerprint) DO UPDATE
         SET status = 'RUNNING',
             attempt_count = outlook_generation.attempt_count + 1,
             lease_expires_at = EXCLUDED.lease_expires_at,
             claim_token = EXCLUDED.claim_token,
             error_kind = NULL,
             error_message = NULL,
             updated_at = now()
       WHERE (outlook_generation.status = 'FAILED' AND outlook_generation.retryable
               AND outlook_generation.attempt_count < $5)
          OR (outlook_generation.status = 'RUNNING' AND outlook_generation.lease_expires_at < now())
       RETURNING claim_token`,
      [
        input.fingerprint,
        input.model,
        input.promptVersion,
        input.leaseSeconds,
        MAX_OUTLOOK_ATTEMPTS,
      ],
    );
    const record = toRecord(await this.repo.findOneByOrFail({ fingerprint: input.fingerprint }));
    if (rows.length > 0) return { outcome: 'CLAIMED', record, claimToken: rows[0].claim_token };
    if (record.status === GenerationStatus.COMPLETED) return { outcome: 'COMPLETED', record };
    return { outcome: 'BUSY', record };
  }

  /** Persists the finished report while the claim is held; ClaimLostError for a stale worker. */
  async complete(
    id: string,
    claimToken: string,
    report: OutlookReportModel,
  ): Promise<OutlookGenerationRecord> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: GenerationStatus.COMPLETED,
        report,
        model: report.model,
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
    if (!result.affected) throw new ClaimLostError(`Outlook generation ${id}`);
    return toRecord(await this.repo.findOneByOrFail({ id }));
  }

  /** Records a failure while the claim is held; false if a newer worker owns the row. */
  async fail(
    id: string,
    claimToken: string,
    error: { kind: string; message: string; retryable: boolean },
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: GenerationStatus.FAILED,
        errorKind: error.kind,
        errorMessage: error.message.slice(0, 2000),
        retryable: error.retryable,
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

function toRecord(e: OutlookGenerationEntity): OutlookGenerationRecord {
  return {
    id: e.id,
    fingerprint: e.fingerprint,
    status: e.status,
    report: e.report,
    attemptCount: e.attemptCount,
    retryable: e.retryable,
    errorKind: e.errorKind,
    errorMessage: e.errorMessage,
  };
}
