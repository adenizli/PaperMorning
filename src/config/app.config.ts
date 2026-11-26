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
  ) {}
}

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
    {
      url: read.string('DATABASE_URL'),
      ssl: read.bool('DATABASE_SSL', false),
      logging: read.bool('DATABASE_LOGGING', false),
    },
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
  );

  if (config.database.url && !/^postgres(ql)?:\/\//.test(config.database.url)) {
    read.problems.push('DATABASE_URL must be a postgres:// connection URL');
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
