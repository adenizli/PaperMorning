import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ReaderScheduleModel } from '../model/reader-profile.model';
import type { ReaderLanguage, ReaderPreferenceModel } from '../model/reader-preference.model';
import type { TopicPreferenceModel } from '../model/topic-preference.model';
import { ReaderPreferenceEntity } from './entity/reader-preference.entity';
import { TopicPreferenceEntity } from './entity/topic-preference.entity';
import { UserEntity } from './entity/user.entity';

@Injectable()
export class PreferenceRepositoryService {
  constructor(
    @InjectRepository(ReaderPreferenceEntity)
    private readonly readers: Repository<ReaderPreferenceEntity>,
    @InjectRepository(TopicPreferenceEntity)
    private readonly topics: Repository<TopicPreferenceEntity>,
  ) {}

  async findReader(userId: string): Promise<ReaderPreferenceModel | null> {
    const entity = await this.readers.findOneBy({ userId });
    return entity ? toReaderModel(entity) : null;
  }

  async findTopics(userId: string): Promise<TopicPreferenceModel[]> {
    return (await this.topics.find({ where: { userId }, order: { topicKey: 'ASC' } })).map(
      toTopicModel,
    );
  }

  /** Atomically replaces the reader row and every topic row; any failure rolls back all. */
  async replace(reader: ReaderPreferenceModel, topics: TopicPreferenceModel[]): Promise<void> {
    await this.readers.manager.transaction(async (manager) => {
      await manager.upsert(ReaderPreferenceEntity, reader, ['userId']);
      await manager.delete(TopicPreferenceEntity, { userId: reader.userId });
      if (topics.length > 0) await manager.insert(TopicPreferenceEntity, topics);
    });
  }

  /** Every account with its effective timezone/opt-in (defaults when never saved). */
  async listSchedules(defaults: { timezone: string }): Promise<ReaderScheduleModel[]> {
    const rows = await this.readers.manager
      .createQueryBuilder(UserEntity, 'u')
      .leftJoin(ReaderPreferenceEntity, 'r', 'r.user_id = u.id')
      .select('u.id', 'userId')
      .addSelect('COALESCE(r.timezone, :tz)', 'timezone')
      .addSelect('COALESCE(r.daily_email_enabled, false)', 'dailyEmailEnabled')
      .addSelect('(SELECT count(*) FROM topic_preference t WHERE t.user_id = u.id)', 'topicCount')
      .setParameter('tz', defaults.timezone)
      .orderBy('u.created_at', 'ASC')
      .getRawMany<{
        userId: string;
        timezone: string;
        dailyEmailEnabled: boolean;
        topicCount: string;
      }>();
    return rows.map((row) => ({ ...row, topicCount: Number(row.topicCount) }));
  }
}

function toReaderModel(entity: ReaderPreferenceEntity): ReaderPreferenceModel {
  return {
    userId: entity.userId,
    language: entity.language as ReaderLanguage,
    timezone: entity.timezone,
    dailyEmailEnabled: entity.dailyEmailEnabled,
  };
}

function toTopicModel(entity: TopicPreferenceEntity): TopicPreferenceModel {
  return {
    userId: entity.userId,
    topicKey: entity.topicKey,
    priority: entity.priority,
    knowledgeLevel: entity.knowledgeLevel,
  };
}
