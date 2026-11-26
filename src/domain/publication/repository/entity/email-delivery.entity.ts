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
import { DeliveryStatus } from '../../model/email-delivery.model';
import { IssueEntity } from './issue.entity';

@Entity('email_delivery')
@Index('UQ_email_delivery_issue_channel', ['issueId', 'channel'], { unique: true })
@Index(['status'])
export class EmailDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  issueId!: string;

  @ManyToOne(() => IssueEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'issue_id' })
  issue?: IssueEntity;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  channel!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: DeliveryStatus;

  @Column({ type: 'varchar', length: 254 })
  recipient!: string;

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'boolean', default: true })
  retryable!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  providerMessageId!: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
