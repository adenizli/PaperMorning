import { Client } from 'pg';
import {
  assertMarkedTestDatabase,
  assertSafeTestDatabaseUrl,
  TEST_DATABASE_MARKER,
  UnsafeTestDatabaseError,
} from '../support/test-database-guard';
import { TEST_DATABASE_URL } from '../support/test-env';

/**
 * Runs against the (already verified) test server: proves that an unmarked database and a
 * production-like target are refused without any change to their contents.
 */
describe('test database guard (PostgreSQL)', () => {
  const urlFor = (database: string) => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${database}`;
    return url.toString();
  };
  const admin = () => new Client({ connectionString: urlFor('postgres') });
  const canaries = ['papermorning_canary_test', 'papermorning_canary', 'papermorning_fresh_test'];

  async function exec(database: string, sql: string) {
    const client = new Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
      return (await client.query<Record<string, unknown>>(sql)).rows;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    const client = admin();
    await client.connect();
    try {
      for (const name of canaries) await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      for (const name of canaries.slice(0, 2)) await client.query(`CREATE DATABASE "${name}"`);
    } finally {
      await client.end();
    }
    for (const name of canaries.slice(0, 2)) {
      await exec(
        name,
        `CREATE TABLE precious (value text); INSERT INTO precious VALUES ('keep me')`,
      );
    }
  });

  afterAll(async () => {
    const client = admin();
    await client.connect();
    try {
      for (const name of canaries) await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    } finally {
      await client.end();
    }
  });

  it('refuses an existing database without the marker and leaves it untouched', async () => {
    const target = assertSafeTestDatabaseUrl({
      testUrl: urlFor('papermorning_canary_test'),
      appUrls: [],
      nodeEnv: 'test',
    });
    await expect(assertMarkedTestDatabase(target)).rejects.toBeInstanceOf(UnsafeTestDatabaseError);
    expect(await exec('papermorning_canary_test', 'SELECT value FROM precious')).toEqual([
      { value: 'keep me' },
    ]);
  });

  it('refuses a production-like target before connecting at all', async () => {
    const url = new URL(urlFor('papermorning_canary'));
    url.port = '1'; // nothing listens here: a connection attempt would fail differently
    expect(() =>
      assertSafeTestDatabaseUrl({ testUrl: url.toString(), appUrls: [], nodeEnv: 'test' }),
    ).toThrow(UnsafeTestDatabaseError);
    expect(await exec('papermorning_canary', 'SELECT value FROM precious')).toEqual([
      { value: 'keep me' },
    ]);
  });

  it('creates and marks a missing test database, then accepts it', async () => {
    const target = assertSafeTestDatabaseUrl({
      testUrl: urlFor('papermorning_fresh_test'),
      appUrls: [],
      nodeEnv: 'test',
    });
    await assertMarkedTestDatabase(target);
    const [row] = await exec(
      'papermorning_fresh_test',
      `SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database
        WHERE datname = current_database()`,
    );
    expect(row.marker).toBe(TEST_DATABASE_MARKER);
    await expect(assertMarkedTestDatabase(target)).resolves.toBeUndefined();
  });
});
