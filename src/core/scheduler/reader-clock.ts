import { DateTime } from 'luxon';

export interface ReaderDay {
  /** Reader-local calendar date (YYYY-MM-DD) of the given instant. */
  issueDate: string;
  localTime: string;
  prepareAt: Date;
  deliverAt: Date;
  lateCutoff: Date;
  /**
   * From the preparation time until the late cutoff: automatic (paid) preparation only happens
   * while today's email could still be delivered. Later days can be prepared manually via CLI.
   */
  preparationDue: boolean;
  /** Between the delivery time and the late cutoff. */
  deliveryDue: boolean;
  pastDeadline: boolean;
  pastCutoff: boolean;
}

/**
 * Pure timezone arithmetic on a UTC instant using real IANA rules (DST-aware). Never uses the
 * server's timezone and never "adds 24h" to simulate a reader day.
 */
export function readerDay(
  now: Date,
  timezone: string,
  settings: { prepareLocalTime: string; deliveryLocalTime: string; lateWindowMinutes: number },
): ReaderDay {
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone);
  if (!local.isValid) throw new Error(`Invalid timezone ${timezone}`);
  const at = (hhmm: string) => {
    const [hour, minute] = hhmm.split(':').map(Number);
    return local.set({ hour, minute, second: 0, millisecond: 0 });
  };
  const prepareAt = at(settings.prepareLocalTime);
  const deliverAt = at(settings.deliveryLocalTime);
  const lateCutoff = deliverAt.plus({ minutes: settings.lateWindowMinutes });
  return {
    issueDate: local.toISODate(),
    localTime: local.toFormat('HH:mm'),
    prepareAt: prepareAt.toJSDate(),
    deliverAt: deliverAt.toJSDate(),
    lateCutoff: lateCutoff.toJSDate(),
    preparationDue: local >= prepareAt && local <= lateCutoff,
    deliveryDue: local >= deliverAt && local <= lateCutoff,
    pastDeadline: local >= deliverAt,
    pastCutoff: local > lateCutoff,
  };
}

/**
 * The next instant (strictly after `now`) at which the reader's wall clock shows `hhmm`, using
 * IANA rules: across a DST change the local time stays 08:00 and the UTC offset moves.
 */
export function nextLocalOccurrence(now: Date, timezone: string, hhmm: string): Date {
  const local = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone);
  if (!local.isValid) throw new Error(`Invalid timezone ${timezone}`);
  const [hour, minute] = hhmm.split(':').map(Number);
  const today = local.set({ hour, minute, second: 0, millisecond: 0 });
  const next =
    today > local
      ? today
      : local.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  return next.toJSDate();
}
