import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../src/config/app.config';
import { ResearchQueryService } from '../../src/domain/research/service/research-query.service';
import { ResearchService } from '../../src/domain/research/service/research.service';
import { ResearchModule } from '../../src/domain/research/research.module';
import { LlmService } from '../../src/service/llm/llm.service';
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

  it('wires ResearchModule and exports only its public services', () => {
    expect(app.get(ResearchService)).toBeInstanceOf(ResearchService);
    expect(app.get(ResearchQueryService)).toBeInstanceOf(ResearchQueryService);
    expect(app.get(LlmService).isAvailable()).toBe(false); // no key in tests
    const exportsOf = Reflect.getMetadata('exports', ResearchModule) as unknown[];
    expect(exportsOf).toEqual([ResearchService, ResearchQueryService]);
  });

  it('never synchronizes the schema automatically', () => {
    expect(app.get(DataSource).options.synchronize).toBe(false);
  });
});
