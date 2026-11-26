import 'reflect-metadata';
import { ConsoleLogger, INestApplicationContext, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve } from 'path';
import { AppModule } from '../app.module';
import { SUPPORTED_TOPIC_KEYS } from '../common/topic/topic-catalog';
import { sha256Hex } from '../common/text/fingerprint';
import { AppConfig, loadAppConfig } from '../config/app.config';
import { DailyPublicationScheduler } from '../core/scheduler/daily-publication.scheduler';
import { AccountService } from '../domain/account/service/account.service';
import { DeliveryService } from '../domain/publication/service/delivery.service';
import { IssueService } from '../domain/publication/service/issue.service';
import { describePublicationStatus } from '../domain/publication/service/publication-status';
import { PublicationService } from '../domain/publication/service/publication.service';
import { ResearchRunStatus } from '../domain/research';
import { ResearchService } from '../domain/research/service/research.service';
import { LlmService, startOfUtcDay } from '../service/llm/llm.service';
import { ISSUE_TEMPLATE_VERSION } from '../service/pdf/issue-html.template';
import { describeSandbox } from '../service/pdf/pdf.service';
import { CliResult, envelope, EXIT, exitCodeFor, UsageError } from './cli-outcome';
import { runPdfSmoke } from './pdf-smoke';

/**
 * Operator-only command line. Runs inside the server's own environment with the same
 * configuration; there is deliberately no unauthenticated HTTP endpoint for expensive work.
 * Prints exactly one JSON document on stdout (logs go to stderr); exit codes: see cli-outcome.ts.
 *
 *   research:run --topics robotics,quantum-physics [--date 2026-11-24] [--days 7] [--cap 3]
 *   llm:usage [--date 2026-11-24]
 *   publication:prepare --user <username|email> --date 2026-11-24
 *   publication:status --user <username|email> --date 2026-11-24          (read-only)
 *   issue:preview (--issue <id> | --user <u> --date <d>) [--out <file.pdf>|-] (read-only, no Claude)
 *   delivery:send --user <username|email> --date 2026-11-24      (real send; opt-in + READY required)
 *   delivery:resolve --delivery <id> --as SENT|RETRY             (operator decision for UNKNOWN)
 *   scheduler:plan [--at 2026-11-24T05:00:00Z]                    (dry run: never prepares or sends)
 *   scheduler:tick [--at <ISO instant>] [--send]                  (real preparation; emails only with --send)
 *   system:check                                                  (read-only effective configuration)
 *   pdf:smoke [--out <file.pdf>|-]                                (no database: real Chromium render)
 */
