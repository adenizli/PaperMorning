import { Injectable, Logger } from '@nestjs/common';
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
    try {
      const issue = await this.execute(run, profile, issueDate);
      return { outcome: 'READY', issue, run: await this.runs.complete(run.id, issue.id) };
    } catch (error) {
      const failure = PublicationError.from(error);
      const backoffMs = publication.retryBackoffMinutes * 60_000 * 2 ** (run.attemptCount - 1);
      this.logger.warn(
        `Issue ${userId}/${issueDate} failed at ${run.stage} (attempt ${run.attemptCount}): ${failure.kind}: ${failure.message}`,
      );
      const failed = await this.runs.fail(run.id, {
        kind: failure.kind,
        message: failure.message,
        retryable: failure.retryable,
        nextAttemptAt: failure.retryable ? new Date(Date.now() + backoffMs) : null,
      });
      return {
        outcome: 'FAILED',
        issue: null,
        run: failed,
        reason: `${failure.kind}: ${failure.message}`,
      };
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
    profile: ReaderProfileModel,
    issueDate: string,
  ): Promise<IssueModel> {
    let run = initial;
    const checkpoint: PublicationCheckpoint = { ...run.checkpoint };
    const topicKeys = profile.topics.map((t) => t.topicKey);
    const language = profile.reader.language;

    if (!checkpoint.selection) {
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
      run = await this.runs.checkpoint(run.id, PublicationStage.WRITING, checkpoint);
    }

    const selection: SelectedArticle[] = checkpoint.selection;
    const views = await this.loadViews(selection, topicKeys);

    // Cached variants return immediately (no LLM call); only missing ones are written.
    checkpoint.variantIds ??= {};
    const articles: ComposedArticle[] = [];
    for (const item of selection) {
      const view = views.get(item.analysisId)!;
      const variant = await this.writer.getOrWrite(view, language, item.knowledgeLevel);
      articles.push({ selection: item, view, variant });
      if (checkpoint.variantIds[item.analysisId] !== variant.id) {
        checkpoint.variantIds[item.analysisId] = variant.id;
        run = await this.runs.checkpoint(run.id, PublicationStage.WRITING, checkpoint);
      }
    }

    if (!checkpoint.outlook) {
      run = await this.runs.checkpoint(run.id, PublicationStage.OUTLOOK, checkpoint);
      const leadLevel = [...profile.topics].sort((a, b) => rank(b.priority) - rank(a.priority))[0]
        .knowledgeLevel;
      checkpoint.outlook = await this.outlook.getOrCreate(
        articles.map((a, index) => ({ paperKey: `P${index + 1}`, view: a.view })),
        language,
        leadLevel,
      );
    }
    run = await this.runs.checkpoint(run.id, PublicationStage.RENDERING, checkpoint);

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

function rank(priority: TopicPriority): number {
  return priority === TopicPriority.HIGH ? 3 : priority === TopicPriority.MEDIUM ? 2 : 1;
}
