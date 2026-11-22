import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../src/config/app.config';
import { HealthController } from '../../src/core/health/health.controller';
import { DatabaseHealthService } from '../../src/service/persistence/database-health.service';
import { createTestApp } from '../support/test-app';

describe('AppModule initialization', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves the App -> Core/Service/Domain dependency graph', () => {
    expect(app.get(AppConfig).nodeEnv).toBe('test');
    expect(app.get(HealthController)).toBeInstanceOf(HealthController);
    expect(app.get(DatabaseHealthService)).toBeInstanceOf(DatabaseHealthService);
  });

  it('never synchronizes the schema automatically', () => {
    expect(app.get(DataSource).options.synchronize).toBe(false);
  });
});
