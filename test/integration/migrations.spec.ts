import { DataSource } from 'typeorm';
import { createTestApp } from '../support/test-app';
import { INestApplication } from '@nestjs/common';

describe('database migrations', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('has applied every migration on the fresh test database', async () => {
    expect(await dataSource.showMigrations()).toBe(false);
  });

  it('leaves no drift between entity metadata and the migrated schema', async () => {
    const pending = await dataSource.driver.createSchemaBuilder().log();
    expect(pending.upQueries.map((query) => query.query)).toEqual([]);
  });
});
