import { BadRequestException, Injectable } from '@nestjs/common';
import { isSupportedTopicKey } from '../../../common/topic/topic-catalog';
import type { UpdatePreferencesInput } from '../model/crud/update-preferences.input';
import type { ReaderProfileModel, ReaderScheduleModel } from '../model/reader-profile.model';
import {
  DEFAULT_TIMEZONE,
  defaultReaderPreference,
  isValidIanaTimezone,
  SUPPORTED_LANGUAGES,
} from '../model/reader-preference.model';
import {
  KnowledgeLevel,
  TopicPreferenceModel,
  TopicPriority,
} from '../model/topic-preference.model';
import { PreferenceRepositoryService } from '../repository/preference-repository.service';

/**
 * Reader settings. Every method is scoped by a userId supplied by trusted callers (the auth
 * guard or another domain service), never by a client-provided id.
 */
@Injectable()
export class PreferenceService {
  constructor(private readonly preferences: PreferenceRepositoryService) {}

  /** Public API for Publication: effective settings with product defaults applied. */
  async getForUser(userId: string): Promise<ReaderProfileModel> {
    const [reader, topics] = await Promise.all([
      this.preferences.findReader(userId),
      this.preferences.findTopics(userId),
    ]);
    return { reader: reader ?? defaultReaderPreference(userId), topics };
  }

  async replaceForUser(userId: string, input: UpdatePreferencesInput): Promise<ReaderProfileModel> {
    const problems: string[] = [];
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(input.language)) {
      problems.push('language is not supported');
    }
    if (!isValidIanaTimezone(input.timezone))
      problems.push('timezone must be a valid IANA timezone');
    const seen = new Set<string>();
    for (const topic of input.topics) {
      if (!isSupportedTopicKey(topic.topicKey))
        problems.push(`unsupported topic ${topic.topicKey}`);
      if (seen.has(topic.topicKey)) problems.push(`duplicate topic ${topic.topicKey}`);
      if (!Object.values(TopicPriority).includes(topic.priority)) problems.push('invalid priority');
      if (!Object.values(KnowledgeLevel).includes(topic.knowledgeLevel)) {
        problems.push('invalid knowledgeLevel');
      }
      seen.add(topic.topicKey);
    }
    if (problems.length > 0) throw new BadRequestException(problems);

    const topics: TopicPreferenceModel[] = input.topics.map((topic) => ({
      userId,
      topicKey: topic.topicKey,
      priority: topic.priority,
      knowledgeLevel: topic.knowledgeLevel,
    }));
    await this.preferences.replace(
      {
        userId,
        language: input.language,
        timezone: input.timezone,
        dailyEmailEnabled: input.dailyEmailEnabled,
      },
      topics,
    );
    return this.getForUser(userId);
  }

  /** Public API for the scheduler: every reader's timezone, opt-in and topic count. */
  listReaderSchedules(): Promise<ReaderScheduleModel[]> {
    return this.preferences.listSchedules({ timezone: DEFAULT_TIMEZONE });
  }
}
