import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { buildPostgresOptions } from '../../src/service/persistence/typeorm-options';
import { TEST_DATABASE_URL } from './test-env';

/** Creates the test database if needed, wipes its schema and applies every migration. */
export default async function globalSetup(): Promise<void> {
  if (process.env.PM_TEST_SKIP_DB === '1') return;

  const target = new URL(TEST_DATABASE_URL);
  const dbName = target.pathname.slice(1);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }

  const dataSource = new DataSource(
    buildPostgresOptions({ url: TEST_DATABASE_URL, ssl: false, logging: false }),
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
