import { Injectable, Logger } from '@nestjs/common';
import type { TopicDefinition } from '../../../common/topic/topic-catalog';
import { LlmService } from '../../../service/llm/llm.service';
import { LlmError, LlmTask } from '../../../service/llm/llm.types';
import { AppConfig } from '../../../config/app.config';
import {
  PaperScreeningModel,
  ScreeningDecision,
  ScreeningMethod,
} from '../model/paper-screening.model';
import type { PaperVersionModel } from '../model/paper-version.model';
import { PaperScreeningRepositoryService } from '../repository/paper-screening-repository.service';
import { PaperVersionRepositoryService } from '../repository/paper-version-repository.service';

export const SCREENING_RULES_VERSION = 'rules-v1';
export const SCREENING_PROMPT_VERSION = 'screen-v1';
const MIN_ABSTRACT_CHARS = 100;

export type RuleVerdict = 'ACCEPT' | 'REJECT' | 'AMBIGUOUS';

export interface RuleScore {
  verdict: RuleVerdict;
  score: number;
  reason: string;
}

/** Pure deterministic topic screen. Relevance only; never a judgement of scientific quality. */
export function scoreByRules(
  topic: TopicDefinition,
  paper: { title: string; abstract: string | null; categories: string[] },
): RuleScore {
  if (!paper.abstract || paper.abstract.length < MIN_ABSTRACT_CHARS) {
    return {
      verdict: 'REJECT',
      score: 0,
      reason: 'No usable abstract; cannot be analyzed without guessing',
    };
  }
  const title = paper.title.toLowerCase();
  const abstract = paper.abstract.toLowerCase();
  const categoryMatch = paper.categories.some((c) => topic.arxivCategories.includes(c));
  const titleHits = topic.keywords.filter((k) => title.includes(k)).length;
  const abstractHits = topic.keywords.filter((k) => abstract.includes(k)).length;
  const raw = (categoryMatch ? 3 : 0) + 2 * titleHits + abstractHits;
  const signals = `category=${categoryMatch}, titleHits=${titleHits}, abstractHits=${abstractHits}`;

  if (categoryMatch || titleHits > 0 || abstractHits >= 2) {
    return { verdict: 'ACCEPT', score: Math.min(1, raw / 6), reason: `Rule match (${signals})` };
  }
  if (abstractHits === 1) {
    return { verdict: 'AMBIGUOUS', score: 0.2, reason: `Weak rule match (${signals})` };
  }
  return { verdict: 'REJECT', score: 0, reason: `No topic signal (${signals})` };
}

const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    relevanceScore: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['relevant', 'relevanceScore', 'reason'],
  additionalProperties: false,
};

export interface ScreeningResult {
  screened: number;
  accepted: number;
  /** Accepted version IDs ranked by relevance then recency, capped. */
  candidateVersionIds: string[];
}

/**
 * Rules first; Haiku only for genuinely ambiguous cases and within a per-run cap. Decisions are
 * persisted once per (version, topic, criteria version) and reused afterwards.
 */
@Injectable()
export class PaperScreeningService {
  private readonly logger = new Logger(PaperScreeningService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly llm: LlmService,
    private readonly screenings: PaperScreeningRepositoryService,
    private readonly versions: PaperVersionRepositoryService,
  ) {}

  criteriaVersion(): string {
    return this.useLlm()
      ? `${SCREENING_RULES_VERSION}+${this.llm.modelFor(LlmTask.SCREENING)}:${SCREENING_PROMPT_VERSION}`
      : SCREENING_RULES_VERSION;
  }

