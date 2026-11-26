import { DataSource } from 'typeorm';
import { buildPostgresOptions } from '../../src/service/persistence/typeorm-options';
import {
  assertMarkedTestDatabase,
  assertSafeTestDatabaseUrl,
  guardInputFromEnvironment,
} from './test-database-guard';

/**
 * Wipes the test database's schema and applies every migration, but only after both safety
 * guards passed (see test-database-guard.ts). Deliberately does not import test-env.ts: the guard
 * must see the real outer environment (DATABASE_URL, NODE_ENV) before anything overrides it.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.PM_TEST_SKIP_DB === '1') return;

  // 1. Static checks: nothing is connected to before these pass.
  const target = assertSafeTestDatabaseUrl(guardInputFromEnvironment());
  // 2. Server-side identity marker: nothing destructive runs before this passes.
  await assertMarkedTestDatabase(target);

  const dataSource = new DataSource(
    buildPostgresOptions({ url: target.url, ssl: false, logging: false }),
  );
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
