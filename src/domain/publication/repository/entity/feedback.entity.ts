import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IssueEntity } from './issue.entity';

@Entity('feedback')
@Index('UQ_feedback_user_issue_content', ['userId', 'issueId', 'contentKey'], { unique: true })
export class FeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  issueId!: string;

  @ManyToOne(() => IssueEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'issue_id' })
  issue?: IssueEntity;

  @Column({ type: 'varchar', length: 64 })
  contentKey!: string;

  @Column({ type: 'smallint' })
  value!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
