import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../src/domain/account';
import { PreferenceService } from '../../src/domain/account/service/preference.service';
import { PublicationService } from '../../src/domain/publication/service/publication.service';
import { registerAndLogin, TestSession } from '../support/auth-helpers';
import { FakeAnthropic } from '../support/fake-anthropic';
import {
  FakeMailTransport,
  FakePdfRenderer,
  InMemoryFileStorage,
} from '../support/fake-integrations';
import { routingHandler, seedAnalyzedPaper } from '../support/publication-fixtures';
import { createResearchApp } from '../support/research-app';

const DATE = '2026-11-22';

describe('Issues API (e2e)', () => {
  let app: INestApplication<App>;
  let storage: InMemoryFileStorage;
  let a: TestSession;
  let b: TestSession;
  let issueA: string;
  let issueB: string;
  const http = () => request(app.getHttpServer());

  async function reader(
    username: string,
    topicKey: string,
  ): Promise<{ session: TestSession; issueId: string }> {
    const session = await registerAndLogin(app, username);
    await app.get(PreferenceService).replaceForUser(session.userId, {
      language: 'tr',
      timezone: 'Europe/Istanbul',
      dailyEmailEnabled: false,
      topics: [
        { topicKey, priority: TopicPriority.HIGH, knowledgeLevel: KnowledgeLevel.INTERMEDIATE },
      ],
    });
    const result = await app.get(PublicationService).prepareIssue(session.userId, DATE);
    return { session, issueId: result.issue!.id };
  }

  beforeAll(async () => {
    storage = new InMemoryFileStorage();
    app = (await createResearchApp({
      anthropic: new FakeAnthropic(routingHandler()),
      sources: { search: jest.fn().mockResolvedValue({ records: [], failures: [] }) },
      pdf: new FakePdfRenderer(),
      storage,
      mail: new FakeMailTransport(),
      env: { RESEARCH_HAIKU_SCREENING: 'false' },
    })) as INestApplication<App>;
    await seedAnalyzedPaper(app, 'robotics');
    await seedAnalyzedPaper(app, 'quantum-physics');
    ({ session: a, issueId: issueA } = await reader('reader_a', 'robotics'));
    ({ session: b, issueId: issueB } = await reader('reader_b', 'quantum-physics'));
  });
  afterAll(() => app.close());

  it('requires authentication', async () => {
    await http().get('/api/issues').expect(401);
    await http().get(`/api/issues/${issueA}`).expect(401);
    await http().get(`/api/issues/${issueA}/pdf`).expect(401);
    await http().put(`/api/issues/${issueA}/feedback/a1`).send({ value: 1 }).expect(401);
  });

  it("lists and serves only the reader's own issues", async () => {
    const list = await http().get('/api/issues').set('Cookie', a.cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id: issueA,
      issueDate: DATE,
      issueNumber: 1,
      status: 'READY',
      articleCount: 1,
    });

    const detail = await http().get(`/api/issues/${issueA}`).set('Cookie', a.cookie).expect(200);
    expect(detail.body.content.articles[0].topicKey).toBe('robotics');
    expect(detail.body.content.toc.at(-1).kind).toBe('OUTLOOK');
    expect(detail.body.feedback).toEqual({});

    await http().get(`/api/issues/${issueB}`).set('Cookie', a.cookie).expect(404);
    await http().get(`/api/issues/${issueB}/pdf`).set('Cookie', a.cookie).expect(404);
    await http().get('/api/issues/not-a-uuid').set('Cookie', a.cookie).expect(400);
    await http()
      .get('/api/issues')
      .query({ userId: b.userId })
      .set('Cookie', a.cookie)
      .expect(200)
      .then((r) => expect(r.body.map((i: { id: string }) => i.id)).toEqual([issueA]));
  });

  it('serves the exact stored PDF privately to its owner only', async () => {
    const response = await http()
      .get(`/api/issues/${issueA}/pdf`)
      .set('Authorization', `Bearer ${a.token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="PaperMorning-${DATE}.pdf"`,
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    const [row] = await app
      .get(DataSource)
      .query('SELECT pdf_storage_key FROM issue WHERE id = $1', [issueA]);
    expect((response.body as Buffer).equals(storage.files.get(row.pdf_storage_key)!)).toBe(true);
  });

  it('records one changeable vote per article and for the Ufuk Raporu', async () => {
    await http()
      .put(`/api/issues/${issueA}/feedback/a1`)
      .set('Cookie', a.cookie)
      .send({ value: 1 })
      .expect(200);
    await http()
      .put(`/api/issues/${issueA}/feedback/a1`)
      .set('Cookie', a.cookie)
      .send({ value: -1 })
      .expect(200);
    await http()
      .put(`/api/issues/${issueA}/feedback/outlook`)
      .set('Cookie', a.cookie)
      .send({ value: 1 })
      .expect(200);

    const detail = await http().get(`/api/issues/${issueA}`).set('Cookie', a.cookie).expect(200);
    expect(detail.body.feedback).toEqual({ a1: -1, outlook: 1 });
    const rows = await app
      .get(DataSource)
      .query('SELECT content_key, value FROM feedback ORDER BY content_key');
    expect(rows).toEqual([
      { content_key: 'a1', value: -1 },
      { content_key: 'outlook', value: 1 },
    ]);
  });

  it("rejects invalid votes, unknown content and votes on another reader's issue", async () => {
    await http()
      .put(`/api/issues/${issueA}/feedback/a1`)
      .set('Cookie', a.cookie)
      .send({ value: 5 })
      .expect(400);
    await http()
      .put(`/api/issues/${issueA}/feedback/a9`)
      .set('Cookie', a.cookie)
      .send({ value: 1 })
      .expect(400);
    await http()
      .put(`/api/issues/${issueA}/feedback/BAD_KEY!`)
      .set('Cookie', a.cookie)
      .send({ value: 1 })
      .expect(400);
    await http()
      .put(`/api/issues/${issueB}/feedback/a1`)
      .set('Cookie', a.cookie)
      .send({ value: 1 })
      .expect(404);
    await http()
      .put(`/api/issues/${issueA}/feedback/a1`)
      .set('Cookie', a.cookie)
      .set('Origin', 'https://evil.example')
      .send({ value: 1 })
      .expect(403);
  });
});
