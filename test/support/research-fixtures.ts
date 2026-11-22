import { PublicationStatus } from '../../src/common/enum/research.enum';
import type { AcademicRecord } from '../../src/service/academic-source/academic-source.types';

const ABSTRACT =
  'We introduce a scalable reinforcement learning method for robotic manipulation. On 12 tasks it ' +
  'reduces training compute by 35% compared with a strong baseline while matching success rates.';

export function academicRecord(overrides: Partial<AcademicRecord> = {}): AcademicRecord {
  return {
    source: 'ARXIV',
    sourceRecordId: '2611.00001v1',
    versionLabel: 'v1',
    title: 'Scalable robot learning',
    authors: ['A. Researcher', 'B. Scientist'],
    abstract: ABSTRACT,
    doi: null,
    arxivId: '2611.00001',
    openAlexId: null,
    publicationStatus: PublicationStatus.PREPRINT,
    publishedAt: '2026-11-20',
    sourceUpdatedAt: new Date('2026-11-20T10:00:00Z'),
    venue: 'arXiv',
    landingUrl: 'https://arxiv.org/abs/2611.00001v1',
    pdfUrl: 'https://arxiv.org/pdf/2611.00001v1',
    categories: ['cs.RO'],
    ...overrides,
  };
}
