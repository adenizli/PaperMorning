import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryStatus, EMAIL_CHANNEL, EmailDeliveryModel } from '../model/email-delivery.model';
import { EmailDeliveryEntity } from './entity/email-delivery.entity';

export type DeliveryClaim =
  | { outcome: 'CLAIMED'; delivery: EmailDeliveryModel }
  | { outcome: 'NOT_CLAIMABLE'; delivery: EmailDeliveryModel };

@Injectable()
export class EmailDeliveryRepositoryService {
  constructor(
    @InjectRepository(EmailDeliveryEntity) private readonly repo: Repository<EmailDeliveryEntity>,
  ) {}

  /** Ensures the single (issue, EMAIL) row exists. */
  async ensure(issueId: string, userId: string, recipient: string): Promise<EmailDeliveryModel> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({
        issueId,
        userId,
        recipient,
        channel: EMAIL_CHANNEL,
        status: DeliveryStatus.PENDING,
      })
      .orIgnore()
      .execute();
    return toModel(await this.repo.findOneByOrFail({ issueId, channel: EMAIL_CHANNEL }));
  }

  /**
   * Stale SENDING (process died mid-send) becomes UNKNOWN: the message may already have been
   * accepted, so it must never be resent automatically.
   */
  async expireStaleSending(issueId: string): Promise<void> {
    await this.repo.query(
      `UPDATE email_delivery
          SET status = 'UNKNOWN', error_code = 'INTERRUPTED',
              error_message = 'Process stopped while sending; outcome unknown', lease_expires_at = NULL,
              updated_at = now()
        WHERE issue_id = $1 AND channel = $2 AND status = 'SENDING' AND lease_expires_at < now()`,
      [issueId, EMAIL_CHANNEL],
    );
  }

  /** PENDING / DISABLED / safely-retryable FAILED -> SENDING, by exactly one caller. */
  async claim(
    issueId: string,
    recipient: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<DeliveryClaim> {
    // Wrapped in a CTE on purpose: TypeORM's raw query() returns [rows, rowCount] for a bare
    // UPDATE, which would make every caller look like the winner. A SELECT returns plain rows.
    const rows: { id: string }[] = await this.repo.query(
      `WITH claimed AS (
         UPDATE email_delivery
            SET status = 'SENDING', attempt_count = attempt_count + 1, recipient = $3,
                lease_expires_at = now() + make_interval(secs => $4), last_attempt_at = now(),
                error_code = NULL, error_message = NULL, updated_at = now()
          WHERE issue_id = $1 AND channel = $2
            AND (status IN ('PENDING', 'DISABLED')
                 OR (status = 'FAILED' AND retryable AND attempt_count < $5
                     AND (next_attempt_at IS NULL OR next_attempt_at <= now())))
          RETURNING id)
       SELECT id FROM claimed`,
      [issueId, EMAIL_CHANNEL, recipient, leaseSeconds, maxAttempts],
    );
    const delivery = toModel(await this.repo.findOneByOrFail({ issueId, channel: EMAIL_CHANNEL }));
    return rows.length > 0
      ? { outcome: 'CLAIMED', delivery }
      : { outcome: 'NOT_CLAIMABLE', delivery };
  }

  async markSent(id: string, providerMessageId: string | null): Promise<EmailDeliveryModel> {
    return this.transition(id, DeliveryStatus.SENDING, {
      status: DeliveryStatus.SENT,
      providerMessageId,
      sentAt: new Date(),
    });
  }

  async markFailed(
    id: string,
    error: { code: string; message: string; retryable: boolean; nextAttemptAt: Date | null },
  ): Promise<EmailDeliveryModel> {
    return this.transition(id, DeliveryStatus.SENDING, {
      status: DeliveryStatus.FAILED,
      errorCode: error.code,
      errorMessage: error.message.slice(0, 1000),
      retryable: error.retryable,
      nextAttemptAt: error.nextAttemptAt,
    });
  }

  async markUnknown(id: string, message: string): Promise<EmailDeliveryModel> {
    return this.transition(id, DeliveryStatus.SENDING, {
      status: DeliveryStatus.UNKNOWN,
      errorCode: 'OUTCOME_UNKNOWN',
      errorMessage: message.slice(0, 1000),
    });
  }

  /** Mail transport not configured: visible state, not an attempt. */
  async markDisabled(issueId: string): Promise<EmailDeliveryModel> {
    await this.repo.update(
      { issueId, channel: EMAIL_CHANNEL, status: DeliveryStatus.PENDING },
      {
        status: DeliveryStatus.DISABLED,
        errorCode: 'MAIL_DISABLED',
        errorMessage: 'Mail transport is not configured',
      },
    );
    return toModel(await this.repo.findOneByOrFail({ issueId, channel: EMAIL_CHANNEL }));
  }

  /** Operator resolution of an UNKNOWN delivery after checking the provider/mailbox. */
  async resolveUnknown(id: string, resolution: 'SENT' | 'RETRY'): Promise<EmailDeliveryModel> {
    return this.transition(
      id,
      DeliveryStatus.UNKNOWN,
      resolution === 'SENT'
        ? { status: DeliveryStatus.SENT, sentAt: new Date(), errorCode: 'RESOLVED_BY_OPERATOR' }
        : {
            status: DeliveryStatus.FAILED,
            retryable: true,
            nextAttemptAt: null,
            errorCode: 'RETRY_BY_OPERATOR',
          },
    );
  }

  async findByIssue(issueId: string): Promise<EmailDeliveryModel | null> {
    const entity = await this.repo.findOneBy({ issueId, channel: EMAIL_CHANNEL });
    return entity ? toModel(entity) : null;
  }

  async findById(id: string): Promise<EmailDeliveryModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  private async transition(
    id: string,
    from: DeliveryStatus,
    patch: Partial<EmailDeliveryEntity>,
  ): Promise<EmailDeliveryModel> {
    await this.repo.update({ id, status: from }, { ...patch, leaseExpiresAt: null });
    return toModel(await this.repo.findOneByOrFail({ id }));
  }
}

function toModel(e: EmailDeliveryEntity): EmailDeliveryModel {
  return {
    id: e.id,
    issueId: e.issueId,
    userId: e.userId,
    channel: e.channel,
    status: e.status,
    recipient: e.recipient,
    attemptCount: e.attemptCount,
    retryable: e.retryable,
    providerMessageId: e.providerMessageId,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
    nextAttemptAt: e.nextAttemptAt,
    lastAttemptAt: e.lastAttemptAt,
    sentAt: e.sentAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
