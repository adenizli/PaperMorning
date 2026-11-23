import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';

/** Boots the real AppModule (real DI graph, real PostgreSQL) with optional provider overrides. */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error', 'warn'] }));
  await app.init();
  return app;
}

/** Empties every application table (keeps the migrations bookkeeping table). */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  const tables = dataSource.entityMetadatas.map((meta) => `"${meta.tableName}"`);
  if (tables.length > 0) await dataSource.query(`TRUNCATE ${tables.join(', ')} CASCADE`);
}
