import { INestApplication } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../../src/domain/account';
import { PreferenceService } from '../../../src/domain/account/service/preference.service';
import { PublicationService } from '../../../src/domain/publication/service/publication.service';
import { registerAndLogin } from '../../support/auth-helpers';
import { FakeAnthropic } from '../../support/fake-anthropic';
import { FakeMailTransport } from '../../support/fake-integrations';
import { extractPdfText } from '../../support/pdf-text';
import { routingHandler, seedAnalyzedPaper } from '../../support/publication-fixtures';
import { createResearchApp } from '../../support/research-app';

jest.setTimeout(120_000);

/** Real Chromium renderer + real private filesystem storage through the publication flow. */
describe('Publication with the real PDF renderer and storage', () => {
  let app: INestApplication<App>;
  const dataDir = resolve(process.env.DATA_DIR!, `real-pdf-${Date.now()}`);
  const boot = async (keepData: boolean) => {
    app = (await createResearchApp({
      anthropic: new FakeAnthropic(routingHandler()),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      mail: new FakeMailTransport(),
      keepData,
      env: { RESEARCH_HAIKU_SCREENING: 'false', DATA_DIR: dataDir },
    })) as INestApplication<App>;
  };

  afterEach(() => app.close());

  it('publishes a READY issue whose private PDF survives a restart and is served byte-identical', async () => {
    await boot(false);
    await seedAnalyzedPaper(app, 'robotics');
    await seedAnalyzedPaper(app, 'robotics');
    const reader = await registerAndLogin(app, 'pdf_reader');
    await app.get(PreferenceService).replaceForUser(reader.userId, {
      language: 'tr',
      timezone: 'Europe/Istanbul',
      dailyEmailEnabled: false,
      topics: [
        {
          topicKey: 'robotics',
          priority: TopicPriority.HIGH,
          knowledgeLevel: KnowledgeLevel.BEGINNER,
        },
      ],
    });
    const { outcome, issue } = await app
      .get(PublicationService)
      .prepareIssue(reader.userId, '2026-11-24');
    expect(outcome).toBe('READY');

    const file = join(dataDir, 'private', issue!.pdfStorageKey!);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = readFileSync(file);
    expect(stored.subarray(0, 5).toString()).toBe('%PDF-');
    expect(stored.length).toBe(issue!.pdfSizeBytes);

    const { text, pages } = extractPdfText(stored);
    expect(pages).toBeGreaterThanOrEqual(3);
    for (const article of issue!.content.articles) expect(text).toContain(article.headline);
    expect(text.lastIndexOf('Ufuk Raporu')).toBeGreaterThan(
      text.lastIndexOf(issue!.content.articles.at(-1)!.headline),
    );

    await app.close();
    await boot(true); // restart: same database and data directory
    const response = await request(app.getHttpServer())
      .get(`/api/issues/${issue!.id}/pdf`)
      .set('Authorization', `Bearer ${reader.token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((response.body as Buffer).equals(stored)).toBe(true);
    expect((await app.get(DataSource).query('SELECT status FROM issue'))[0].status).toBe('READY');
  });
});
