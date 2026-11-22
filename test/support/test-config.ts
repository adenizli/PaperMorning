import { AppConfig, loadAppConfig } from '../../src/config/app.config';

/** Real config loader with test overrides (never reads .env). */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadAppConfig({ ...process.env, ...overrides });
}
