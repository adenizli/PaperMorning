import { Client } from 'pg';
import {
  candidateDatabaseName,
  DatabaseOwnershipError,
  OwnedTestDatabases,
} from '../support/owned-test-databases';
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
 *
 * Every database here is created by this run under a random name and tracked by
 * OwnedTestDatabases; cleanup drops only those, and only while their OID and ownership comment
 * still match (Issue #18). No fixed database name is ever dropped.
 */
describe('test database guard (PostgreSQL)', () => {
  const urlFor = (database: string) => {
    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${database}`;
    return url.toString();
  };
  const databases = new OwnedTestDatabases(urlFor('postgres'));
  const unmarkedTest = candidateDatabaseName('test');
  const productionLike = candidateDatabaseName('canary');

  async function exec(database: string, sql: string) {
    const client = new Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
      return (await client.query<Record<string, unknown>>(sql)).rows;
    } finally {
      await client.end();
    }
  }

  const seedPrecious = (database: string) =>
    exec(database, `CREATE TABLE precious (value text); INSERT INTO precious VALUES ('keep me')`);

  beforeAll(async () => {
    for (const name of [unmarkedTest, productionLike]) {
      await databases.create(name);
      await seedPrecious(name);
    }
  });

  afterAll(async () => {
    const skipped = await databases.dropAll();
    expect(skipped).toEqual([]);
  });

  it('refuses an existing database without the marker and leaves it untouched', async () => {
    const target = assertSafeTestDatabaseUrl({
      testUrl: urlFor(unmarkedTest),
      appUrls: [],
      nodeEnv: 'test',
    });
    await expect(assertMarkedTestDatabase(target)).rejects.toBeInstanceOf(UnsafeTestDatabaseError);
    expect(await exec(unmarkedTest, 'SELECT value FROM precious')).toEqual([{ value: 'keep me' }]);
  });

  it('refuses a production-like target before connecting at all', async () => {
    const url = new URL(urlFor(productionLike));
    url.port = '1'; // nothing listens here: a connection attempt would fail differently
    expect(() =>
      assertSafeTestDatabaseUrl({ testUrl: url.toString(), appUrls: [], nodeEnv: 'test' }),
    ).toThrow(UnsafeTestDatabaseError);
    expect(await exec(productionLike, 'SELECT value FROM precious')).toEqual([
      { value: 'keep me' },
    ]);
  });

  it('creates and marks a missing test database, then accepts it', async () => {
    const fresh = candidateDatabaseName('test');
    await databases.assertAbsent(fresh);
    const target = assertSafeTestDatabaseUrl({
      testUrl: urlFor(fresh),
      appUrls: [],
      nodeEnv: 'test',
    });
    await assertMarkedTestDatabase(target);
    await databases.adoptCreatedAfterAbsenceCheck(fresh, TEST_DATABASE_MARKER);
    const [row] = await exec(
      fresh,
      `SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database
        WHERE datname = current_database()`,
    );
    expect(row.marker).toBe(TEST_DATABASE_MARKER);
    await expect(assertMarkedTestDatabase(target)).resolves.toBeUndefined();
  });

  describe('ownership (Issue #18)', () => {
    it('never touches a pre-existing database that has the candidate name', async () => {
      // A database that some other run (or a person) created under exactly our candidate name.
      const other = new OwnedTestDatabases(urlFor('postgres'));
      const name = candidateDatabaseName('test');
      await other.create(name);
      await seedPrecious(name);
      try {
        const mine = new OwnedTestDatabases(urlFor('postgres'));
        await expect(mine.assertAbsent(name)).rejects.toBeInstanceOf(DatabaseOwnershipError);
        await expect(mine.create(name)).rejects.toBeInstanceOf(DatabaseOwnershipError);
        // Not owned by `mine`: neither an explicit drop nor cleanup removes it.
        await expect(mine.drop(name)).resolves.toBe(false);
        await expect(mine.dropAll()).resolves.toEqual([]);
        expect(await exec(name, 'SELECT value FROM precious')).toEqual([{ value: 'keep me' }]);
      } finally {
        await expect(other.drop(name)).resolves.toBe(true);
      }
    });

    it('does not drop an owned name once the database was replaced by someone else', async () => {
      const mine = new OwnedTestDatabases(urlFor('postgres'));
      const replacer = new OwnedTestDatabases(urlFor('postgres'));
      const name = candidateDatabaseName('test');
      await mine.create(name);
      // Someone drops it and creates a different database under the same name.
      await exec('postgres', `DROP DATABASE "${name}"`);
      await replacer.create(name);
      await seedPrecious(name);
      try {
        await expect(mine.drop(name)).resolves.toBe(false);
        expect(await exec(name, 'SELECT value FROM precious')).toEqual([{ value: 'keep me' }]);
      } finally {
        await expect(replacer.drop(name)).resolves.toBe(true);
      }
    });

    it('refuses names it could not have generated, before any SQL', async () => {
      const mine = new OwnedTestDatabases('postgres://invalid.invalid:1/postgres');
      for (const name of ['papermorning_test', 'papermorning_canary_test', 'x"; DROP DATABASE y']) {
        await expect(mine.create(name)).rejects.toBeInstanceOf(DatabaseOwnershipError);
        await expect(mine.drop(name)).rejects.toBeInstanceOf(DatabaseOwnershipError);
      }
    });
  });
});
