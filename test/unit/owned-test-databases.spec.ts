import {
  assertOwnedName,
  candidateDatabaseName,
  DatabaseOwnershipError,
  OWNED_NAME_PATTERN,
} from '../support/owned-test-databases';
import { assertSafeTestDatabaseUrl, UnsafeTestDatabaseError } from '../support/test-database-guard';

describe('owned test database names (Issue #18)', () => {
  it('generates unique, unpredictable names in the owned namespace', () => {
    const names = new Set(Array.from({ length: 200 }, () => candidateDatabaseName('test')));
    expect(names.size).toBe(200);
    for (const name of names) expect(name).toMatch(OWNED_NAME_PATTERN);
  });

  it('never generates a fixed or pre-existing project database name', () => {
    for (const fixed of [
      'papermorning_test',
      'papermorning_dev',
      'papermorning_canary_test',
      'papermorning_canary',
      'papermorning_fresh_test',
      'postgres',
    ]) {
      expect(() => assertOwnedName(fixed)).toThrow(DatabaseOwnershipError);
    }
  });

  it('candidate "_test" names pass the static guard; "_canary" names never do', () => {
    const url = (db: string) => `postgres://u:p@localhost:5432/${db}`;
    const input = (db: string) => ({ testUrl: url(db), appUrls: [], nodeEnv: 'test' });
    expect(() => assertSafeTestDatabaseUrl(input(candidateDatabaseName('test')))).not.toThrow();
    expect(() => assertSafeTestDatabaseUrl(input(candidateDatabaseName('canary')))).toThrow(
      UnsafeTestDatabaseError,
    );
  });
});
