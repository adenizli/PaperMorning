import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_TOPIC_KEYS } from '../../../../common/topic/topic-catalog';
import { SUPPORTED_LANGUAGES, type ReaderLanguage } from '../reader-preference.model';
import { KnowledgeLevel, TopicPriority } from '../topic-preference.model';

export class TopicPreferenceInput {
  @IsIn(SUPPORTED_TOPIC_KEYS as string[], { message: 'topicKey must be a supported topic' })
  topicKey!: string;

  @IsEnum(TopicPriority)
  priority!: TopicPriority;

  @IsEnum(KnowledgeLevel)
  knowledgeLevel!: KnowledgeLevel;
}

/** Full replacement of the reader's settings (PUT semantics). */
export class UpdatePreferencesInput {
  @IsIn(SUPPORTED_LANGUAGES as readonly string[])
  language!: ReaderLanguage;

  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsBoolean()
  dailyEmailEnabled!: boolean;

  @IsArray()
  @ArrayMaxSize(SUPPORTED_TOPIC_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => TopicPreferenceInput)
  topics!: TopicPreferenceInput[];
}
