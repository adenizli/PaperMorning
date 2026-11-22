import { ConfigValidationError, loadAppConfig } from '../../src/config/app.config';

describe('loadAppConfig', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('applies safe defaults', () => {
    const config = loadAppConfig(base);
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.database).toEqual({ url: base.DATABASE_URL, ssl: false, logging: false });
  });

  it('collects every problem instead of failing on the first', () => {
    expect.assertions(3);
    try {
      loadAppConfig({ PORT: 'abc', NODE_ENV: 'staging' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const problems = (error as ConfigValidationError).problems.join('\n');
      expect(problems).toMatch(/DATABASE_URL is required/);
      expect(problems).toMatch(/PORT must be an integer/);
    }
  });

  it('rejects non-postgres database URLs', () => {
    expect(() => loadAppConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/postgres:\/\//);
  });
});
