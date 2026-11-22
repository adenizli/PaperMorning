import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PublicationStatus } from '../../../src/common/enum/research.enum';
import { ResearchDiscoveryService } from '../../../src/domain/research/service/research-discovery.service';
import { createResearchApp } from '../../support/research-app';
import { academicRecord } from '../../support/research-fixtures';

describe('ResearchDiscoveryService (PostgreSQL)', () => {
  let app: INestApplication;
  let discovery: ResearchDiscoveryService;
  let db: DataSource;

  beforeEach(async () => {
    app = await createResearchApp();
    discovery = app.get(ResearchDiscoveryService);
    db = app.get(DataSource);
  });
  afterEach(() => app.close());

  const count = async (table: string) =>
    Number((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n);

  it('does not multiply the same revision, from the same or another source', async () => {
    const first = await discovery.storeRecord(academicRecord());
    const again = await discovery.storeRecord(academicRecord());
    // OpenAlex mirror of the same arXiv preprint (arXiv DataCite DOI already normalized away).
    const mirror = await discovery.storeRecord(
      academicRecord({
        source: 'OPENALEX',
        sourceRecordId: 'W1',
        openAlexId: 'W1',
        versionLabel: 'submittedVersion',
        abstract: `  ${academicRecord().abstract!.toUpperCase()} `,
      }),
    );
    expect(first.created).toBe(true);
    expect(again).toEqual({ version: first.version, created: false });
    expect(mirror).toEqual({ version: first.version, created: false });
    expect(await count('paper')).toBe(1);
    expect(await count('paper_version')).toBe(1);
    expect((await db.query('SELECT open_alex_id FROM paper'))[0].open_alex_id).toBe('W1');
  });

  it('preserves different revisions of one paper', async () => {
    const v1 = await discovery.storeRecord(academicRecord());
    const v2 = await discovery.storeRecord(
      academicRecord({
        sourceRecordId: '2611.00001v2',
        versionLabel: 'v2',
        abstract: `${academicRecord().abstract} We add ablations.`,
      }),
    );
    expect(v2.created).toBe(true);
    expect(v2.version.paperId).toBe(v1.version.paperId);
    expect(v2.version.id).not.toBe(v1.version.id);
    expect(await count('paper_version')).toBe(2);
  });

  it('links preprint and published versions only through a verified DOI, keeping both statuses', async () => {
    const preprint = await discovery.storeRecord(academicRecord({ doi: '10.1000/journal.1' }));
    const published = await discovery.storeRecord(
      academicRecord({
        source: 'OPENALEX',
        sourceRecordId: 'W99',
        openAlexId: 'W99',
        arxivId: null,
        doi: '10.1000/journal.1',
        publicationStatus: PublicationStatus.PEER_REVIEWED,
        venue: 'Journal of Robotics',
      }),
    );
    expect(published.version.paperId).toBe(preprint.version.paperId);
    const statuses = await db.query(
      'SELECT publication_status FROM paper_version ORDER BY publication_status',
    );
    expect(statuses.map((r: { publication_status: string }) => r.publication_status)).toEqual([
      'PEER_REVIEWED',
      'PREPRINT',
    ]);
  });

  it('never merges papers that share only a title', async () => {
    await discovery.storeRecord(academicRecord());
    await discovery.storeRecord(
      academicRecord({
        source: 'OPENALEX',
        sourceRecordId: 'W5',
        openAlexId: 'W5',
        arxivId: null,
        doi: '10.1000/other',
      }),
    );
    expect(await count('paper')).toBe(2);
  });

  it('handles concurrent discovery of the same record without duplicates', async () => {
    await Promise.all(Array.from({ length: 5 }, () => discovery.storeRecord(academicRecord())));
    expect(await count('paper')).toBe(1);
    expect(await count('paper_version')).toBe(1);
  });
});