type Args = Record<string, string | undefined>;
type Command = (app: INestApplicationContext, args: Args) => Promise<CliResult>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const cliCommands: Record<string, Command> = {
  'research:run': async (app, args) => {
    const topicKeys = (args.topics ?? '').split(',').filter(Boolean);
    if (topicKeys.length === 0)
      throw new UsageError(`--topics required (${SUPPORTED_TOPIC_KEYS.join(', ')})`);
    const runs = await app.get(ResearchService).ensureDailyResearch({
      topicKeys,
      runDate: args.date ?? new Date().toISOString().slice(0, 10),
      trigger: 'CLI',
      lookbackDays: args.days ? Number(args.days) : undefined,
      maxCandidatesPerTopic: args.cap ? Number(args.cap) : undefined,
    });
    const statuses = runs.map((r) => r.status);
    return {
      outcome: statuses.some((s) => s === ResearchRunStatus.FAILED)
        ? 'FAILED'
        : statuses.some((s) => s === ResearchRunStatus.RUNNING)
          ? 'IN_PROGRESS'
          : 'OK',
      runs: runs.map(({ runKey, status, stage, counts, errors }) => ({
        runKey,
        status,
        stage,
        counts,
        errors,
      })),
    };
  },
  'llm:usage': async (app, args) => {
    const from = startOfUtcDay(args.date ? new Date(`${args.date}T00:00:00Z`) : new Date());
    const to = new Date(from.getTime() + 24 * 3600 * 1000);
    return { outcome: 'OK', usage: await app.get(LlmService).summarize(from, to) };
  },
  'publication:prepare': async (app, args) => {
    const userId = await requireUser(app, args);
    const date = requireDate(args);
    const { outcome, reason, issue, run } = await app
      .get(PublicationService)
      .prepareIssue(userId, date);
    const config = app.get(AppConfig);
    return {
      outcome,
      reason: reason ?? null,
      issueId: issue?.id ?? null,
      issueStatus: issue?.status ?? null,
      stage: run?.stage ?? null,
      // Kept for backward compatibility with earlier scripts.
      attempts: run?.attemptCount ?? null,
      retry: run
        ? {
            attempts: run.attemptCount,
            maxAttempts: config.publication.maxPreparationAttempts,
            retryable: run.retryable,
            errorKind: run.errorKind,
            nextAttemptAt: iso(run.nextAttemptAt),
          }
        : null,
    };
  },
  'publication:status': async (app, args) => {
    const userId = await requireUser(app, args);
    const date = requireDate(args);
    const issue = await app.get(IssueService).findByUserDate(userId, date);
    const status = describePublicationStatus({
      issue,
      run: await app.get(PublicationService).findRun(userId, date),
      delivery: issue ? await app.get(DeliveryService).findForIssue(issue.id) : null,
      maxAttempts: app.get(AppConfig).publication.maxPreparationAttempts,
      now: new Date(),
    });
    return { outcome: 'OK', user: args.user, date, ...status };
  },
  'issue:preview': async (app, args) => {
    const issues = app.get(IssueService);
    let issueId = args.issue;
    if (!issueId) {
      const userId = await requireUser(app, args);
      const issue = await issues.findByUserDate(userId, requireDate(args));
      if (!issue) throw new UsageError('No issue for this user and date');
      issueId = issue.id;
    }
    const config = app.get(AppConfig);
    const target = previewTarget(args.out, issueId, config);
    const { issue, pdf } = await issues.renderPreview(
      issueId,
      `QA ÖNİZLEMESİ — ${ISSUE_TEMPLATE_VERSION} ile yeniden dizilmiş kopya; yayımlanmış sayı değildir (sayı ${shortId(issueId)}).`,
    );
    // The published PDF is only read and verified here, never written.
    const published = issue.pdfStorageKey
      ? await issues.readVerifiedPdf(issue).then(
          (bytes) => ({ sha256: sha256Hex(bytes), verifiedUnchanged: true }),
          (error: Error) => ({
            sha256: issue.pdfSha256,
            verifiedUnchanged: false,
            error: error.message,
          }),
        )
      : null;
    if (target === '-') process.stdout.write(pdf);
    else writeFileSync(target, pdf, { flag: 'wx' });
    return {
      outcome: 'OK',
      issueId: issue.id,
      issueStatus: issue.status,
      template: ISSUE_TEMPLATE_VERSION,
      preview: {
        path: target === '-' ? 'stdout' : target,
        bytes: pdf.length,
        sha256: sha256Hex(pdf),
      },
      published,
      claudeCalls: 0,
      databaseWrites: 0,
    };
  },
  'delivery:send': async (app, args) => {
    const userId = await requireUser(app, args);
    const { outcome, message, delivery } = await app
      .get(DeliveryService)
      .sendReadyIssue(userId, requireDate(args));
    return {
      outcome,
      message: message ?? null,
      status: delivery?.status ?? null,
      attempts: delivery?.attemptCount ?? null,
      nextAttemptAt: iso(delivery?.nextAttemptAt),
      providerMessageId: delivery?.providerMessageId ?? null,
    };
  },
  'delivery:resolve': async (app, args) => {
    if (!args.delivery || (args.as !== 'SENT' && args.as !== 'RETRY')) {
      throw new UsageError('--delivery <id> and --as SENT|RETRY are required');
    }
    const delivery = await app.get(DeliveryService).resolveUnknown(args.delivery, args.as);
    return { outcome: 'OK', id: delivery.id, status: delivery.status };
  },
  'scheduler:plan': async (app, args) => {
    const scheduler = app.get(DailyPublicationScheduler);
    const at = requireInstant(args);
    const prepare = await scheduler.runPreparation(at, { dryRun: true });
    const deliver = await scheduler.runDelivery(at, { dryRun: true });
    return { outcome: 'OK', dryRun: true, at: at.toISOString(), readers: merge(prepare, deliver) };
  },
  'scheduler:tick': async (app, args) => {
    const scheduler = app.get(DailyPublicationScheduler);
    const at = requireInstant(args);
    const prepare = await scheduler.runPreparation(at);
    const deliver = await scheduler.runDelivery(at, { dryRun: args.send !== 'true' });
    return {
      outcome: 'OK',
      at: at.toISOString(),
      emailsSent: args.send === 'true',
      readers: merge(prepare, deliver),
    };
  },
  'system:check': (app) => Promise.resolve({ outcome: 'OK', ...systemCheck(app.get(AppConfig)) }),
};

/** Effective, secret-free configuration relevant to a controlled activation. */
export function systemCheck(config: AppConfig) {
  return {
    nodeEnv: config.nodeEnv,
    runtime: config.pdf.runtime,
    scheduler: {
      enabledInServer: config.scheduler.enabled,
      prepareLocalTime: config.scheduler.prepareLocalTime,
      deliveryLocalTime: config.scheduler.deliveryLocalTime,
      lateWindowMinutes: config.scheduler.lateWindowMinutes,
      preparationConcurrency: config.scheduler.preparationConcurrency,
    },
    mail: {
      enabled: config.mail.enabled,
      smtpHostConfigured: Boolean(config.mail.host),
      security: config.mail.security,
      authConfigured: Boolean(config.mail.user),
      fromConfigured: Boolean(config.mail.from),
    },
    llm: {
      apiKeyConfigured: Boolean(config.llm.apiKey),
      dailyBudgetUsd: config.llm.dailyBudgetUsd,
      models: config.llm.models,
    },
    pdf: { template: ISSUE_TEMPLATE_VERSION, sandbox: describeSandbox(config) },
    publicBaseUrlConfigured: Boolean(config.publication.publicBaseUrl),
  };
}

