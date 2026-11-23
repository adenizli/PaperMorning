import { ConfigValidationError, loadAppConfig } from '../../src/config/app.config';

describe('loadAppConfig', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
  };

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
    expect(() => loadAppConfig({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/postgres:\/\//);
  });

  it('requires a strong JWT secret, explicit CORS origins and no Opus unless enabled', () => {
    expect(() => loadAppConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadAppConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(/explicit origins/);
    expect(() => loadAppConfig({ ...base, LLM_MODEL_ANALYSIS: 'claude-opus-5-5' })).toThrow(
      /LLM_OPUS_ENABLED/,
    );
    expect(
      loadAppConfig({ ...base, LLM_OPUS_ENABLED: 'true', LLM_MODEL_ANALYSIS: 'claude-opus-5-5' })
        .llm.models.analysis,
    ).toBe('claude-opus-5-5');
  });

  it('validates SMTP settings without requiring SMTP to start', () => {
    expect(loadAppConfig(base).mail).toMatchObject({
      enabled: false,
      security: 'starttls',
      port: 587,
    });
    const smtp = { ...base, SMTP_HOST: 'smtp.example.org', SMTP_FROM: 'pm@example.org' };
    expect(loadAppConfig(smtp).mail).toMatchObject({
      enabled: true,
      port: 587,
      security: 'starttls',
    });
    expect(loadAppConfig({ ...smtp, SMTP_SECURE: 'tls' }).mail.port).toBe(465);
    expect(loadAppConfig({ ...smtp, MAIL_ENABLED: 'false' }).mail.enabled).toBe(false);
    expect(() => loadAppConfig({ ...base, SMTP_HOST: 'smtp.example.org' })).toThrow(
      /SMTP_FROM is required/,
    );
    expect(() => loadAppConfig({ ...smtp, SMTP_USER: 'u' })).toThrow(/must be set together/);
    expect(() => loadAppConfig({ ...smtp, SMTP_SECURE: 'tls', SMTP_PORT: '587' })).toThrow(
      /does not match port 587/,
    );
    expect(() => loadAppConfig({ ...smtp, SMTP_PORT: '465' })).toThrow(
      /Port 465 uses implicit TLS/,
    );
    expect(() => loadAppConfig({ ...smtp, SMTP_SECURE: 'none' })).toThrow(
      /requires SMTP_ALLOW_INSECURE/,
    );
    expect(() =>
      loadAppConfig({ ...smtp, NODE_ENV: 'production', SMTP_ALLOW_INSECURE: 'true' }),
    ).toThrow(/not allowed in production/);
  });

  it('defaults to secure cookies, open registration and no user cap', () => {
    expect(loadAppConfig(base).auth).toMatchObject({
      cookieSecure: true,
      registrationEnabled: true,
      maxUsers: 0,
      allowedOrigins: [],
    });
  });
});
