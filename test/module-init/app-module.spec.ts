import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../src/config/app.config';
import { ResearchQueryService } from '../../src/domain/research/service/research-query.service';
import { ResearchService } from '../../src/domain/research/service/research.service';
import { ResearchModule } from '../../src/domain/research/research.module';
import { LlmService } from '../../src/service/llm/llm.service';
import { AccountModule } from '../../src/domain/account/account.module';
import { AccountService } from '../../src/domain/account/service/account.service';
import { PreferenceService } from '../../src/domain/account/service/preference.service';
import { AuthService } from '../../src/core/auth/auth.service';
import { PublicationModule } from '../../src/domain/publication/publication.module';
import { DeliveryService } from '../../src/domain/publication/service/delivery.service';
import { OperationsService } from '../../src/domain/publication/service/operations.service';
import { PublicationService } from '../../src/domain/publication/service/publication.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DailyPublicationScheduler } from '../../src/core/scheduler/daily-publication.scheduler';
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

  it('wires AccountModule (public services only) and core auth without cycles', () => {
    expect(app.get(AccountService)).toBeInstanceOf(AccountService);
    expect(app.get(PreferenceService)).toBeInstanceOf(PreferenceService);
    expect(app.get(AuthService)).toBeInstanceOf(AuthService);
    expect(Reflect.getMetadata('exports', AccountModule)).toEqual([
      AccountService,
      PreferenceService,
    ]);
    expect(Reflect.getMetadata('imports', AccountModule)).toHaveLength(1); // only its repository module
  });

  it('wires PublicationModule with seven services and exports only the public entrypoints', () => {
    expect(app.get(PublicationService)).toBeInstanceOf(PublicationService);
    expect(app.get(DeliveryService)).toBeInstanceOf(DeliveryService);
    expect(app.get(OperationsService)).toBeInstanceOf(OperationsService);
    expect(Reflect.getMetadata('providers', PublicationModule)).toHaveLength(7);
    expect(Reflect.getMetadata('exports', PublicationModule)).toEqual([
      PublicationService,
      DeliveryService,
      OperationsService, // read-only operator overview (ops:status)
    ]);
  });

  it('registers exactly the two minute-level scheduler ticks (no cron per user)', () => {
    expect(app.get(DailyPublicationScheduler)).toBeInstanceOf(DailyPublicationScheduler);
    const jobs = app.get(SchedulerRegistry).getCronJobs();
    expect([...jobs.keys()].sort()).toEqual(['daily-delivery', 'daily-preparation']);
    expect(app.get(AppConfig).scheduler.enabled).toBe(false); // ticks are no-ops in tests
  });

  it('never synchronizes the schema automatically', () => {
    expect(app.get(DataSource).options.synchronize).toBe(false);
  });
});
