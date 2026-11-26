import {
  assertSafeTestDatabaseUrl,
  GuardInput,
  UnsafeTestDatabaseError,
} from '../support/test-database-guard';

const SAFE = 'postgres://tester:secret@localhost:55432/papermorning_test';
const input = (overrides: Partial<GuardInput>): GuardInput => ({
  testUrl: SAFE,
  appUrls: [],
  nodeEnv: 'test',
  ...overrides,
});
const rejects = (overrides: Partial<GuardInput>, reason: RegExp) =>
  expect(() => assertSafeTestDatabaseUrl(input(overrides))).toThrow(
    expect.objectContaining({
      name: UnsafeTestDatabaseError.name,
      message: expect.stringMatching(reason),
    }),
  );

describe('test database guard (static checks, no connection)', () => {
  it.each([
    SAFE,
    'postgresql://tester@127.0.0.1/papermorning_test',
    'postgres://tester@[::1]:5433/ci_test',
    'postgres://tester@localhost/papermorning_feature_x_test',
  ])('accepts a dedicated local test database: %s', (url) => {
    expect(assertSafeTestDatabaseUrl(input({ testUrl: url })).url).toBe(url);
  });

  it('requires TEST_DATABASE_URL explicitly (no default target)', () => {
    rejects({ testUrl: undefined }, /not set/);
    rejects({ testUrl: '' }, /not set/);
  });

  it.each([
    ['not a URL', 'papermorning_test', /not a valid URL/],
    ['non-PostgreSQL scheme', 'mysql://u@localhost/papermorning_test', /postgres:\/\//],
    ['no database', 'postgres://u@localhost', /exactly one database/],
    ['nested path', 'postgres://u@localhost/a/b_test', /exactly one database/],
    ['admin database', 'postgres://postgres@localhost/postgres', /not a dedicated test database/],
    ['template database', 'postgres://u@localhost/template1', /not a dedicated test database/],
    [
      'application database',
      'postgres://u@localhost/papermorning',
      /not a dedicated test database/,
    ],
    ['_test only as prefix', 'postgres://u@localhost/test_papermorning', /not a dedicated/],
    ['uppercase', 'postgres://u@localhost/PaperMorning_Test', /not a dedicated/],
    ['quoted/odd characters', 'postgres://u@localhost/paper%22morning_test', /not a dedicated/],
    ['production word', 'postgres://u@localhost/papermorning_prod_test', /production\/staging/],
    ['staging word', 'postgres://u@localhost/staging_test', /production\/staging/],
    ['query override', `${SAFE}?host=/var/run/postgresql`, /query parameters/],
    ['options override', `${SAFE}?options=-csearch_path%3Dprod`, /query parameters/],
    ['remote host', 'postgres://u@db.example.com/papermorning_test', /not local/],
  ])('rejects %s', (_label, testUrl, reason) => rejects({ testUrl }, reason));

  it('allows one explicitly approved non-local host (e.g. a CI service name)', () => {
    const url = 'postgres://u@postgres:5432/papermorning_test';
    rejects({ testUrl: url }, /not local/);
    expect(assertSafeTestDatabaseUrl(input({ testUrl: url, allowedHost: 'postgres' })).host).toBe(
      'postgres',
    );
  });

  it('rejects NODE_ENV=production', () => rejects({ nodeEnv: 'production' }, /production/));

  it.each([
    ['identical URL', SAFE],
    [
      'same database with other credentials',
      'postgres://app:other@localhost:55432/papermorning_test',
    ],
    ['same database via 127.0.0.1', 'postgres://app@127.0.0.1:55432/papermorning_test'],
    ['default port written out', 'postgres://app@localhost:5432/papermorning_test'],
  ])('rejects equality with the application database (%s)', (_label, appUrl) => {
    const testUrl = appUrl.includes(':5432/') ? 'postgres://t@localhost/papermorning_test' : SAFE;
    rejects({ testUrl, appUrls: [undefined, appUrl] }, /application database/);
  });

  it('accepts a different application database on the same server', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        input({ appUrls: ['postgres://app@localhost:55432/papermorning'] }),
      ),
    ).not.toThrow();
  });
});
