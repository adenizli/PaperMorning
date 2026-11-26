import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../../config/app.config';
import { PreferenceService } from '../../domain/account';
import type { ReaderScheduleModel } from '../../domain/account';
import { DeliveryService, DeliveryStatus, PublicationService } from '../../domain/publication';
import type { DeliveryOutcome, PrepareOutcome } from '../../domain/publication';
import { readerDay, ReaderDay } from './reader-clock';

export interface ScheduleEntry {
  userId: string;
  timezone: string;
  issueDate: string;
  localTime: string;
  dailyEmailEnabled: boolean;
  preparation: 'NOT_DUE' | 'NO_TOPICS' | PrepareOutcome | 'WOULD_PREPARE';
  delivery: 'NOT_DUE' | 'NOT_SUBSCRIBED' | 'MISSED_CUTOFF' | DeliveryOutcome | 'WOULD_SEND';
}

/**
 * Decides WHEN to prepare and deliver, per reader timezone; Publication decides HOW. Two
 * minute-level ticks so that a long preparation never delays another reader's 08:00 email.
 *
 * Preparation runs with bounded concurrency (SCHEDULER_PREPARATION_CONCURRENCY slots): one slow
 * reader occupies one slot and never blocks unrelated readers, also across ticks (a reader still
 * in flight is skipped, not started twice). PostgreSQL rows (publication_run, issue,
 * email_delivery) remain the authority for per-reader/day idempotency; the in-memory sets only
 * avoid redundant work inside this single process.
 */
@Injectable()
export class DailyPublicationScheduler {
  private readonly logger = new Logger(DailyPublicationScheduler.name);
  private delivering = false;
  private readonly settledToday = new Set<string>();
  /** Reader/day preparations queued or running in this process. */
  private readonly inFlight = new Set<string>();
  private readonly slots: Slots;

  constructor(
    private readonly config: AppConfig,
    private readonly preferences: PreferenceService,
    private readonly publications: PublicationService,
    private readonly deliveries: DeliveryService,
  ) {
    this.slots = new Slots(config.scheduler.preparationConcurrency);
  }

  /** Ticks may overlap: readers already in flight are skipped, newly due ones still start. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'daily-preparation' })
  async preparationTick(): Promise<void> {
    if (!this.config.scheduler.enabled) return;
    try {
      await this.runPreparation(new Date());
    } catch (error) {
      this.logger.error(`Preparation tick failed: ${(error as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'daily-delivery' })
  async deliveryTick(): Promise<void> {
    if (!this.config.scheduler.enabled || this.delivering) return;
    this.delivering = true;
    try {
      await this.runDelivery(new Date());
    } catch (error) {
      this.logger.error(`Delivery tick failed: ${(error as Error).message}`);
    } finally {
      this.delivering = false;
    }
  }

  /** Prepares every reader whose local preparation time has passed today. */
  async runPreparation(now: Date, options: { dryRun?: boolean } = {}): Promise<ScheduleEntry[]> {
    const entries: ScheduleEntry[] = [];
    const started: Promise<void>[] = [];
    for (const reader of await this.preferences.listReaderSchedules()) {
      const day = this.day(now, reader);
      const entry = this.entry(reader, day);
      entries.push(entry);
      if (reader.topicCount === 0) {
        entry.preparation = 'NO_TOPICS';
        continue;
      }
      if (!day.preparationDue) continue;
      const key = `prepare:${reader.userId}:${day.issueDate}`;
      if (options.dryRun) {
        entry.preparation = 'WOULD_PREPARE';
        continue;
      }
      if (this.settledToday.has(key)) {
        entry.preparation = 'READY';
        continue;
      }
      entry.preparation = 'IN_PROGRESS';
      if (this.inFlight.has(key)) continue; // started by an earlier, still running tick
      this.inFlight.add(key);
      started.push(
        this.slots
          .run(() => this.prepareOne(reader, day, key, entry))
          .finally(() => this.inFlight.delete(key)),
      );
    }
    await Promise.all(started);
    return entries;
  }