  async screen(
    topic: TopicDefinition,
    versionIds: string[],
    maxCandidates: number,
  ): Promise<ScreeningResult> {
    const criteriaVersion = this.criteriaVersion();
    const versions = await this.versions.findByIds(versionIds);
    let llmCallsLeft = this.config.research.maxHaikuScreeningsPerRun;
    const accepted: { version: PaperVersionModel; score: number }[] = [];

    for (const version of versions) {
      let decision = await this.screenings.find(version.id, topic.key, criteriaVersion);
      if (!decision) {
        const useLlm = this.useLlm() && llmCallsLeft > 0;
        const fresh = await this.decide(topic, version, useLlm);
        if (fresh.method === ScreeningMethod.LLM) llmCallsLeft--;
        decision = await this.screenings.insertIfAbsent({ ...fresh, criteriaVersion });
      }
      if (decision.decision === ScreeningDecision.ACCEPTED) {
        accepted.push({ version, score: decision.relevanceScore ?? 0 });
      }
    }

    accepted.sort(
      (a, b) => b.score - a.score || b.version.publishedAt.localeCompare(a.version.publishedAt),
    );
    return {
      screened: versions.length,
      accepted: accepted.length,
      candidateVersionIds: accepted.slice(0, maxCandidates).map((a) => a.version.id),
    };
  }

  private async decide(
    topic: TopicDefinition,
    version: PaperVersionModel,
    llmAllowed: boolean,
  ): Promise<Omit<PaperScreeningModel, 'id' | 'createdAt' | 'criteriaVersion'>> {
    const rules = scoreByRules(topic, version);
    const base = {
      paperVersionId: version.id,
      topicKey: topic.key,
      model: null,
      promptVersion: null,
      method: ScreeningMethod.RULES,
    };
    if (rules.verdict !== 'AMBIGUOUS') {
      return {
        ...base,
        decision:
          rules.verdict === 'ACCEPT' ? ScreeningDecision.ACCEPTED : ScreeningDecision.REJECTED,
        relevanceScore: rules.score,
        reason: rules.reason,
      };
    }
    if (llmAllowed) {
      try {
        return await this.screenWithLlm(topic, version, base);
      } catch (error) {
        this.logger.warn(`Haiku screening unavailable: ${(error as Error).message}`);
      }
    }
    // Interdisciplinary papers are not discarded on a weak keyword match alone.
    return {
      ...base,
      decision: ScreeningDecision.ACCEPTED,
      relevanceScore: rules.score,
      reason: `${rules.reason}; kept at low priority without semantic screening`,
    };
  }

  private async screenWithLlm(
    topic: TopicDefinition,
    version: PaperVersionModel,
    base: { paperVersionId: string; topicKey: string },
  ): Promise<Omit<PaperScreeningModel, 'id' | 'createdAt' | 'criteriaVersion'>> {
    const result = await this.llm.generateJson({
      task: LlmTask.SCREENING,
      maxTokens: 400,
      effort: 'low',
      schema: SCREEN_SCHEMA,
      system:
        'You screen academic papers for topical relevance to a reader interest. Judge relevance only, ' +
        'not scientific quality. Use only the given title and abstract.',
      prompt: `Topic: ${topic.key} (${topic.keywords.join(', ')})\nTitle: ${version.title}\nAbstract: ${version.abstract}\n\nIs this paper relevant to the topic? relevanceScore is 0..1.`,
    });
    const data = result.data as { relevant?: unknown; relevanceScore?: unknown; reason?: unknown };
    if (typeof data.relevant !== 'boolean' || typeof data.reason !== 'string') {
      throw new LlmError('INVALID_OUTPUT', 'Screening output missing fields');
    }
    const score =
      typeof data.relevanceScore === 'number' ? Math.min(1, Math.max(0, data.relevanceScore)) : 0;
    return {
      ...base,
      decision: data.relevant ? ScreeningDecision.ACCEPTED : ScreeningDecision.REJECTED,
      method: ScreeningMethod.LLM,
      relevanceScore: Math.round(score * 1000) / 1000,
      reason: data.reason.slice(0, 500),
      model: result.model,
      promptVersion: SCREENING_PROMPT_VERSION,
    };
  }

  private useLlm(): boolean {
    return this.config.research.haikuScreeningEnabled && this.llm.isAvailable();
  }
}
