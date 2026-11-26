import { DeliveryStatus, EmailDeliveryModel } from '../model/email-delivery.model';
import { IssueModel, IssueStatus } from '../model/issue.model';
import { PublicationRunModel, PublicationRunStatus } from '../model/publication-run.model';

/**
 * What would happen if `publication:prepare` ran now, derived only from stored state with the
 * same rules as the run claim (PublicationRunRepositoryService.claim). Read-only.
 *
 * NONE      the issue is READY; preparing again returns it without any work.
 * PREPARE   a preparation attempt is eligible now.
 * WAIT      not eligible before `at` (retry back-off, or another worker's lease).
 * MANUAL    no further automatic attempt: non-retryable failure or attempts exhausted.
 */
export type NextPreparationAction = 'NONE' | 'PREPARE' | 'WAIT' | 'MANUAL';

export interface PublicationStatusView {
  state: 'READY' | 'NOT_STARTED' | 'IN_PROGRESS' | 'FAILED' | 'RENDERING';
  issue: {
    id: string;
    status: IssueStatus;
    issueNumber: number;
    publishedAt: string | null;
    pdf: { sha256: string; sizeBytes: number } | null;
  } | null;
  run: {
    status: PublicationRunStatus;
    stage: string;
    attempts: number;
    maxAttempts: number;
    retryable: boolean;
    errorKind: string | null;
    errorMessage: string | null;
    nextAttemptAt: string | null;
    leaseExpiresAt: string | null;
    lateAt: string | null;
  } | null;
  delivery: { status: DeliveryStatus; attempts: number; nextAttemptAt: string | null } | null;
  next: { action: NextPreparationAction; at: string | null; reason: string };
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function describePublicationStatus(params: {
  issue: IssueModel | null;
  run: PublicationRunModel | null;
  delivery: EmailDeliveryModel | null;
  maxAttempts: number;
  now: Date;
}): PublicationStatusView {
  const { issue, run, delivery, maxAttempts, now } = params;
  const view: Omit<PublicationStatusView, 'state' | 'next'> = {
    issue: issue && {
      id: issue.id,
      status: issue.status,
      issueNumber: issue.content.issueNumber,
      publishedAt: iso(issue.publishedAt),
      pdf:
        issue.pdfSha256 && issue.pdfSizeBytes !== null
          ? { sha256: issue.pdfSha256, sizeBytes: issue.pdfSizeBytes }
          : null,
    },
    run: run && {
      status: run.status,
      stage: run.stage,
      attempts: run.attemptCount,
      maxAttempts,
      retryable: run.retryable,
      errorKind: run.errorKind,
      errorMessage: run.errorMessage,
      nextAttemptAt: iso(run.nextAttemptAt),
      leaseExpiresAt: iso(run.leaseExpiresAt),
      lateAt: iso(run.lateAt),
    },
    delivery: delivery && {
      status: delivery.status,
      attempts: delivery.attemptCount,
      nextAttemptAt: iso(delivery.nextAttemptAt),
    },
  };

  if (issue?.status === IssueStatus.READY) {
    return {
      ...view,
      state: 'READY',
      next: { action: 'NONE', at: null, reason: 'The issue is READY and immutable' },
    };
  }
  if (!run) {
    return {
      ...view,
      state: issue ? 'RENDERING' : 'NOT_STARTED',
      next: { action: 'PREPARE', at: null, reason: 'No preparation attempt recorded yet' },
    };
  }
  if (run.status === PublicationRunStatus.RUNNING) {
    const lease = run.leaseExpiresAt;
    if (lease && lease > now) {
      return {
        ...view,
        state: 'IN_PROGRESS',
        next: {
          action: 'WAIT',
          at: lease.toISOString(),
          reason: `A worker holds the lease (stage ${run.stage}); it can be taken over after expiry`,
        },
      };
    }
    return {
      ...view,
      state: 'IN_PROGRESS',
      next: { action: 'PREPARE', at: null, reason: 'The previous worker’s lease expired' },
    };
  }
  if (run.status === PublicationRunStatus.COMPLETED) {
    return {
      ...view,
      state: issue ? 'RENDERING' : 'IN_PROGRESS',
      next: { action: 'PREPARE', at: null, reason: 'Run completed but the issue is not READY' },
    };
  }
  // FAILED
  if (!run.retryable) {
    return {
      ...view,
      state: 'FAILED',
      next: {
        action: 'MANUAL',
        at: null,
        reason: `Non-retryable failure ${run.errorKind ?? ''}`.trim(),
      },
    };
  }
  if (run.attemptCount >= maxAttempts) {
    return {
      ...view,
      state: 'FAILED',
      next: {
        action: 'MANUAL',
        at: null,
        reason: `Attempts exhausted (${run.attemptCount}/${maxAttempts})`,
      },
    };
  }
  if (run.nextAttemptAt && run.nextAttemptAt > now) {
    return {
      ...view,
      state: 'FAILED',
      next: {
        action: 'WAIT',
        at: run.nextAttemptAt.toISOString(),
        reason: `Retry back-off after attempt ${run.attemptCount}/${maxAttempts}`,
      },
    };
  }
  return {
    ...view,
    state: 'FAILED',
    next: {
      action: 'PREPARE',
      at: null,
      reason: `Retry eligible (attempt ${run.attemptCount + 1}/${maxAttempts})`,
    },
  };
}
