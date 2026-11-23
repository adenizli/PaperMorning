import { Injectable, Logger } from '@nestjs/common';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { AppConfig } from '../../../config/app.config';
import { shiftDate } from '../../../common/time/calendar-date';
import { findTopic } from '../../../common/topic/topic-catalog';
import type { DailyResearchRequest } from '../model/research-request.model';
import { ResearchRunCounts, ResearchRunModel, ResearchRunStage } from '../model/research-run.model';
import { ResearchRunRepositoryService } from '../repository/research-run-repository.service';
import { PaperAnalysisService } from './paper-analysis.service';
import { PaperScreeningService } from './paper-screening.service';
import { ResearchDiscoveryService } from './research-discovery.service';

/** Errors that stop the analysis stage for the whole run (retry later, from the checkpoint). */
const RUN_STOPPING_ERRORS = new Set(['BUDGET_EXCEEDED', 'NOT_CONFIGURED', 'RATE_LIMITED']);

/**
 * Public Research entrypoint: one resumable run per topic per day, discovery -> screening ->
 * analysis, each stage checkpointed in PostgreSQL. Independent of any user account.
 */
@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly runs: ResearchRunRepositoryService,
    private readonly discovery: ResearchDiscoveryService,
    private readonly screening: PaperScreeningService,
    private readonly analysis: PaperAnalysisService,
  ) {}

  async ensureDailyResearch(request: DailyResearchRequest): Promise<ResearchRunModel[]> {
    const results: ResearchRunModel[] = [];
    for (const topicKey of [...new Set(request.topicKeys)]) {
      results.push(await this.runTopic(topicKey, request));
    }
    return results;
  }

  async runTopic(topicKey: string, request: DailyResearchRequest): Promise<ResearchRunModel> {
    const topic = findTopic(topicKey);
    if (!topic) throw new Error(`Unsupported topic key: ${topicKey}`);
    const lookbackDays = request.lookbackDays ?? this.config.research.lookbackDays;
    const maxCandidates =
      request.maxCandidatesPerTopic ?? this.config.research.maxCandidatesPerTopic;

    // The lease must outlive the longest single step between heartbeats (one bounded analysis).
    const leaseSeconds = Math.max(this.config.research.leaseSeconds, this.analysis.leaseSeconds());
    const claim = await this.runs.claim({
      runKey: `daily:${topicKey}:${request.runDate}`,
      trigger: request.trigger,
      topicKey,
      windowFrom: shiftDate(request.runDate, -lookbackDays),
      windowUntil: request.runDate,
      leaseSeconds,
    });
    if (claim.outcome !== 'CLAIMED') return claim.run;

    const token = claim.claimToken;
    let run = claim.run;
    const counts: ResearchRunCounts = { ...run.counts };
    const errors: string[] = [];
    try {
      if (run.stage === ResearchRunStage.DISCOVERY) {
        const found = await this.discovery.discover(
          topic,
          { from: run.windowFrom, until: run.windowUntil },
          this.config.research.discoveryLimitPerSource,
        );
        errors.push(...found.failures);
        if (found.allSourcesFailed) return await this.runs.fail(run.id, token, errors);
        counts.discovered = found.discovered;
        counts.newVersions = found.newVersions;
        run = await this.runs.checkpoint(
          run.id,
          token,
          {
            stage: ResearchRunStage.SCREENING,
            discoveredVersionIds: found.versionIds,
            counts,
            errors,
          },
          leaseSeconds,
        );
      }

      if (run.stage === ResearchRunStage.SCREENING) {
        const screened = await this.screening.screen(
          topic,
          run.discoveredVersionIds,
          maxCandidates,
        );
        counts.screened = screened.screened;
        counts.accepted = screened.accepted;
        counts.candidates = screened.candidateVersionIds.length;
        run = await this.runs.checkpoint(
          run.id,
          token,
          {
            stage: ResearchRunStage.ANALYSIS,
            candidateVersionIds: screened.candidateVersionIds,
            counts,
          },
          leaseSeconds,
        );
      }

      if (run.stage === ResearchRunStage.ANALYSIS) {
        counts.analyzed = counts.reused = counts.analysisFailed = 0;
        for (const versionId of run.candidateVersionIds) {
          // Heartbeat before every paid step; a lost claim stops this worker before it spends.
          if (!(await this.runs.renew(run.id, token, leaseSeconds))) {
            throw new ClaimLostError(`Research run ${run.runKey}`);
          }
          const outcome = await this.analysis.analyze(versionId);
          if (outcome.status === 'COMPLETED') {
            if (outcome.reused) counts.reused++;
            else counts.analyzed++;
          } else if (outcome.status === 'FAILED') {
            counts.analysisFailed++;
            errors.push(`analysis ${versionId}: ${outcome.errorKind}: ${outcome.message}`);
            if (RUN_STOPPING_ERRORS.has(outcome.errorKind)) {
              await this.runs.checkpoint(run.id, token, { counts }, leaseSeconds);
              return await this.runs.fail(run.id, token, [...run.errors, ...errors]);
            }
          }
        }
      }
      return await this.runs.complete(run.id, token, counts, [...run.errors, ...errors]);
    } catch (error) {
      if (error instanceof ClaimLostError) {
        // Another worker owns the run now; leave its state alone.
        this.logger.warn(error.message);
        return (await this.runs.findById(run.id)) ?? run;
      }
      this.logger.error(`Research run ${run.runKey} failed: ${(error as Error).message}`);
      try {
        return await this.runs.fail(run.id, token, [...errors, (error as Error).message]);
      } catch (failError) {
        if (!(failError instanceof ClaimLostError)) throw failError;
        return (await this.runs.findById(run.id)) ?? run;
      }
    }
  }
}
