import 'reflect-metadata';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SUPPORTED_TOPIC_KEYS } from '../common/topic/topic-catalog';
import { ResearchService } from '../domain/research/service/research.service';
import { LlmService, startOfUtcDay } from '../service/llm/llm.service';

/**
 * Operator-only command line. Runs inside the server's own environment with the same
 * configuration; there is deliberately no unauthenticated HTTP endpoint for expensive work.
 *
 *   npm run cli -- research:run --topics robotics,quantum-physics [--date 2026-11-24] [--days 7] [--cap 3]
 *   npm run cli -- llm:usage [--date 2026-11-24]
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
};

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
