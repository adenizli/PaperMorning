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

/** "A Study of X: v2" and "A study of X v2" are the same work (preprint vs journal version). */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const firstAuthor = (paper: ResearchPaperView): string =>
  (paper.authors[0] ?? '').trim().toLowerCase();

/**
 * Deterministic, reader-specific selection and ordering. Topic priority decides how much space a
 * topic gets; knowledge level is only passed on for narration. Scientific content is untouched.
 *
 * Quality rules: within a topic, relevance then recency decide; the same work never appears
 * twice (same paper, or the same normalized title as a candidate or an earlier issue's paper,
 * e.g. a preprint and its journal version); and a paper whose first author already has a paper
 * in this issue waits until other candidates of that topic have been used (source diversity).
 */
@Injectable()
export class EditorialService {
  select(
    profile: ReaderProfileModel,
    candidates: ResearchPaperView[],
    options: { maxArticles: number; excludedPaperIds?: string[]; excludedTitles?: string[] },
  ): SelectedArticle[] {
    const excluded = new Set(options.excludedPaperIds ?? []);
    const usedTitles = new Set((options.excludedTitles ?? []).map(titleKey));
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
        const title = titleKey(paper.title);
        if (assigned.has(paper.paperId) || usedTitles.has(title)) continue;
        assigned.add(paper.paperId);
        usedTitles.add(title); // the best-ranked copy of a work wins
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
    const authors = new Set<string>();
    /** Best remaining paper of the queue, preferring a first author not yet in the issue. */
    const next = (queue: ResearchPaperView[]): ResearchPaperView => {
      const fresh = queue.findIndex((p) => !firstAuthor(p) || !authors.has(firstAuthor(p)));
      const [paper] = queue.splice(fresh >= 0 ? fresh : 0, 1);
      authors.add(firstAuthor(paper));
      return paper;
    };
    while (picks.length < options.maxArticles && [...queues.values()].some((q) => q.length > 0)) {
      for (const topic of topics) {
        const queue = queues.get(topic.topicKey)!;
        for (let i = 0; i < PRIORITY_WEIGHT[topic.priority] && queue.length > 0; i++) {
          if (picks.length >= options.maxArticles) break;
          picks.push({
            paper: next(queue),
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
