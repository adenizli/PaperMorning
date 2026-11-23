import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  PublicationCheckpoint,
  PublicationRunStatus,
  PublicationStage,
} from '../../model/publication-run.model';

@Entity('publication_run')
@Index('UQ_publication_run_user_date', ['userId', 'issueDate'], { unique: true })
export class PublicationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'date' })
  issueDate!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: PublicationRunStatus;

  @Column({ type: 'varchar', length: 16 })
  stage!: PublicationStage;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  checkpoint!: PublicationCheckpoint;

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'boolean', default: true })
  retryable!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorKind!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lateAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  issueId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
