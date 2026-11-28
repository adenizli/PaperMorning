import { ContentCoverage, PublicationStatus } from '../../../src/common/enum/research.enum';
import { KnowledgeLevel, ReaderProfileModel, TopicPriority } from '../../../src/domain/account';
import { EditorialService } from '../../../src/domain/publication/service/editorial.service';
import type { ResearchPaperView } from '../../../src/domain/research';

let n = 0;
function paper(
  topicKeys: string[],
  relevance: number,
  publishedAt = '2026-11-20',
): ResearchPaperView {
  n++;
  return {
    analysisId: `an-${n}`,
    analysisFingerprint: `fp-${n}`,
    paperId: `paper-${n}`,
    paperVersionId: `v-${n}`,
    topicKey: topicKeys[0],
    topicKeys,
    relevanceScore: relevance,
    title: `Paper ${n}`,
    authors: [],
    doi: null,
    arxivId: null,
    publicationStatus: PublicationStatus.PREPRINT,
    publishedAt,
    venue: null,
    abstract: 'x',
    coverage: ContentCoverage.ABSTRACT_ONLY,
    analysis: {} as never,
    sourceReferences: [],
    analyzedAt: new Date(),
  };
}

const profile = (topics: [string, TopicPriority, KnowledgeLevel][]): ReaderProfileModel => ({
  reader: { userId: 'u', language: 'tr', timezone: 'Europe/Istanbul', dailyEmailEnabled: false },
  topics: topics.map(([topicKey, priority, knowledgeLevel]) => ({
    userId: 'u',
    topicKey,
    priority,
    knowledgeLevel,
  })),
});

