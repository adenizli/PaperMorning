import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../../config/app.config';
import { ResearchQueryService } from '../../research';
import type { FailedAnalysisView } from '../../research';
import {
  ArticleVariantRepositoryService,
  FailedGenerationRow,
  MAX_VARIANT_ATTEMPTS,
} from '../repository/article-variant-repository.service';
import { EmailDeliveryRepositoryService } from '../repository/email-delivery-repository.service';
import { IssueRepositoryService } from '../repository/issue-repository.service';
import {
  MAX_OUTLOOK_ATTEMPTS,
  OutlookGenerationRepositoryService,
} from '../repository/outlook-generation-repository.service';
import { PublicationRunRepositoryService } from '../repository/publication-run-repository.service';
import { ARTICLE_PROMPT_VERSION } from './article-writing.service';
import { OUTLOOK_PROMPT_VERSION } from './outlook.service';
import { describePublicationStatus, PublicationStatusView } from './publication-status';

export interface FailedGenerationView {
  id: string;
  label: string;
  promptVersion: string;
  attempts: number;
  maxAttempts: number;
  retryable: boolean;
  /** Will be claimed again by the next preparation that needs it (same prompt version). */
  retryEligible: boolean;
  errorKind: string | null;
  error: string | null;
  updatedAt: string;
}

export interface ReaderOperationsView {
  today: PublicationStatusView;
  latestReady: { issueId: string; issueDate: string; publishedAt: string | null } | null;
  latestSent: { issueId: string; issueDate: string; sentAt: string } | null;
}

export interface FailureOverview {
  analyses: FailedAnalysisView[];
  articleVariants: FailedGenerationView[];
  outlooks: FailedGenerationView[];
  deliveries: {
    id: string;
    issueDate: string;
    status: string;
    attempts: number;
    /** FAILED and retryable: the next delivery attempt picks it up; UNKNOWN: operator decides. */
    next: 'AUTOMATIC_RETRY' | 'NONE' | 'OPERATOR_RESOLVE';
    nextAttemptAt: string | null;
    errorCode: string | null;
    error: string | null;
  }[];
}

const view = (
  row: FailedGenerationRow,
  maxAttempts: number,
  currentPrompt: string,
): FailedGenerationView => ({
  id: row.id,
  label: row.label,
  promptVersion: row.promptVersion,
  attempts: row.attempts,
  maxAttempts,
  retryable: row.retryable,
  retryEligible: row.retryable && row.attempts < maxAttempts && row.promptVersion === currentPrompt,
  errorKind: row.errorKind,
  error: row.errorMessage?.slice(0, 300) ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Read-only operator overview (ops:status): per-reader state of today's issue, the latest READY
 * issue and SENT email, and recent failures with their retry eligibility. Never writes.
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly config: AppConfig,
    private readonly issues: IssueRepositoryService,
    private readonly runs: PublicationRunRepositoryService,
    private readonly deliveries: EmailDeliveryRepositoryService,
    private readonly variants: ArticleVariantRepositoryService,
    private readonly outlooks: OutlookGenerationRepositoryService,
    private readonly research: ResearchQueryService,
  ) {}

  async readerOverview(
    userId: string,
    issueDate: string,
    now: Date,
  ): Promise<ReaderOperationsView> {
    const issue = await this.issues.findByUserDate(userId, issueDate);
    return {
      today: describePublicationStatus({
        issue,
        run: await this.runs.findByUserDate(userId, issueDate),
        delivery: issue ? await this.deliveries.findByIssue(issue.id) : null,
        maxAttempts: this.config.publication.maxPreparationAttempts,
        now,
      }),
      latestReady: await this.issues.latestReady(userId),
      latestSent: await this.deliveries.latestSent(userId),
    };
  }

  async recentFailures(limit = 10): Promise<FailureOverview> {
    return {
      analyses: await this.research.listFailedAnalyses(limit),
      articleVariants: (await this.variants.listFailed(limit)).map((r) =>
        view(r, MAX_VARIANT_ATTEMPTS, ARTICLE_PROMPT_VERSION),
      ),
      outlooks: (await this.outlooks.listFailed(limit)).map((r) =>
        view(r, MAX_OUTLOOK_ATTEMPTS, OUTLOOK_PROMPT_VERSION),
      ),
      deliveries: (await this.deliveries.listProblems(limit)).map((d) => ({
        id: d.id,
        issueDate: d.issueDate,
        status: d.status,
        attempts: d.attempts,
        next:
          d.status === 'UNKNOWN'
            ? 'OPERATOR_RESOLVE'
            : d.retryable && d.attempts < this.config.publication.maxDeliveryAttempts
              ? 'AUTOMATIC_RETRY'
              : 'NONE',
        nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
        errorCode: d.errorCode,
        error: d.errorMessage?.slice(0, 300) ?? null,
      })),
    };
  }
}
