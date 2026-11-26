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
    readonly llm: LlmConfig,
    readonly research: ResearchConfig,
    readonly auth: AuthConfig,
    readonly publication: PublicationConfig,
  ) {}
}

export interface PublicationConfig {
  /**
   * Externally reachable base URL of the web client used in emails (e.g. https://paper.example.org).
   * Optional: when unset, emails carry no web link (the PDF attachment is always included).
   */
  publicBaseUrl?: string;
  maxArticlesPerIssue: number;
  /** Preparation attempts per reader/day before the run stays FAILED for operator attention. */
  maxPreparationAttempts: number;
  retryBackoffMinutes: number;
  leaseSeconds: number;
  /** Raw PDF size limit; base64 MIME encoding adds ~37% on the wire. */
  maxAttachmentBytes: number;
  maxDeliveryAttempts: number;
}

export interface AuthConfig {
  /** HMAC secret for the 3-hour access token. Required; at least 32 characters. */
  jwtSecret: string;
  cookieName: string;
  /** Secure cookies require HTTPS; only disable for local HTTP development. */
  cookieSecure: boolean;
  /** Extra browser origins (besides same-origin) allowed to call the API, e.g. a desktop app origin. */
  allowedOrigins: string[];
  registrationEnabled: boolean;
  /** 0 means unlimited. */
  maxUsers: number;
  rateLimitPerMinute: number;
  /** Set when running behind a reverse proxy so client IPs (rate limiting) are correct. */
  trustProxy: boolean;
}

/** Fixed by product decision: one non-refreshable credential lifetime. */
export const ACCESS_TOKEN_TTL_SECONDS = 3 * 60 * 60;

export type LlmTaskModelMap = {
  screening: string;
  analysis: string;
  writing: string;
  outlook: string;
};

export interface ModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export interface LlmConfig {
  /** Absent means LLM work is unavailable and fails explicitly (never faked). */
  apiKey?: string;
  models: LlmTaskModelMap;
  /** Opus is disabled by default; configuring an Opus model requires this flag. */
  opusEnabled: boolean;
  dailyBudgetUsd: number;
  timeoutMs: number;
  prices: Record<string, ModelPrice>;
}

export interface ResearchConfig {
  /** Polite-pool contact for OpenAlex (operator-provided; optional). */
  openAlexMailto?: string;
  sourceTimeoutMs: number;
  lookbackDays: number;
  discoveryLimitPerSource: number;
  maxCandidatesPerTopic: number;
  haikuScreeningEnabled: boolean;
  maxHaikuScreeningsPerRun: number;
  /** How long an analysis/run claim stays exclusive before another worker may take it over. */
  leaseSeconds: number;
}

/** First-party list prices (USD per million tokens). Override or extend with LLM_PRICING_JSON. */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5 },
  'claude-sonnet-5-5': { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  'claude-opus-5-5': { inputPerMTokUsd: 4, outputPerMTokUsd: 20 },
};

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
  const llm = loadLlmConfig(read);
  const config = new AppConfig(
    nodeEnv,
    read.int('PORT', 3000, 1, 65535),
    readDatabaseConfig(read),
    llm,
    {
      openAlexMailto: read.optionalString('OPENALEX_MAILTO'),
      sourceTimeoutMs: read.int('RESEARCH_SOURCE_TIMEOUT_MS', 20_000, 1_000, 120_000),
      lookbackDays: read.int('RESEARCH_LOOKBACK_DAYS', 7, 1, 60),
      discoveryLimitPerSource: read.int('RESEARCH_DISCOVERY_LIMIT_PER_SOURCE', 25, 1, 200),
      maxCandidatesPerTopic: read.int('RESEARCH_MAX_CANDIDATES_PER_TOPIC', 5, 1, 50),
      haikuScreeningEnabled: read.bool('RESEARCH_HAIKU_SCREENING', true),
      maxHaikuScreeningsPerRun: read.int('RESEARCH_MAX_HAIKU_SCREENINGS_PER_RUN', 20, 0, 500),
      leaseSeconds: read.int('RESEARCH_LEASE_SECONDS', 600, 30, 7200),
    },
    {
      jwtSecret: read.string('JWT_SECRET'),
      cookieName: read.string('AUTH_COOKIE_NAME', 'pm_session'),
      cookieSecure: read.bool('AUTH_COOKIE_SECURE', true),
      allowedOrigins: (read.optionalString('CORS_ORIGINS') ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean),
      registrationEnabled: read.bool('REGISTRATION_ENABLED', true),
      maxUsers: read.int('MAX_USERS', 0, 0, 1_000_000),
      rateLimitPerMinute: read.int('AUTH_RATE_LIMIT_PER_MINUTE', 10, 1, 1000),
      trustProxy: read.bool('TRUST_PROXY', false),
    },
    {
      publicBaseUrl: read.optionalString('PUBLIC_BASE_URL')?.replace(/\/+$/, ''),
      maxArticlesPerIssue: read.int('PUBLICATION_MAX_ARTICLES', 6, 1, 12),
      maxPreparationAttempts: read.int('PUBLICATION_MAX_ATTEMPTS', 5, 1, 20),
      retryBackoffMinutes: read.int('PUBLICATION_RETRY_BACKOFF_MINUTES', 10, 1, 240),
      leaseSeconds: read.int('PUBLICATION_LEASE_SECONDS', 900, 30, 7200),
      maxAttachmentBytes: read.int(
        'MAIL_MAX_ATTACHMENT_BYTES',
        10 * 1024 * 1024,
        1024,
        50 * 1024 * 1024,
      ),
      maxDeliveryAttempts: read.int('MAIL_MAX_ATTEMPTS', 3, 1, 10),
    },
  );
  if (config.publication.publicBaseUrl && !/^https?:\/\//.test(config.publication.publicBaseUrl)) {
    read.problems.push('PUBLIC_BASE_URL must start with http:// or https://');
  }
  if (config.auth.jwtSecret && config.auth.jwtSecret.length < 32) {
    read.problems.push('JWT_SECRET must be at least 32 characters');
  }
  if (config.auth.allowedOrigins.includes('*')) {
    read.problems.push(
      'CORS_ORIGINS must list explicit origins; "*" is not allowed with credentials',
    );
  }

  if (read.problems.length > 0) throw new ConfigValidationError(read.problems);
  return config;
}

