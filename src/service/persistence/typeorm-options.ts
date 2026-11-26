import { join } from 'path';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import type { DatabaseConfig } from '../../config/app.config';
import { SnakeNamingStrategy } from './snake-naming.strategy';

export const MIGRATIONS_GLOB = join(__dirname, 'migrations', '*.{ts,js}');
export const ENTITIES_GLOB = join(__dirname, '..', '..', '**', '*.entity.{ts,js}');

/**
 * Shared PostgreSQL options for the NestJS runtime and the migration CLI.
 * Schema synchronization is permanently disabled: every schema change is an explicit migration.
 */
export function buildPostgresOptions(database: DatabaseConfig): PostgresConnectionOptions {
  return {
    type: 'postgres',
    url: database.url,
    ssl: database.ssl ? { rejectUnauthorized: true } : false,
    logging: database.logging ? ['query', 'error'] : ['error'],
    synchronize: false,
    // gen_random_uuid() is built into PostgreSQL 13+; no uuid-ossp extension needed.
    uuidExtension: 'pgcrypto',
    migrationsRun: false,
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'migrations',
    namingStrategy: new SnakeNamingStrategy(),
  };
}
