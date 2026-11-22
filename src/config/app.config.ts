export type NodeEnv = 'development' | 'production' | 'test';

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Typed, validated application configuration. Built once from the environment and injected
 * by class token (`constructor(private readonly config: AppConfig)`).
 */
export class AppConfig {
  constructor(
    readonly nodeEnv: NodeEnv,
    readonly port: number,
    readonly database: DatabaseConfig,
  ) {}
}

export interface DatabaseConfig {
  url: string;
  ssl: boolean;
  logging: boolean;
}

type Env = Record<string, string | undefined>;

/** Small reader that collects every problem instead of failing on the first one. */
export class EnvReader {
  readonly problems: string[] = [];

  constructor(private readonly env: Env) {}

  string(key: string, fallback?: string): string {
    const value = this.env[key]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    this.problems.push(`${key} is required`);
    return '';
  }

  optionalString(key: string): string | undefined {
    const value = this.env[key]?.trim();
    return value ? value : undefined;
  }

  int(key: string, fallback: number, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
    const raw = this.env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.problems.push(`${key} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  }

  number(key: string, fallback: number, min = 0) {
    const raw = this.env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      this.problems.push(`${key} must be a number >= ${min}`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (['true', '1', 'yes'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    this.problems.push(`${key} must be true or false`);
    return fallback;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const raw = this.env[key]?.trim();
    if (!raw) return fallback;
    if (!(allowed as readonly string[]).includes(raw)) {
      this.problems.push(`${key} must be one of ${allowed.join(', ')}`);
      return fallback;
    }
    return raw as T;
  }
}

export function loadAppConfig(env: Env = process.env): AppConfig {
  const read = new EnvReader(env);
  const nodeEnv = read.oneOf<NodeEnv>(
    'NODE_ENV',
    ['development', 'production', 'test'],
    'development',
  );
  const config = new AppConfig(nodeEnv, read.int('PORT', 3000, 1, 65535), {
    url: read.string('DATABASE_URL'),
    ssl: read.bool('DATABASE_SSL', false),
    logging: read.bool('DATABASE_LOGGING', false),
  });

  if (config.database.url && !/^postgres(ql)?:\/\//.test(config.database.url)) {
    read.problems.push('DATABASE_URL must be a postgres:// connection URL');
  }
  if (read.problems.length > 0) throw new ConfigValidationError(read.problems);
  return config;
}