function loadLlmConfig(read: EnvReader): LlmConfig {
  const models: LlmTaskModelMap = {
    screening: read.string('LLM_MODEL_SCREENING', 'claude-haiku-5-5'),
    analysis: read.string('LLM_MODEL_ANALYSIS', 'claude-sonnet-5-5'),
    writing: read.string('LLM_MODEL_WRITING', 'claude-sonnet-5-5'),
    outlook: read.string('LLM_MODEL_OUTLOOK', 'claude-sonnet-5-5'),
  };
  const opusEnabled = read.bool('LLM_OPUS_ENABLED', false);
  const prices = { ...DEFAULT_MODEL_PRICES, ...parsePricing(read) };

  for (const [task, model] of Object.entries(models)) {
    if (!opusEnabled && model.includes('opus')) {
      read.problems.push(`LLM model for ${task} is an Opus model but LLM_OPUS_ENABLED is false`);
    }
    if (!prices[model]) {
      read.problems.push(`No price known for model ${model}; add it to LLM_PRICING_JSON`);
    }
  }

  return {
    apiKey: read.optionalString('ANTHROPIC_API_KEY'),
    models,
    opusEnabled,
    dailyBudgetUsd: read.number('LLM_DAILY_BUDGET_USD', 5),
    timeoutMs: read.int('LLM_TIMEOUT_MS', 180_000, 5_000, 900_000),
    prices,
  };
}

function parsePricing(read: EnvReader): Record<string, ModelPrice> {
  const raw = read.optionalString('LLM_PRICING_JSON');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    const result: Record<string, ModelPrice> = {};
    for (const [model, price] of Object.entries(parsed)) {
      if (typeof price.inputPerMTokUsd !== 'number' || typeof price.outputPerMTokUsd !== 'number') {
        throw new Error(`invalid price for ${model}`);
      }
      result[model] = {
        inputPerMTokUsd: price.inputPerMTokUsd,
        outputPerMTokUsd: price.outputPerMTokUsd,
      };
    }
    return result;
  } catch (error) {
    read.problems.push(`LLM_PRICING_JSON is invalid: ${(error as Error).message}`);
    return {};
  }
}

function readDatabaseConfig(read: EnvReader): DatabaseConfig {
  const database = {
    url: read.string('DATABASE_URL'),
    ssl: read.bool('DATABASE_SSL', false),
    logging: read.bool('DATABASE_LOGGING', false),
  };
  if (database.url && !/^postgres(ql)?:\/\//.test(database.url)) {
    read.problems.push('DATABASE_URL must be a postgres:// connection URL');
  }
  return database;
}

/** Database settings only (used by the migration CLI, which needs no other secrets). */
export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  const read = new EnvReader(env);
  const database = readDatabaseConfig(read);
  if (read.problems.length > 0) throw new ConfigValidationError(read.problems);
  return database;
}