describe('EditorialService', () => {
  const editorial = new EditorialService();
  const robotics = Array.from({ length: 5 }, (_, i) => paper(['robotics'], 0.9 - i * 0.1));
  const quantum = Array.from({ length: 5 }, (_, i) => paper(['quantum-physics'], 0.8 - i * 0.1));
  const all = [...quantum, ...robotics];

  it('gives space by priority and passes knowledge level through unchanged', () => {
    const picks = editorial.select(
      profile([
        ['robotics', TopicPriority.HIGH, KnowledgeLevel.BEGINNER],
        ['quantum-physics', TopicPriority.LOW, KnowledgeLevel.ADVANCED],
      ]),
      all,
      { maxArticles: 6 },
    );
    expect(picks.filter((p) => p.topicKey === 'robotics')).toHaveLength(5);
    expect(picks.filter((p) => p.topicKey === 'quantum-physics')).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      role: 'COVER',
      topicKey: 'robotics',
      analysisId: robotics[0].analysisId,
      knowledgeLevel: KnowledgeLevel.BEGINNER,
    });
    expect(picks.find((p) => p.topicKey === 'quantum-physics')!.knowledgeLevel).toBe(
      KnowledgeLevel.ADVANCED,
    );
    expect(picks.map((p) => p.role)).toEqual([
      'COVER',
      'FEATURE',
      'FEATURE',
      'BRIEF',
      'BRIEF',
      'BRIEF',
    ]);
  });

  it('produces a different selection for a reader with different priorities', () => {
    const a = editorial.select(
      profile([
        ['robotics', TopicPriority.HIGH, KnowledgeLevel.BEGINNER],
        ['quantum-physics', TopicPriority.LOW, KnowledgeLevel.ADVANCED],
      ]),
      all,
      { maxArticles: 4 },
    );
    const b = editorial.select(
      profile([['quantum-physics', TopicPriority.HIGH, KnowledgeLevel.ADVANCED]]),
      all,
      { maxArticles: 4 },
    );
    expect(b.every((p) => p.topicKey === 'quantum-physics')).toBe(true);
    expect(a[0].topicKey).toBe('robotics');
    expect(b[0].analysisId).toBe(quantum[0].analysisId);
  });

  it('uses each paper once, skips previously published papers and is deterministic', () => {
    const shared = paper(['robotics', 'quantum-physics'], 0.99);
    const reader = profile([
      ['robotics', TopicPriority.MEDIUM, KnowledgeLevel.INTERMEDIATE],
      ['quantum-physics', TopicPriority.HIGH, KnowledgeLevel.ADVANCED],
    ]);
    const picks = editorial.select(reader, [shared, ...all], {
      maxArticles: 10,
      excludedPaperIds: [robotics[0].paperId],
    });
    expect(picks.filter((p) => p.paperId === shared.paperId)).toHaveLength(1);
    expect(picks.find((p) => p.paperId === shared.paperId)!.topicKey).toBe('quantum-physics'); // higher priority topic
    expect(picks.some((p) => p.paperId === robotics[0].paperId)).toBe(false);
    expect(
      editorial.select(reader, [shared, ...all], {
        maxArticles: 10,
        excludedPaperIds: [robotics[0].paperId],
      }),
    ).toEqual(picks);
  });

  it('returns nothing rather than padding when no research matches', () => {
    expect(
      editorial.select(profile([['medicine', TopicPriority.HIGH, KnowledgeLevel.BEGINNER]]), all, {
        maxArticles: 6,
      }),
    ).toEqual([]);
  });

  describe('selection quality for multi-paper issues', () => {
    const reader = profile([['robotics', TopicPriority.HIGH, KnowledgeLevel.BEGINNER]]);
    const make = (
      title: string,
      author: string,
      relevance: number,
      publishedAt = '2026-11-20',
    ) => ({
      ...paper(['robotics'], relevance, publishedAt),
      title,
      authors: [author],
    });

    it('never selects the same work twice: preprint and journal version share a title', () => {
      const preprint = make('Learning to Grasp: A Benchmark', 'A. Smith', 0.8);
      const journal = make('Learning to grasp — a benchmark', 'A. Smith', 0.9);
      const other = make('Tactile Sensing at Scale', 'B. Jones', 0.7);
      const picked = editorial
        .select(reader, [preprint, journal, other], { maxArticles: 3 })
        .map((s) => s.paperId);
      expect(picked).toEqual([journal.paperId, other.paperId]); // the better-ranked copy wins
    });

    it('skips a work already published to the reader under another paper id', () => {
      const journal = make('Learning to grasp: a benchmark', 'A. Smith', 0.9);
      const other = make('Tactile Sensing at Scale', 'B. Jones', 0.7);
      const picked = editorial
        .select(reader, [journal, other], {
          maxArticles: 3,
          excludedTitles: ['Learning to Grasp: A Benchmark'],
        })
        .map((s) => s.paperId);
      expect(picked).toEqual([other.paperId]);
    });

    it('prefers a different first author before repeating one, without dropping papers', () => {
      const a1 = make('Paper A1', 'A. Smith', 0.95);
      const a2 = make('Paper A2', 'a. smith', 0.9);
      const b1 = make('Paper B1', 'B. Jones', 0.8);
      const c1 = make('Paper C1', 'C. Wu', 0.7);
      const picked = editorial
        .select(reader, [a1, a2, b1, c1], { maxArticles: 4 })
        .map((s) => s.paperId);
      expect(picked).toEqual([a1.paperId, b1.paperId, c1.paperId, a2.paperId]);
      expect(
        editorial.select(reader, [a1, a2, b1, c1], { maxArticles: 3 }).map((s) => s.paperId),
      ).toEqual([a1.paperId, b1.paperId, c1.paperId]);
    });

    it('orders by relevance, then recency, and is deterministic', () => {
      const older = make('Older', 'X', 0.8, '2026-11-18');
      const newer = make('Newer', 'Y', 0.8, '2026-11-21');
      const best = make('Best', 'Z', 0.9, '2026-11-10');
      const run = () =>
        editorial.select(reader, [older, newer, best], { maxArticles: 3 }).map((s) => s.paperId);
      expect(run()).toEqual([best.paperId, newer.paperId, older.paperId]);
      expect(run()).toEqual(run());
    });
  });
});
