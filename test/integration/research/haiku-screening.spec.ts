import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { findTopic } from '../../../src/common/topic/topic-catalog';
import { PaperScreeningService } from '../../../src/domain/research/service/paper-screening.service';
import { ResearchDiscoveryService } from '../../../src/domain/research/service/research-discovery.service';
import { FakeAnthropic } from '../../support/fake-anthropic';
import { createResearchApp } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

const ambiguous = academicRecord({
  title: 'Soft materials study',
  categories: ['cond-mat.soft'],
  abstract:
    'We characterize elastomers whose compliance suits manipulation of fragile objects, measuring hysteresis across many loading cycles in detail.',
});
const clear = academicRecord({ sourceRecordId: '2611.00009v1', arxivId: '2611.00009' });

describe('PaperScreeningService (PostgreSQL)', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('uses Haiku only for ambiguous papers, persists decisions and reuses them', async () => {
    const fake = new FakeAnthropic(() => ({
      data: {
        relevant: true,
        relevanceScore: 0.6,
        reason: 'Gripper materials relevant to manipulation',
      },
    }));
    app = await createResearchApp({ anthropic: fake });
    const discovery = app.get(ResearchDiscoveryService);
    const ids = [
      (await discovery.storeRecord(ambiguous)).version.id,
      (await discovery.storeRecord(clear)).version.id,
    ];
    const screening = app.get(PaperScreeningService);

    const first = await screening.screen(findTopic('robotics')!, ids, 1);
    expect(first).toMatchObject({ screened: 2, accepted: 2 });
    expect(first.candidateVersionIds).toEqual([ids[1]]); // capped to 1, rule match ranks higher
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].model).toBe('claude-haiku-5-5');

    await screening.screen(findTopic('robotics')!, ids, 1);
    expect(fake.calls).toHaveLength(1);
    const rows = await app
      .get(DataSource)
      .query('SELECT method, model FROM paper_screening ORDER BY method');
    expect(rows).toEqual([
      { method: 'LLM', model: 'claude-haiku-5-5' },
      { method: 'RULES', model: null },
    ]);
  });

  it('keeps ambiguous papers at low priority when Haiku is unavailable', async () => {
    app = await createResearchApp({ anthropic: null });
    const id = (await app.get(ResearchDiscoveryService).storeRecord(ambiguous)).version.id;
    const result = await app.get(PaperScreeningService).screen(findTopic('robotics')!, [id], 5);
    expect(result.accepted).toBe(1);
    const [row] = await app
      .get(DataSource)
      .query('SELECT reason, relevance_score FROM paper_screening');
    expect(row.reason).toMatch(/without semantic screening/);
    expect(Number(row.relevance_score)).toBeCloseTo(0.2);
  });
});
