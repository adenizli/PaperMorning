import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Hermetic test environment. Only TEST_DATABASE_URL is taken from the outer environment;
 * no developer .env is ever loaded during tests.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://papermorning:papermorning@localhost:5432/papermorning_test';

process.env.NODE_ENV = 'test';
// Private PDF storage for tests lives outside the repository.
process.env.DATA_DIR = join(tmpdir(), `papermorning-test-data-${process.pid}`);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else-0123456789';
process.env.AUTH_COOKIE_SECURE = 'false';
