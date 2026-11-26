import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PreferenceService } from '../../src/domain/account/service/preference.service';
import { registerAndLogin, TestSession } from '../support/auth-helpers';
import { createTestApp, truncateAll } from '../support/test-app';

const prefsA = {
  language: 'tr',
  timezone: 'America/New_York',
  dailyEmailEnabled: true,
  topics: [
    { topicKey: 'robotics', priority: 'HIGH', knowledgeLevel: 'BEGINNER' },
    { topicKey: 'quantum-physics', priority: 'LOW', knowledgeLevel: 'ADVANCED' },
  ],
};

describe('Reader preferences (e2e)', () => {
  let app: INestApplication<App>;
  let a: TestSession;
  let b: TestSession;
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    app = await createTestApp();
    await truncateAll(app.get(DataSource));
    a = await registerAndLogin(app, 'reader_a');
    b = await registerAndLogin(app, 'reader_b');
  });
  afterEach(() => app.close());

  it('returns product defaults with email delivery disabled until opted in', async () => {
    const response = await http().get('/api/preferences').set('Cookie', a.cookie).expect(200);
    expect(response.body).toEqual({
      reader: {
        userId: a.userId,
        language: 'tr',
        timezone: 'Europe/Istanbul',
        dailyEmailEnabled: false,
      },
      topics: [],
      deliveryLocalTime: '08:00',
    });
  });

  it('stores independent priority and knowledge level per topic', async () => {
    await http().put('/api/preferences').set('Cookie', a.cookie).send(prefsA).expect(200);
    const response = await http().get('/api/preferences').set('Cookie', a.cookie).expect(200);
    expect(response.body.reader).toMatchObject({
      timezone: 'America/New_York',
      dailyEmailEnabled: true,
    });
    expect(response.body.topics).toEqual([
      {
        userId: a.userId,
        topicKey: 'quantum-physics',
        priority: 'LOW',
        knowledgeLevel: 'ADVANCED',
      },
      { userId: a.userId, topicKey: 'robotics', priority: 'HIGH', knowledgeLevel: 'BEGINNER' },
    ]);
  });

  it('isolates readers: A can neither read nor write B through a supplied id', async () => {
    await http()
      .put('/api/preferences')
      .set('Cookie', a.cookie)
      .send({ ...prefsA, userId: b.userId })
      .expect(400);
    await http()
      .put('/api/preferences')
      .query({ userId: b.userId })
      .set('Cookie', a.cookie)
      .send(prefsA)
      .expect(200);
    const asB = await http()
      .get('/api/preferences')
      .query({ userId: a.userId })
      .set('Cookie', b.cookie)
      .expect(200);
    expect(asB.body.reader).toMatchObject({
      userId: b.userId,
      timezone: 'Europe/Istanbul',
      dailyEmailEnabled: false,
    });
    expect(asB.body.topics).toEqual([]);
    const meB = await http().get('/api/me').set('Cookie', b.cookie).expect(200);
    expect(meB.body.username).toBe('reader_b');
  });

  it.each([
    ['an invalid timezone', { ...prefsA, timezone: 'Mars/Olympus' }],
    ['a non-IANA timezone', { ...prefsA, timezone: 'EST' }],
    [
      'an unsupported priority',
      {
        ...prefsA,
        topics: [{ topicKey: 'robotics', priority: 'URGENT', knowledgeLevel: 'BEGINNER' }],
      },
    ],
    [
      'an unsupported topic',
      {
        ...prefsA,
        topics: [{ topicKey: 'astrology', priority: 'HIGH', knowledgeLevel: 'BEGINNER' }],
      },
    ],
    [
      'duplicate topic keys',
      { ...prefsA, topics: [prefsA.topics[0], { ...prefsA.topics[0], priority: 'LOW' }] },
    ],
    ['an unsupported language', { ...prefsA, language: 'de' }],
  ])('rejects %s without partial changes', async (_label, body) => {
    await http().put('/api/preferences').set('Cookie', a.cookie).send(prefsA).expect(200);
    await http().put('/api/preferences').set('Cookie', a.cookie).send(body).expect(400);
    const after = await http().get('/api/preferences').set('Cookie', a.cookie).expect(200);
    expect(after.body.reader.timezone).toBe('America/New_York');
    expect(after.body.topics).toHaveLength(2);
  });

  it('preserves preferences across an application restart', async () => {
    await http().put('/api/preferences').set('Cookie', a.cookie).send(prefsA).expect(200);
    await app.close();
    app = await createTestApp();
    const response = await http()
      .get('/api/preferences')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(response.body.topics).toHaveLength(2);
  });

  it('exposes schedules with defaults for readers who never saved settings', async () => {
    await http().put('/api/preferences').set('Cookie', a.cookie).send(prefsA).expect(200);
    const schedules = await app.get(PreferenceService).listReaderSchedules();
    expect(schedules).toEqual([
      { userId: a.userId, timezone: 'America/New_York', dailyEmailEnabled: true, topicCount: 2 },
      { userId: b.userId, timezone: 'Europe/Istanbul', dailyEmailEnabled: false, topicCount: 0 },
    ]);
  });
});
