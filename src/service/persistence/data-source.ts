import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { loadDatabaseConfig } from '../../config/app.config';
import { buildPostgresOptions, ENTITIES_GLOB } from './typeorm-options';

/** DataSource used only by the TypeORM CLI (`npm run migration:*`). */
loadDotenv({ quiet: true });
const database = loadDatabaseConfig(process.env);

export default new DataSource({ ...buildPostgresOptions(database), entities: [ENTITIES_GLOB] });
