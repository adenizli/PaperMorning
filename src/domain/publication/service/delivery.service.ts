import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config';
import { MAIL_TRANSPORT, MailTransport } from '../../../service/mail/mail-transport';
import { AccountService, PreferenceService } from '../../account';
import { DeliveryStatus, EmailDeliveryModel } from '../model/email-delivery.model';
import { IssueStatus } from '../model/issue.model';
import { EmailDeliveryRepositoryService } from '../repository/email-delivery-repository.service';
import { buildDigest } from './issue-digest';
import { IssueService } from './issue.service';
import { PublicationError } from './publication-error';

/** Conservative estimate of base64 + MIME overhead on top of the raw PDF size. */
const MIME_OVERHEAD = 4 / 3;

export type DeliveryOutcome =
  | 'SENT'
  | 'ALREADY_SENT'
  | 'NOT_OPTED_IN'
  | 'NOT_READY'
  | 'IN_PROGRESS'
  | 'FAILED'
  | 'UNKNOWN'
  | 'DISABLED';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  delivery: EmailDeliveryModel | null;
  message?: string;
}

/**
 * Sends one reader's READY issue: explicit opt-in only, readable digest from the frozen snapshot,
 * and the verified personalized PDF always attached. State lives in email_delivery; ambiguous
 * SMTP outcomes become UNKNOWN and are never resent automatically.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly accounts: AccountService,
    private readonly preferences: PreferenceService,
    private readonly issues: IssueService,
    private readonly deliveries: EmailDeliveryRepositoryService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  async sendReadyIssue(userId: string, issueDate: string): Promise<DeliveryResult> {
    const profile = await this.preferences.getForUser(userId);
    if (!profile.reader.dailyEmailEnabled) return { outcome: 'NOT_OPTED_IN', delivery: null };

    const issue = await this.issues.findByUserDate(userId, issueDate);
    if (!issue || issue.status !== IssueStatus.READY)
      return { outcome: 'NOT_READY', delivery: null };
    const user = await this.accounts.getById(userId);
    if (!user) return { outcome: 'NOT_READY', delivery: null, message: 'User no longer exists' };

    const existing = await this.deliveries.ensure(issue.id, userId, user.email);
    if (!this.transport.isEnabled()) {
      if (existing.status === DeliveryStatus.PENDING) {
        return { outcome: 'DISABLED', delivery: await this.deliveries.markDisabled(issue.id) };
      }
      return this.describe(existing);
    }

    await this.deliveries.expireStaleSending(issue.id);
    const claim = await this.deliveries.claim(
      issue.id,
      user.email,
      this.config.publication.leaseSeconds,
      this.config.publication.maxDeliveryAttempts,
    );
    if (claim.outcome === 'NOT_CLAIMABLE') return this.describe(claim.delivery);
    const delivery = claim.delivery;

    // Attachment checks happen after the claim and before any network call.
    let pdf: Buffer;
    try {
      pdf = await this.issues.readVerifiedPdf(issue);
      if (pdf.length * MIME_OVERHEAD > this.config.publication.maxAttachmentBytes) {
        throw new PublicationError(
          'ATTACHMENT_TOO_LARGE',
          `PDF is ${pdf.length} bytes; with MIME encoding it exceeds the ${this.config.publication.maxAttachmentBytes}-byte limit`,
          false,
        );
      }
    } catch (error) {
      const failure = PublicationError.from(error);
      return {
        outcome: 'FAILED',
        message: failure.message,
        delivery: await this.deliveries.markFailed(delivery.id, {
          code: failure.kind === 'UNEXPECTED' ? 'ATTACHMENT_UNAVAILABLE' : failure.kind,
          message: failure.message,
          retryable: false,
          nextAttemptAt: null,
        }),
      };
    }

    const base = this.config.publication.publicBaseUrl;
    const digest = buildDigest({
      content: issue.content,
      username: user.username,
      issueUrl: base ? `${base}/issues/${issue.id}` : null,
      settingsUrl: base ? `${base}/settings` : null,
    });

    // Network I/O: no database transaction is open here.
    let result;
    try {
      result = await this.transport.send({
        to: user.email,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
        attachments: [
          {
            filename: `PaperMorning-${issue.issueDate}.pdf`,
            contentType: 'application/pdf',
            content: pdf,
          },
        ],
      });
    } catch (error) {
      result = {
        status: 'UNKNOWN' as const,
        reason: `Transport threw: ${(error as Error).message}`,
      };
    }

    switch (result.status) {
      case 'ACCEPTED':
        return {
          outcome: 'SENT',
          delivery: await this.deliveries.markSent(delivery.id, result.messageId),
        };
      case 'REJECTED': {
        const retryable =
          !result.permanent && delivery.attemptCount < this.config.publication.maxDeliveryAttempts;
        return {
          outcome: 'FAILED',
          message: result.reason,
          delivery: await this.deliveries.markFailed(delivery.id, {
            code: result.permanent ? 'SMTP_REJECTED' : 'SMTP_TEMPORARY',
            message: result.reason,
            retryable,
            nextAttemptAt: retryable
              ? new Date(Date.now() + 5 * 60_000 * delivery.attemptCount)
              : null,
          }),
        };
      }
      case 'UNKNOWN':
        this.logger.warn(`Delivery ${delivery.id} outcome UNKNOWN: ${result.reason}`);
        return {
          outcome: 'UNKNOWN',
          message: result.reason,
          delivery: await this.deliveries.markUnknown(delivery.id, result.reason),
        };
    }
  }

  /** Operator-only resolution of an UNKNOWN delivery after checking the provider or mailbox. */
  async resolveUnknown(
    deliveryId: string,
    resolution: 'SENT' | 'RETRY',
  ): Promise<EmailDeliveryModel> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery || delivery.status !== DeliveryStatus.UNKNOWN) {
      throw new PublicationError('NOT_UNKNOWN', 'Only UNKNOWN deliveries can be resolved', false);
    }
    return this.deliveries.resolveUnknown(deliveryId, resolution);
  }

  /** Current email state for a reader's issue of a given local date (null: none attempted). */
  async statusFor(userId: string, issueDate: string): Promise<DeliveryStatus | null> {
    const issue = await this.issues.findByUserDate(userId, issueDate);
    if (!issue) return null;
    return (await this.deliveries.findByIssue(issue.id))?.status ?? null;
  }

  findForIssue(issueId: string): Promise<EmailDeliveryModel | null> {
    return this.deliveries.findByIssue(issueId);
  }

  private describe(delivery: EmailDeliveryModel): DeliveryResult {
    const map: Record<DeliveryStatus, DeliveryOutcome> = {
      [DeliveryStatus.SENT]: 'ALREADY_SENT',
      [DeliveryStatus.SENDING]: 'IN_PROGRESS',
      [DeliveryStatus.UNKNOWN]: 'UNKNOWN',
      [DeliveryStatus.FAILED]: 'FAILED',
      [DeliveryStatus.DISABLED]: 'DISABLED',
      [DeliveryStatus.PENDING]: 'IN_PROGRESS',
    };
    return { outcome: map[delivery.status], delivery, message: delivery.errorMessage ?? undefined };
  }
}
