import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { KnowledgeLevel, TopicPriority } from '../../model/topic-preference.model';
import { UserEntity } from './user.entity';

@Entity('topic_preference')
@Index('UQ_topic_preference_user_topic', ['userId', 'topicKey'], { unique: true })
export class TopicPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @Column({ type: 'varchar', length: 64 })
  topicKey!: string;

  @Column({ type: 'varchar', length: 16 })
  priority!: TopicPriority;

  @Column({ type: 'varchar', length: 16 })
  knowledgeLevel!: KnowledgeLevel;
}
