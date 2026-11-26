import 'reflect-metadata';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SUPPORTED_TOPIC_KEYS } from '../common/topic/topic-catalog';
import { DailyPublicationScheduler } from '../core/scheduler/daily-publication.scheduler';
import { AccountService } from '../domain/account/service/account.service';
import { DeliveryService } from '../domain/publication/service/delivery.service';
import { PublicationService } from '../domain/publication/service/publication.service';
import { ResearchService } from '../domain/research/service/research.service';
import { LlmService, startOfUtcDay } from '../service/llm/llm.service';

/**
 * Operator-only command line. Runs inside the server's own environment with the same
 * configuration; there is deliberately no unauthenticated HTTP endpoint for expensive work.
 *
 *   npm run cli -- research:run --topics robotics,quantum-physics [--date 2026-11-24] [--days 7] [--cap 3]
 *   npm run cli -- llm:usage [--date 2026-11-24]
 *   npm run cli -- publication:prepare --user <username|email> --date 2026-11-24
 *   npm run cli -- delivery:send --user <username|email> --date 2026-11-24      (real send; opt-in + READY required)
 *   npm run cli -- delivery:resolve --delivery <id> --as SENT|RETRY             (operator decision for UNKNOWN)
 *   npm run cli -- scheduler:plan [--at 2026-11-24T05:00:00Z]                    (dry run: never prepares or sends)
 *   npm run cli -- scheduler:tick [--at <ISO instant>] [--send]                  (real preparation; emails only with --send)
 */
type Args = Record<string, string | undefined>;

const commands: Record<string, (app: INestApplicationContext, args: Args) => Promise<unknown>> = {
  'research:run': async (app, args) => {
    const topicKeys = (args.topics ?? '').split(',').filter(Boolean);
    if (topicKeys.length === 0)
      throw new Error(`--topics required (${SUPPORTED_TOPIC_KEYS.join(', ')})`);
    const runs = await app.get(ResearchService).ensureDailyResearch({
      topicKeys,
      runDate: args.date ?? new Date().toISOString().slice(0, 10),
      trigger: 'CLI',
      lookbackDays: args.days ? Number(args.days) : undefined,
      maxCandidatesPerTopic: args.cap ? Number(args.cap) : undefined,
    });
    return runs.map(({ runKey, status, stage, counts, errors }) => ({
      runKey,
      status,
      stage,
      counts,
      errors,
    }));
  },
  'llm:usage': async (app, args) => {
    const from = startOfUtcDay(args.date ? new Date(`${args.date}T00:00:00Z`) : new Date());
    const to = new Date(from.getTime() + 24 * 3600 * 1000);
    return app.get(LlmService).summarize(from, to);
  },
  'publication:prepare': async (app, args) => {
    const userId = await requireUser(app, args);
    const { outcome, reason, issue, run } = await app
      .get(PublicationService)
      .prepareIssue(userId, requireDate(args));
    return {
      outcome,
      reason,
      issueId: issue?.id,
      issueStatus: issue?.status,
      stage: run?.stage,
      attempts: run?.attemptCount,
    };
  },
  'delivery:send': async (app, args) => {
    const userId = await requireUser(app, args);
    const { outcome, message, delivery } = await app
      .get(DeliveryService)
      .sendReadyIssue(userId, requireDate(args));
    return {
      outcome,
      message,
      status: delivery?.status,
      attempts: delivery?.attemptCount,
      providerMessageId: delivery?.providerMessageId,
    };
  },
  'delivery:resolve': async (app, args) => {
    if (!args.delivery || (args.as !== 'SENT' && args.as !== 'RETRY')) {
      throw new Error('--delivery <id> and --as SENT|RETRY are required');
    }
    const delivery = await app.get(DeliveryService).resolveUnknown(args.delivery, args.as);
    return { id: delivery.id, status: delivery.status };
  },
  'scheduler:plan': async (app, args) => {
    const scheduler = app.get(DailyPublicationScheduler);
    const at = requireInstant(args);
    const prepare = await scheduler.runPreparation(at, { dryRun: true });
    const deliver = await scheduler.runDelivery(at, { dryRun: true });
    return { at: at.toISOString(), readers: merge(prepare, deliver) };
  },
  'scheduler:tick': async (app, args) => {
    const scheduler = app.get(DailyPublicationScheduler);
    const at = requireInstant(args);
    const prepare = await scheduler.runPreparation(at);
    const deliver = await scheduler.runDelivery(at, { dryRun: args.send !== 'true' });
    return {
      at: at.toISOString(),
      emailsSent: args.send === 'true',
      readers: merge(prepare, deliver),
    };
  },
};

function requireInstant(args: Args): Date {
  const at = args.at ? new Date(args.at) : new Date();
  if (Number.isNaN(at.getTime()))
    throw new Error('--at must be an ISO-8601 instant, e.g. 2026-11-24T05:00:00Z');
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
  if (!args.user) throw new Error('--user <username|email> is required');
  const user = await app.get(AccountService).findByIdentifier(args.user);
  if (!user) throw new Error(`No user ${args.user}`);
  return user.id;
}

function requireDate(args: Args): string {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date))
    throw new Error('--date YYYY-MM-DD is required');
  return args.date;
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

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  const handler = command ? commands[command] : undefined;
  if (!handler) {
    console.error(`Usage: npm run cli -- <${Object.keys(commands).join('|')}> [--options]`);
    process.exitCode = 2;
    return;
  }
  // CLI processes never run the cron ticks; the long-running server owns scheduling.
  process.env.SCHEDULER_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    console.log(JSON.stringify(await handler(app, args), null, 2));
  } catch (error) {
    Logger.error((error as Error).message, 'cli');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
