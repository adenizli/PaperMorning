import { Injectable, Logger } from '@nestjs/common';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { LeaseHeartbeat } from '../../../common/persistence/lease-heartbeat';
import { AppConfig } from '../../../config/app.config';
import { PreferenceService, ReaderProfileModel, TopicPriority } from '../../account';
import { ResearchQueryService, ResearchService } from '../../research';
import type { ResearchPaperView } from '../../research';
import { shiftDate } from '../../../common/time/calendar-date';
import { IssueModel, IssueStatus } from '../model/issue.model';
import {
  PublicationCheckpoint,
  PublicationRunModel,
  PublicationStage,
  SelectedArticle,
} from '../model/publication-run.model';
import { PublicationRunRepositoryService } from '../repository/publication-run-repository.service';
import { ArticleWritingService } from './article-writing.service';
import { EditorialService } from './editorial.service';
import { ComposedArticle, IssueService } from './issue.service';
import { OutlookService } from './outlook.service';
import { PublicationError } from './publication-error';

export type PrepareOutcome = 'READY' | 'IN_PROGRESS' | 'FAILED' | 'SKIPPED';

export interface PrepareResult {
  outcome: PrepareOutcome;
  issue: IssueModel | null;
  run: PublicationRunModel | null;
  reason?: string;
}

/**
 * Public entrypoint: prepare one reader's issue for one local date. Idempotent per
 * (reader, date); every stage is checkpointed so restarts resume without repeating paid work.
 */
@Injectable()
export class PublicationService {
  private readonly logger = new Logger(PublicationService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly preferences: PreferenceService,
    private readonly research: ResearchService,
    private readonly researchQuery: ResearchQueryService,
    private readonly editorial: EditorialService,
    private readonly writer: ArticleWritingService,
    private readonly outlook: OutlookService,
    private readonly issues: IssueService,
    private readonly runs: PublicationRunRepositoryService,
  ) {}

  async prepareIssue(userId: string, issueDate: string): Promise<PrepareResult> {
    const existing = await this.issues.findByUserDate(userId, issueDate);
    if (existing?.status === IssueStatus.READY)
      return { outcome: 'READY', issue: existing, run: null };

    const profile = await this.preferences.getForUser(userId);
    if (profile.topics.length === 0) {
      return {
        outcome: 'SKIPPED',
        issue: null,
        run: null,
        reason: 'Reader has no topic preferences',
      };
    }

    const { publication } = this.config;
    const claim = await this.runs.claim(
      userId,
      issueDate,
      publication.leaseSeconds,
      publication.maxPreparationAttempts,
    );
    switch (claim.outcome) {
      case 'COMPLETED':
        return {
          outcome: 'READY',
          issue: await this.issues.findByUserDate(userId, issueDate),
          run: claim.run,
        };
      case 'BUSY':
        return { outcome: 'IN_PROGRESS', issue: null, run: claim.run };
      case 'EXHAUSTED':
      case 'BACKOFF':
        return {
          outcome: 'FAILED',
          issue: null,
          run: claim.run,
          reason: claim.run.errorMessage ?? claim.outcome,
        };
    }

    const run = claim.run;
    const lease = new RunLease(run.id, claim.claimToken, publication.leaseSeconds, this.runs);
    try {
      const issue = await this.execute(run, lease, profile, issueDate);
      return { outcome: 'READY', issue, run: await lease.complete(issue.id) };
    } catch (error) {
      if (error instanceof ClaimLostError) {
        // A newer worker owns this reader/day now: leave its state alone.
        this.logger.warn(`Issue ${userId}/${issueDate}: ${error.message}`);
        const issue = await this.issues.findByUserDate(userId, issueDate);
        const current = await this.runs.findById(run.id);
        if (issue?.status === IssueStatus.READY) return { outcome: 'READY', issue, run: current };
        return {
          outcome: 'IN_PROGRESS',
          issue: null,
          run: current,
          reason: 'Taken over by another worker',
        };
      }
      const failure = PublicationError.from(error);
      const backoffMs = publication.retryBackoffMinutes * 60_000 * 2 ** (run.attemptCount - 1);
      this.logger.warn(
        `Issue ${userId}/${issueDate} failed at ${run.stage} (attempt ${run.attemptCount}): ${failure.kind}: ${failure.message}`,
      );
      let failed: PublicationRunModel | null;
      try {
        failed = await lease.fail({
          kind: failure.kind,
          message: failure.message,
          retryable: failure.retryable,
          nextAttemptAt: failure.retryable ? new Date(Date.now() + backoffMs) : null,
        });
      } catch (failError) {
        if (!(failError instanceof ClaimLostError)) throw failError;
        failed = await this.runs.findById(run.id);
      }
      return {
        outcome: 'FAILED',
        issue: null,
        run: failed,
        reason: `${failure.kind}: ${failure.message}`,
      };
    } finally {
      lease.stop();
    }
  }

  /** Visible lateness for the scheduler: the issue was not READY at the delivery deadline. */
  recordLate(userId: string, issueDate: string, at: Date): Promise<void> {
    return this.runs.markLate(userId, issueDate, at);
  }

  findRun(userId: string, issueDate: string): Promise<PublicationRunModel | null> {
    return this.runs.findByUserDate(userId, issueDate);
  }

