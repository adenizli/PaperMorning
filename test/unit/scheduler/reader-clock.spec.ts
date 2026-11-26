import { readerDay } from '../../../src/core/scheduler/reader-clock';

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
