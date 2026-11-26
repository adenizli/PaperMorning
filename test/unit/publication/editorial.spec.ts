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
});
