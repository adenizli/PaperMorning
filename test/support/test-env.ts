/**
 * Hermetic test environment. Only TEST_DATABASE_URL is taken from the outer environment;
 * no developer .env is ever loaded during tests.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://papermorning:papermorning@localhost:5432/papermorning_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