function shortId(issueId: string): string {
  return issueId.slice(0, 8);
}

/**
 * Preview output: stdout ("-"), an explicit new file, or a fresh file in the OS temp directory.
 * Never inside DATA_DIR (the private archive) and never over an existing file.
 */
export function previewTarget(out: string | undefined, issueId: string, config: AppConfig): string {
  if (out === '-') return '-';
  const path = resolve(out ?? join(tmpdir(), `papermorning-preview-${issueId}-${Date.now()}.pdf`));
  const inData = relative(resolve(config.storage.dataDir), path);
  if (inData === '' || (!inData.startsWith('..') && !isAbsolute(inData))) {
    throw new UsageError('--out must not point into DATA_DIR (the private PDF archive)');
  }
  if (existsSync(path)) throw new UsageError(`--out ${path} already exists`);
  return path;
}

function requireInstant(args: Args): Date {
  const at = args.at ? new Date(args.at) : new Date();
  if (Number.isNaN(at.getTime()))
    throw new UsageError('--at must be an ISO-8601 instant, e.g. 2026-11-24T05:00:00Z');
  return at;
}

function merge(
  prepare: Awaited<ReturnType<DailyPublicationScheduler['runPreparation']>>,
  deliver: Awaited<ReturnType<DailyPublicationScheduler['runDelivery']>>,
) {
  return prepare.map((p) => ({
    ...p,
    delivery: deliver.find((d) => d.userId === p.userId)?.delivery,
  }));
}

async function requireUser(app: INestApplicationContext, args: Args): Promise<string> {
  if (!args.user) throw new UsageError('--user <username|email> is required');
  const user = await app.get(AccountService).findByIdentifier(args.user);
  if (!user) throw new UsageError(`No user ${args.user}`);
  return user.id;
}

function requireDate(args: Args): string {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))
    throw new UsageError('--date YYYY-MM-DD is required');
  return args.date;
}

/** Nest logs (including warnings) go to stderr so stdout carries only the JSON result. */
class StderrLogger extends ConsoleLogger {
  protected override printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    _stream?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(messages, context, logLevel, 'stderr', errorStack);
  }
}

export function parseArgs(argv: string[]): { command?: string; args: Args } {
  const [command, ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[token.slice(2)] = next;
      i++;
    } else {
      args[token.slice(2)] = 'true';
    }
  }
  return { command, args };
}

function print(command: string, result: CliResult, stream: NodeJS.WriteStream = process.stdout) {
  stream.write(`${JSON.stringify(envelope(command, result), null, 2)}\n`);
  process.exitCode = exitCodeFor(result.outcome);
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  const known = [...Object.keys(cliCommands), 'pdf:smoke'];
  if (!command || !known.includes(command)) {
    process.stderr.write(`Usage: npm run cli -- <${known.join('|')}> [--options]\n`);
    print(command ?? '', { outcome: 'USAGE_ERROR', error: `Unknown command ${command ?? ''}` });
    return;
  }
  if (process.env.NODE_ENV !== 'test') loadDotenv({ quiet: true });
  // A binary PDF on stdout moves the JSON summary to stderr.
  const resultStream = args.out === '-' ? process.stderr : process.stdout;

  if (command === 'pdf:smoke') {
    // No database, no Nest context: proves Chromium works in this environment.
    let config: AppConfig;
    try {
      config = loadAppConfig(process.env);
    } catch (error) {
      print(command, { outcome: 'ERROR', error: (error as Error).message }, resultStream);
      return;
    }
    const { result, pdf } = await runPdfSmoke(config);
    if (pdf && args.out === '-') process.stdout.write(pdf);
    else if (pdf && args.out) writeFileSync(resolve(args.out), pdf, { flag: 'wx' });
    print(command, { ...result }, resultStream);
    return;
  }

  // CLI processes never run the cron ticks; the long-running server owns scheduling.
  process.env.SCHEDULER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new StderrLogger('cli', { logLevels: ['error', 'warn', 'log'] }),
  });
  try {
    print(command, await cliCommands[command](app, args), resultStream);
  } catch (error) {
    const usage = error instanceof UsageError;
    print(
      command,
      { outcome: usage ? 'USAGE_ERROR' : 'ERROR', error: (error as Error).message },
      resultStream,
    );
    if (!usage) process.stderr.write(`${(error as Error).stack ?? ''}\n`);
  } finally {
    await app.close();
  }
  if (process.exitCode === undefined) process.exitCode = EXIT.OK;
}

if (require.main === module) void main();
