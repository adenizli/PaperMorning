import { parse as parseDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * The test suite DROPS and recreates the `public` schema of its database. These guards make that
 * fail closed unless the target is unmistakably a dedicated, disposable test database:
 *
 * 1. Static checks on TEST_DATABASE_URL, before any connection: explicitly set, PostgreSQL URL
 *    without query overrides, loopback host (unless that exact host is explicitly allowed),
 *    database name `<lowercase>_test` without production/staging words, NODE_ENV not production,
 *    and not the application's own database (DATABASE_URL from the environment or `.env`).
 * 2. Identity check on the server, before any destructive SQL: the database must carry the marker
 *    comment TEST_DATABASE_MARKER. Only a database the suite creates itself gets it automatically.
 */
export const TEST_DATABASE_MARKER = 'papermorning:disposable-test-database';

export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to reset the test database: ${reason}\n` +
        'The test suite drops and recreates the schema of TEST_DATABASE_URL. See README "Testler".',
    );
    this.name = 'UnsafeTestDatabaseError';
  }
}

export interface TestDatabaseTarget {
  url: string;
  host: string;
  port: number;
  database: string;
}

export interface GuardInput {
  /** TEST_DATABASE_URL as given (no fallback). */
  testUrl: string | undefined;
  /** The application's own database URLs (DATABASE_URL from the environment and from `.env`). */
  appUrls: (string | undefined)[];
  nodeEnv: string | undefined;
  /** PM_TEST_DB_ALLOW_HOST: one exact non-loopback host explicitly approved for tests. */
  allowedHost?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,57}_test$/;
const FORBIDDEN_WORDS = /(^|_)(prod|production|staging|stage|live|primary|master)(_|$)/;

/** Pure, connection-free validation (step 1). Throws UnsafeTestDatabaseError. */
export function assertSafeTestDatabaseUrl(input: GuardInput): TestDatabaseTarget {
  if (!input.testUrl) {
    throw new UnsafeTestDatabaseError(
      'TEST_DATABASE_URL is not set (there is no default; point it at a dedicated test database)',
    );
  }
  if (input.nodeEnv === 'production') {
    throw new UnsafeTestDatabaseError('NODE_ENV is "production"');
  }
  const target = parseTarget(input.testUrl);
  if (!target) throw new UnsafeTestDatabaseError('TEST_DATABASE_URL is not a valid URL');
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) {
    throw new UnsafeTestDatabaseError('TEST_DATABASE_URL must be a postgres:// URL');
  }
  if (target.hasQuery) {
    throw new UnsafeTestDatabaseError(
      'TEST_DATABASE_URL must not contain query parameters (they can redirect host or database)',
    );
  }
  if (!target.database || target.database.includes('/')) {
    throw new UnsafeTestDatabaseError('TEST_DATABASE_URL must name exactly one database');
  }
  if (!NAME_PATTERN.test(target.database)) {
    throw new UnsafeTestDatabaseError(
      `database "${target.database}" is not a dedicated test database name (expected lowercase "<name>_test")`,
    );
  }
  if (FORBIDDEN_WORDS.test(target.database)) {
    throw new UnsafeTestDatabaseError(
      `database "${target.database}" looks like a production/staging database`,
    );
  }
  if (!LOOPBACK.has(target.host) && target.host !== input.allowedHost) {
    throw new UnsafeTestDatabaseError(
      `host "${target.host}" is not local; set PM_TEST_DB_ALLOW_HOST=${target.host} only for a dedicated test server`,
    );
  }
  for (const appUrl of input.appUrls) {
    if (!appUrl) continue;
    const app = parseTarget(appUrl);
    if (appUrl.trim() === input.testUrl.trim() || (app && sameDatabase(app, target))) {
      throw new UnsafeTestDatabaseError(
        'TEST_DATABASE_URL points at the application database (DATABASE_URL)',
      );
    }
  }
  return {
    url: input.testUrl,
    host: target.host,
    port: target.port,
    database: target.database,
  };
}

/**
 * Step 2, before any destructive SQL: verifies the database's identity marker. A missing database
 * is created and marked (it is new, so nothing can be lost). An existing database without the
 * marker is refused without modification.
 */
export async function assertMarkedTestDatabase(target: TestDatabaseTarget): Promise<void> {
  const client = new Client({ connectionString: target.url });
  try {
    await client.connect();
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error; // 3D000: database missing
    await createMarkedDatabase(target);
    return;
  }
  try {
    const { rows } = await client.query<{ name: string; marker: string | null }>(
      `SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker
         FROM pg_database WHERE datname = current_database()`,
    );
    if (rows[0]?.name !== target.database) {
      throw new UnsafeTestDatabaseError(`connected to an unexpected database "${rows[0]?.name}"`);
    }
    if (rows[0].marker !== TEST_DATABASE_MARKER) {
      throw new UnsafeTestDatabaseError(
        `database "${target.database}" is not marked as a disposable test database. ` +
          'If (and only if) it holds nothing of value, mark it once with: ' +
          `COMMENT ON DATABASE "${target.database}" IS '${TEST_DATABASE_MARKER}';`,
      );
    }
  } finally {
    await client.end();
  }
}

/** Reads the guard inputs from the real (outer) environment and the repository's `.env`. */
export function guardInputFromEnvironment(env: NodeJS.ProcessEnv = process.env): GuardInput {
  return {
    testUrl: env.TEST_DATABASE_URL,
    appUrls: [env.DATABASE_URL, dotenvDatabaseUrl()],
    nodeEnv: env.NODE_ENV,
    allowedHost: env.PM_TEST_DB_ALLOW_HOST,
  };
}

function dotenvDatabaseUrl(): string | undefined {
  const file = join(__dirname, '..', '..', '.env');
  if (!existsSync(file)) return undefined;
  return parseDotenv(readFileSync(file)).DATABASE_URL;
}

async function createMarkedDatabase(target: TestDatabaseTarget): Promise<void> {
  const admin = new URL(target.url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    // The name was validated against NAME_PATTERN, so it is a safe identifier.
    await client.query(`CREATE DATABASE "${target.database}"`);
    await client.query(`COMMENT ON DATABASE "${target.database}" IS '${TEST_DATABASE_MARKER}'`);
  } finally {
    await client.end();
  }
}

interface ParsedTarget {
  protocol: string;
  host: string;
  port: number;
  database: string;
  hasQuery: boolean;
}

function parseTarget(url: string): ParsedTarget | null {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port ? Number(parsed.port) : 5432,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      hasQuery: parsed.search !== '' || parsed.hash !== '',
    };
  } catch {
    return null;
  }
}

function sameDatabase(a: ParsedTarget, b: ParsedTarget): boolean {
  const host = (h: string) => (LOOPBACK.has(h) ? 'loopback' : h);
  return host(a.host) === host(b.host) && a.port === b.port && a.database === b.database;
}
