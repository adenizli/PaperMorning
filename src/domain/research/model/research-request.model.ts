export interface DailyResearchRequest {
  topicKeys: string[];
  /** The UTC day (YYYY-MM-DD) the research run belongs to; one run per topic per day. */
  runDate: string;
  trigger: 'SCHEDULER' | 'PUBLICATION' | 'CLI';
  lookbackDays?: number;
  maxCandidatesPerTopic?: number;
}
