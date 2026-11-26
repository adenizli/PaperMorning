export const SUPPORTED_LANGUAGES = ['tr'] as const;
export type ReaderLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: ReaderLanguage = 'tr';
export const DEFAULT_TIMEZONE = 'Europe/Istanbul';
/** Product constant: daily delivery target in the reader's local timezone. No per-user editor. */
export const DAILY_DELIVERY_LOCAL_TIME = '08:00';

export interface ReaderPreferenceModel {
  userId: string;
  language: ReaderLanguage;
  /** IANA timezone name. */
  timezone: string;
  /** Explicit opt-in; false until the reader enables it. */
  dailyEmailEnabled: boolean;
}

export function defaultReaderPreference(userId: string): ReaderPreferenceModel {
  return {
    userId,
    language: DEFAULT_LANGUAGE,
    timezone: DEFAULT_TIMEZONE,
    dailyEmailEnabled: false,
  };
}

export function isValidIanaTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value.includes('/') || value === 'UTC';
  } catch {
    return false;
  }
}
