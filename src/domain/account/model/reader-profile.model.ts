import type { ReaderPreferenceModel } from './reader-preference.model';
import type { TopicPreferenceModel } from './topic-preference.model';

/** Everything Publication needs to personalize an issue, read through PreferenceService. */
export interface ReaderProfileModel {
  reader: ReaderPreferenceModel;
  topics: TopicPreferenceModel[];
}

/** Minimal per-reader scheduling facts for the daily scheduler. */
export interface ReaderScheduleModel {
  userId: string;
  timezone: string;
  dailyEmailEnabled: boolean;
  topicCount: number;
}
