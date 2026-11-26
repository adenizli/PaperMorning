import { isValidIanaTimezone } from '../../../src/domain/account/model/reader-preference.model';

describe('isValidIanaTimezone', () => {
  it.each(['Europe/Istanbul', 'America/New_York', 'Asia/Kolkata', 'UTC'])('accepts %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(true);
  });
  it.each(['', 'Mars/Olympus', 'EST', 'GMT+3', 'x'.repeat(80)])('rejects %s', (tz) => {
    expect(isValidIanaTimezone(tz)).toBe(false);
  });
});
