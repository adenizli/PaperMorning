import { Injectable } from '@nestjs/common';
import { KnowledgeLevel, ReaderProfileModel, TopicPriority } from '../../account';
import type { ResearchPaperView } from '../../research';
import type { ArticleRole } from '../model/issue-content.model';
import type { SelectedArticle } from '../model/publication-run.model';

const PRIORITY_WEIGHT: Record<TopicPriority, number> = {
  [TopicPriority.HIGH]: 3,
  [TopicPriority.MEDIUM]: 2,
  [TopicPriority.LOW]: 1,
};

/**
 * Deterministic, reader-specific selection and ordering. Topic priority decides how much space a
 * topic gets; knowledge level is only passed on for narration. Scientific content is untouched.
 */
@Injectable()
export class EditorialService {
  select(
    profile: ReaderProfileModel,
    candidates: ResearchPaperView[],
    options: { maxArticles: number; excludedPaperIds?: string[] },
  ): SelectedArticle[] {
    const excluded = new Set(options.excludedPaperIds ?? []);
    const topics = [...profile.topics].sort(
      (a, b) =>
        PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
        a.topicKey.localeCompare(b.topicKey),
    );

    // Each paper is assigned once, to the reader's highest-priority topic it was accepted for.
    const queues = new Map<string, ResearchPaperView[]>(topics.map((t) => [t.topicKey, []]));
    const assigned = new Set<string>();
    for (const topic of topics) {
      const matching = candidates
        .filter((c) => c.topicKeys.includes(topic.topicKey) && !excluded.has(c.paperId))
        .sort(
          (a, b) =>
            b.relevanceScore - a.relevanceScore ||
            b.publishedAt.localeCompare(a.publishedAt) ||
            a.analysisId.localeCompare(b.analysisId),
        );
      for (const paper of matching) {
        if (assigned.has(paper.paperId)) continue;
        assigned.add(paper.paperId);
        queues.get(topic.topicKey)!.push(paper);
      }
    }

    // Weighted round-robin: per round HIGH takes up to 3, MEDIUM 2, LOW 1.
    const picks: {
      paper: ResearchPaperView;
      topicKey: string;
      priority: TopicPriority;
      knowledgeLevel: KnowledgeLevel;
    }[] = [];
    while (picks.length < options.maxArticles && [...queues.values()].some((q) => q.length > 0)) {
      for (const topic of topics) {
        const queue = queues.get(topic.topicKey)!;
        for (let i = 0; i < PRIORITY_WEIGHT[topic.priority] && queue.length > 0; i++) {
          if (picks.length >= options.maxArticles) break;
          picks.push({
            paper: queue.shift()!,
            topicKey: topic.topicKey,
            priority: topic.priority,
            knowledgeLevel: topic.knowledgeLevel,
          });
        }
      }
    }

    return picks.map((pick, index) => ({
      analysisId: pick.paper.analysisId,
      paperId: pick.paper.paperId,
      topicKey: pick.topicKey,
      role: roleFor(index),
      priority: pick.priority,
      knowledgeLevel: pick.knowledgeLevel,
    }));
  }
}

function roleFor(index: number): ArticleRole {
  if (index === 0) return 'COVER';
  return index <= 2 ? 'FEATURE' : 'BRIEF';
}
