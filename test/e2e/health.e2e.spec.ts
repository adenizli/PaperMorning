import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DatabaseHealthService } from '../../src/service/persistence/database-health.service';
import { createTestApp } from '../support/test-app';

describe('GET /api/health', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('reports ok when PostgreSQL answers', async () => {
    app = await createTestApp();
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  it('reports 503 when the database is unreachable', async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(DatabaseHealthService).useValue({ isHealthy: () => false }),
    );
    const response = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(response.body).toMatchObject({ status: 'error', database: 'down' });
  });

  it('is only served under the /api prefix', async () => {
    app = await createTestApp();
    await request(app.getHttpServer()).get('/health').expect(404);
  });
});