  private async execute(
    initial: PublicationRunModel,
    lease: RunLease,
    profile: ReaderProfileModel,
    issueDate: string,
  ): Promise<IssueModel> {
    let run = initial;
    const checkpoint: PublicationCheckpoint = { ...run.checkpoint };
    const topicKeys = profile.topics.map((t) => t.topicKey);
    const language = profile.reader.language;

    if (!checkpoint.selection) {
      // Research may run for minutes; the background heartbeat keeps the run lease alive.
      await lease.assertHeld();
      await this.refreshResearch(topicKeys, issueDate);
      const candidates = await this.researchQuery.listAnalyzedPapers({
        topicKeys,
        publishedFrom: shiftDate(issueDate, -this.config.research.lookbackDays),
        publishedUntil: issueDate,
      });
      const selection = this.editorial.select(profile, candidates, {
        maxArticles: this.config.publication.maxArticlesPerIssue,
        excludedPaperIds: await this.issues.listUsedPaperIds(profile.reader.userId, issueDate),
      });
      if (selection.length === 0) {
        throw new PublicationError(
          'NO_ELIGIBLE_RESEARCH',
          "No new analyzed research is available for the reader's topics",
          true,
        );
      }
      checkpoint.selection = selection;
      run = await lease.checkpoint(PublicationStage.WRITING, checkpoint);
    }

    const selection: SelectedArticle[] = checkpoint.selection;
    const views = await this.loadViews(selection, topicKeys);

    // Cached variants return immediately (no LLM call); only missing ones are written.
    checkpoint.variantIds ??= {};
    const articles: ComposedArticle[] = [];
    for (const item of selection) {
      const view = views.get(item.analysisId)!;
      await lease.assertHeld(); // never pay for a run another worker owns
      const variant = await this.writer.getOrWrite(view, language, item.knowledgeLevel);
      articles.push({ selection: item, view, variant });
      if (checkpoint.variantIds[item.analysisId] !== variant.id) {
        checkpoint.variantIds[item.analysisId] = variant.id;
        run = await lease.checkpoint(PublicationStage.WRITING, checkpoint);
      }
    }

    if (!checkpoint.outlook) {
      run = await lease.checkpoint(PublicationStage.OUTLOOK, checkpoint);
      const leadLevel = [...profile.topics].sort((a, b) => rank(b.priority) - rank(a.priority))[0]
        .knowledgeLevel;
      checkpoint.outlook = await this.outlook.getOrCreate(
        articles.map((a, index) => ({ paperKey: `P${index + 1}`, view: a.view })),
        language,
        leadLevel,
      );
    }
    run = await lease.checkpoint(PublicationStage.RENDERING, checkpoint);

    const content = this.issues.buildContent({
      issueDate,
      issueNumber: await this.issues.nextIssueNumber(profile.reader.userId),
      language,
      articles,
      outlook: checkpoint.outlook,
      generatedAt: new Date(),
    });
    return this.issues.publish({
      userId: profile.reader.userId,
      issueDate,
      timezone: profile.reader.timezone,
      content,
    });
  }

  /** Shared research is refreshed once per topic/day; failures there do not block existing analyses. */
  private async refreshResearch(topicKeys: string[], issueDate: string): Promise<void> {
    try {
      await this.research.ensureDailyResearch({
        topicKeys,
        runDate: issueDate,
        trigger: 'PUBLICATION',
      });
    } catch (error) {
      this.logger.warn(
        `Research refresh failed, using existing analyses: ${(error as Error).message}`,
      );
    }
  }

  private async loadViews(
    selection: SelectedArticle[],
    topicKeys: string[],
  ): Promise<Map<string, ResearchPaperView>> {
    const views = await this.researchQuery.getByAnalysisIds(
      selection.map((s) => s.analysisId),
      topicKeys,
    );
    const byId = new Map(views.map((v) => [v.analysisId, v]));
    const missing = selection.filter((s) => !byId.has(s.analysisId));
    if (missing.length > 0) {
      throw new PublicationError(
        'RESEARCH_MISSING',
        `Selected analyses are no longer available: ${missing.map((m) => m.analysisId).join(', ')}`,
        false,
      );
    }
    return byId;
  }
}

/**
 * The worker's hold on one publication run: every state change presents the claim's fencing token,
 * and a background heartbeat renews the lease during long steps (research refresh, Claude calls).
 */
class RunLease {
  private readonly heartbeat: LeaseHeartbeat;

  constructor(
    private readonly runId: string,
    private readonly token: string,
    private readonly leaseSeconds: number,
    private readonly runs: PublicationRunRepositoryService,
  ) {
    this.heartbeat = new LeaseHeartbeat(
      `Publication run ${runId}`,
      () => runs.renew(runId, token, leaseSeconds),
      Math.max(1_000, (leaseSeconds * 1000) / 3),
    );
  }

  assertHeld(): Promise<void> {
    return this.heartbeat.assertHeld();
  }

  checkpoint(stage: PublicationStage, checkpoint: PublicationCheckpoint) {
    return this.runs.checkpoint(this.runId, this.token, stage, checkpoint, this.leaseSeconds);
  }

  async complete(issueId: string): Promise<PublicationRunModel> {
    this.heartbeat.stop();
    return this.runs.complete(this.runId, this.token, issueId);
  }

  async fail(error: Parameters<PublicationRunRepositoryService['fail']>[2]) {
    this.heartbeat.stop();
    return this.runs.fail(this.runId, this.token, error);
  }

  stop(): void {
    this.heartbeat.stop();
  }
}

function rank(priority: TopicPriority): number {
  return priority === TopicPriority.HIGH ? 3 : priority === TopicPriority.MEDIUM ? 2 : 1;
}
