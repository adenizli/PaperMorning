import { randomBytes } from 'crypto';
import { Client } from 'pg';

/**
 * Databases that a test creates on the shared test server, with provable ownership (Issue #18).
 *
 * Invariants:
 * - Names are unique per run: a fixed prefix plus 64 random bits, so they never coincide with a
 *   database somebody else created on purpose.
 * - A name that already exists is never reused, altered or dropped: creation fails closed.
 * - Only databases this registry created are ever dropped, and only if the server still reports
 *   the same database OID and this run's ownership comment (or, for a database the guard created,
 *   the test marker) that were recorded right after creation. A database that was dropped and
 *   recreated by anyone else in between has a different OID and is left alone.
 * - Every identifier reaching SQL matches OWNED_NAME_PATTERN; nothing from the environment or an
 *   external string is ever interpolated into DROP DATABASE.
 */
export const OWNED_NAME_PATTERN = /^pm_guard_[0-9a-f]{16}_(test|canary)$/;
export const OWNERSHIP_MARKER_PREFIX = 'papermorning:test-run-owned:';

export class DatabaseOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseOwnershipError';
  }
}

export type OwnedSuffix = 'test' | 'canary';

/** A fresh, unpredictable candidate name. Pure; does not touch the server. */
export function candidateDatabaseName(suffix: OwnedSuffix): string {
  const name = `pm_guard_${randomBytes(8).toString('hex')}_${suffix}`;
  assertOwnedName(name);
  return name;
}

export function assertOwnedName(name: string): void {
  if (!OWNED_NAME_PATTERN.test(name)) {
    throw new DatabaseOwnershipError(`"${name}" is not a test-owned database name`);
  }
}

interface OwnedRecord {
  oid: string;
  /** Comment the database must still carry for us to drop it. */
  expectedComments: string[];
}

export class OwnedTestDatabases {
  readonly runId = randomBytes(12).toString('hex');
  private readonly owned = new Map<string, OwnedRecord>();

  /** @param adminUrl connection URL of the maintenance database (`postgres`) on the test server. */
  constructor(private readonly adminUrl: string) {}

  get ownershipMarker(): string {
    return `${OWNERSHIP_MARKER_PREFIX}${this.runId}`;
  }

  /** Names this registry owns right now (for assertions). */
  ownedNames(): string[] {
    return [...this.owned.keys()];
  }

  /** Throws unless the name is absent on the server. Never modifies anything. */
  async assertAbsent(name: string): Promise<void> {
    assertOwnedName(name);
    if ((await this.lookup(name)) !== null) {
      throw new DatabaseOwnershipError(
        `database "${name}" already exists and is not owned by this test run; refusing to use it`,
      );
    }
  }

  /**
   * Creates a new database and records it as owned. Fails closed if the name is taken: the
   * existing database is not modified in any way.
   */
  async create(name: string): Promise<void> {
    await this.assertAbsent(name);
    await this.withAdmin(async (client) => {
      try {
        // CREATE DATABASE without IF NOT EXISTS: a concurrent creation fails here (42P04).
        await client.query(`CREATE DATABASE "${name}"`);
      } catch (error) {
        if ((error as { code?: string }).code === '42P04') {
          throw new DatabaseOwnershipError(
            `database "${name}" appeared concurrently; refusing to use it`,
          );
        }
        throw error;
      }
      await client.query(`COMMENT ON DATABASE "${name}" IS '${this.ownershipMarker}'`);
    });
    await this.record(name, [this.ownershipMarker]);
  }

  /**
   * Adopts a database that code under test created after `assertAbsent(name)` succeeded in this
   * run (e.g. the guard creating a missing test database). Its expected comment is the one the
   * creator set.
   */
  async adoptCreatedAfterAbsenceCheck(name: string, expectedComment: string): Promise<void> {
    assertOwnedName(name);
    await this.record(name, [expectedComment]);
  }

  /** Drops every owned database whose identity still matches. Returns names it left in place. */
  async dropAll(): Promise<string[]> {
    const skipped: string[] = [];
    for (const name of [...this.owned.keys()]) {
      if (!(await this.drop(name))) skipped.push(name);
    }
    return skipped;
  }

  /** Drops one owned database. Returns false (and drops nothing) unless ownership is proven. */
  async drop(name: string): Promise<boolean> {
    assertOwnedName(name);
    const record = this.owned.get(name);
    if (!record) return false;
    const current = await this.lookup(name);
    this.owned.delete(name);
    if (!current) return true; // already gone
    if (current.oid !== record.oid || !record.expectedComments.includes(current.comment ?? '')) {
      return false; // replaced or re-labelled by someone else: not ours any more
    }
    await this.withAdmin((client) => client.query(`DROP DATABASE "${name}"`));
    return true;
  }

  private async record(name: string, expectedComments: string[]): Promise<void> {
    const row = await this.lookup(name);
    if (!row) throw new DatabaseOwnershipError(`database "${name}" does not exist`);
    if (!expectedComments.includes(row.comment ?? '')) {
      throw new DatabaseOwnershipError(
        `database "${name}" does not carry the expected ownership comment; not adopting it`,
      );
    }
    this.owned.set(name, { oid: row.oid, expectedComments });
  }

  private lookup(name: string): Promise<{ oid: string; comment: string | null } | null> {
    return this.withAdmin(async (client) => {
      const { rows } = await client.query<{ oid: string; comment: string | null }>(
        `SELECT oid::text AS oid, shobj_description(oid, 'pg_database') AS comment
           FROM pg_database WHERE datname = $1`,
        [name],
      );
      return rows[0] ?? null;
    });
  }

  private async withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }
}