  /** One reader; failures are contained so they never affect other readers. */
  private async prepareOne(
    reader: ReaderScheduleModel,
    day: ReaderDay,
    key: string,
    entry: ScheduleEntry,
  ): Promise<void> {
    try {
      const result = await this.publications.prepareIssue(reader.userId, day.issueDate);
      entry.preparation = result.outcome;
      if (result.outcome === 'READY') this.settledToday.add(key);
      if (result.outcome === 'FAILED') {
        this.logger.warn(`Issue ${reader.userId}/${day.issueDate} not prepared: ${result.reason}`);
      }
    } catch (error) {
      entry.preparation = 'FAILED';
      this.logger.error(
        `Issue ${reader.userId}/${day.issueDate} preparation crashed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Emails today's READY issue at/after 08:00 reader-local time, within the late window. Never
   * sends an older issue as today's; an unready issue at the deadline is recorded as late.
   */
  async runDelivery(now: Date, options: { dryRun?: boolean } = {}): Promise<ScheduleEntry[]> {
    const entries: ScheduleEntry[] = [];
    for (const reader of await this.preferences.listReaderSchedules()) {
      const day = this.day(now, reader);
      const entry = this.entry(reader, day);
      entries.push(entry);
      if (!reader.dailyEmailEnabled) {
        entry.delivery = 'NOT_SUBSCRIBED';
        continue;
      }
      if (!day.pastDeadline) continue;
      const key = `deliver:${reader.userId}:${day.issueDate}`;
      if (this.settledToday.has(key)) {
        entry.delivery = 'ALREADY_SENT';
        continue;
      }
      if (day.pastCutoff) {
        const status = await this.deliveries.statusFor(reader.userId, day.issueDate);
        if (status === DeliveryStatus.SENT || status === DeliveryStatus.UNKNOWN) {
          entry.delivery = status === DeliveryStatus.SENT ? 'ALREADY_SENT' : 'UNKNOWN';
          continue;
        }
        entry.delivery = 'MISSED_CUTOFF';
        if (!options.dryRun) {
          await this.publications.recordLate(reader.userId, day.issueDate, now);
          this.settleOnce(
            key,
            `No email for ${reader.userId}/${day.issueDate}: late window ended (issue may still be on the web)`,
          );
        }
        continue;
      }
      if (options.dryRun) {
        entry.delivery = 'WOULD_SEND';
        continue;
      }
      const result = await this.deliveries.sendReadyIssue(reader.userId, day.issueDate);
      entry.delivery = result.outcome;
      if (result.outcome === 'NOT_READY') {
        await this.publications.recordLate(reader.userId, day.issueDate, now);
      } else if (['SENT', 'ALREADY_SENT', 'UNKNOWN', 'NOT_OPTED_IN'].includes(result.outcome)) {
        // UNKNOWN is settled on purpose: it is never retried automatically.
        this.settledToday.add(key);
      }
      if (result.outcome === 'UNKNOWN' || result.outcome === 'FAILED') {
        this.logger.warn(
          `Delivery ${reader.userId}/${day.issueDate}: ${result.outcome} ${result.message ?? ''}`,
        );
      }
    }
    this.pruneSettled(now);
    return entries;
  }

  private day(now: Date, reader: ReaderScheduleModel): ReaderDay {
    return readerDay(now, reader.timezone, this.config.scheduler);
  }

  private entry(reader: ReaderScheduleModel, day: ReaderDay): ScheduleEntry {
    return {
      userId: reader.userId,
      timezone: reader.timezone,
      issueDate: day.issueDate,
      localTime: day.localTime,
      dailyEmailEnabled: reader.dailyEmailEnabled,
      preparation: 'NOT_DUE',
      delivery: 'NOT_DUE',
    };
  }

  private settleOnce(key: string, message: string): void {
    if (this.settledToday.has(key)) return;
    this.settledToday.add(key);
    this.logger.warn(message);
  }

  /** Keeps the in-memory cache small: only keys for recent dates survive. */
  private pruneSettled(now: Date): void {
    const oldest = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
    for (const key of this.settledToday) {
      if (key.slice(-10) < oldest) this.settledToday.delete(key);
    }
  }
}

/** Minimal FIFO counting semaphore for in-process bounded concurrency. */
class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
