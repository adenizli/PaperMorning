import { nextLocalOccurrence, readerDay } from '../../../src/core/scheduler/reader-clock';

const settings = { prepareLocalTime: '06:00', deliveryLocalTime: '08:00', lateWindowMinutes: 120 };
const at = (iso: string, tz: string) => readerDay(new Date(iso), tz, settings);

describe('readerDay (explicit instants, independent of the host timezone)', () => {
  it('computes local date and 06:00 / 08:00 for two timezones from one UTC instant', () => {
    const istanbul = at('2026-11-24T05:00:00Z', 'Europe/Istanbul'); // UTC+3 -> 08:00
    expect(istanbul).toMatchObject({
      issueDate: '2026-11-24',
      localTime: '08:00',
      preparationDue: true,
      deliveryDue: true,
    });
    expect(istanbul.deliverAt.toISOString()).toBe('2026-11-24T05:00:00.000Z');
    expect(istanbul.prepareAt.toISOString()).toBe('2026-11-24T03:00:00.000Z');

    const newYork = at('2026-11-24T05:00:00Z', 'America/New_York'); // UTC-5 -> 00:00
    expect(newYork).toMatchObject({
      issueDate: '2026-11-24',
      localTime: '00:00',
      preparationDue: false,
      deliveryDue: false,
    });
    expect(newYork.deliverAt.toISOString()).toBe('2026-11-24T13:00:00.000Z');
  });

  it('handles the minute before and at 08:00 and the late cutoff', () => {
    expect(at('2026-11-24T04:59:00Z', 'Europe/Istanbul')).toMatchObject({
      deliveryDue: false,
      pastDeadline: false,
    });
    expect(at('2026-11-24T05:00:00Z', 'Europe/Istanbul')).toMatchObject({ deliveryDue: true });
    expect(at('2026-11-24T07:00:00Z', 'Europe/Istanbul')).toMatchObject({
      deliveryDue: true,
      pastCutoff: false,
    }); // 10:00 exactly
    expect(at('2026-11-24T07:01:00Z', 'Europe/Istanbul')).toMatchObject({
      deliveryDue: false,
      pastCutoff: true,
    });
  });

  it('rolls over the local date at local midnight, not UTC midnight', () => {
    expect(at('2026-11-24T20:59:00Z', 'Europe/Istanbul').issueDate).toBe('2026-11-24');
    expect(at('2026-11-24T21:00:00Z', 'Europe/Istanbul').issueDate).toBe('2026-11-25');
    expect(at('2026-11-24T10:30:00Z', 'Pacific/Auckland').issueDate).toBe('2026-11-24'); // 23:30 NZDT
    expect(at('2026-11-24T11:00:00Z', 'Pacific/Auckland').issueDate).toBe('2026-11-25');
    expect(at('2026-11-24T07:59:00Z', 'America/Los_Angeles').issueDate).toBe('2026-11-23');
  });

  it('follows DST: 08:00 New York is 13:00Z in winter and 12:00Z after the March switch', () => {
    expect(at('2026-03-07T13:00:00Z', 'America/New_York').deliverAt.toISOString()).toBe(
      '2026-03-07T13:00:00.000Z',
    );
    const switchDay = at('2026-03-08T12:00:00Z', 'America/New_York');
    expect(switchDay).toMatchObject({
      issueDate: '2026-03-08',
      localTime: '08:00',
      deliveryDue: true,
    });
    expect(at('2026-03-08T11:59:00Z', 'America/New_York').deliveryDue).toBe(false);
  });

  it('follows DST in Europe: Berlin 08:00 is 06:00Z in summer and 07:00Z after the October switch', () => {
    expect(at('2026-10-24T06:00:00Z', 'Europe/Berlin')).toMatchObject({
      localTime: '08:00',
      deliveryDue: true,
    });
    expect(at('2026-10-25T06:00:00Z', 'Europe/Berlin')).toMatchObject({
      localTime: '07:00',
      deliveryDue: false,
    });
    expect(at('2026-10-25T07:00:00Z', 'Europe/Berlin')).toMatchObject({
      localTime: '08:00',
      deliveryDue: true,
    });
  });

  it('stops automatic preparation after the late cutoff (no paid work for an issue that cannot be emailed)', () => {
    expect(at('2026-11-24T03:00:00Z', 'Europe/Istanbul').preparationDue).toBe(true); // 06:00
    expect(at('2026-11-24T07:00:00Z', 'Europe/Istanbul').preparationDue).toBe(true); // 10:00 cutoff
    expect(at('2026-11-24T07:01:00Z', 'Europe/Istanbul').preparationDue).toBe(false);
    expect(at('2026-11-24T02:59:00Z', 'America/New_York').preparationDue).toBe(false); // 21:59 previous day
  });

  it('rejects invalid timezones instead of silently using server time', () => {
    expect(() => at('2026-11-24T05:00:00Z', 'Mars/Olympus')).toThrow(/Invalid timezone/);
  });
});

describe('pilot target: Europe/Istanbul, prepare 06:00, deliver 08:00', () => {
  const next = (iso: string, hhmm: string, tz = 'Europe/Istanbul') =>
    nextLocalOccurrence(new Date(iso), tz, hhmm).toISOString();

  it('next preparation and delivery are today before the times and tomorrow after them', () => {
    // 02:59 Istanbul (UTC+3, no DST since 2016)
    expect(next('2026-11-28T23:59:00Z', '06:00')).toBe('2026-11-29T03:00:00.000Z');
    expect(next('2026-11-29T02:59:00Z', '06:00')).toBe('2026-11-29T03:00:00.000Z');
    // exactly 06:00 counts as started: the next one is tomorrow
    expect(next('2026-11-29T03:00:00Z', '06:00')).toBe('2026-11-30T03:00:00.000Z');
    expect(next('2026-11-29T04:30:00Z', '08:00')).toBe('2026-11-29T05:00:00.000Z');
    expect(next('2026-11-29T05:00:01Z', '08:00')).toBe('2026-11-30T05:00:00.000Z');
  });

  it('keeps 08:00 local across DST changes (the UTC offset moves, not the wall clock)', () => {
    expect(next('2027-03-27T12:00:00Z', '08:00', 'Europe/Berlin')).toBe('2027-03-28T06:00:00.000Z');
    expect(next('2027-03-27T06:00:00Z', '08:00', 'Europe/Berlin')).toBe('2027-03-27T07:00:00.000Z');
    expect(next('2026-11-01T00:00:00Z', '08:00', 'America/New_York')).toBe(
      '2026-11-01T13:00:00.000Z',
    );
  });

  it('gives identical results whatever the host process timezone is', () => {
    const original = process.env.TZ;
    const results: string[] = [];
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kathmandu']) {
        process.env.TZ = tz;
        const day = readerDay(new Date('2026-11-29T04:59:00Z'), 'Europe/Istanbul', settings);
        results.push(
          JSON.stringify({
            ...day,
            next: [next('2026-11-29T04:59:00Z', '06:00'), next('2026-11-29T04:59:00Z', '08:00')],
          }),
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0])).toMatchObject({
      issueDate: '2026-11-29',
      localTime: '07:59',
      preparationDue: true,
      deliveryDue: false,
      next: ['2026-11-30T03:00:00.000Z', '2026-11-29T05:00:00.000Z'],
    });
  });

  it('rejects an invalid timezone for next occurrences too', () => {
    expect(() => next('2026-11-29T00:00:00Z', '06:00', 'Mars/Olympus')).toThrow(/Invalid timezone/);
  });
});
