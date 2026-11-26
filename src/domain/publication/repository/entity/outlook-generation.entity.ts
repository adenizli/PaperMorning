import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GenerationStatus } from '../../model/article-variant.model';
import type { OutlookReportModel } from '../../model/outlook-report.model';

/**
 * Technical claim + cache row for one Ufuk Raporu generation, keyed by the outlook fingerprint
 * (research package + language + level + model + prompt/schema version). Not a domain model:
 * the report itself stays nested in the issue content. The row exists so that (1) only one worker
 * pays for a fingerprint at a time and (2) a finished report survives a later publication failure
 * and is reusable by every reader with the same fingerprint.
 */
@Entity('outlook_generation')
@Index('UQ_outlook_generation_fingerprint', ['fingerprint'], { unique: true })
export class OutlookGenerationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: GenerationStatus;

  @Column({ type: 'jsonb', nullable: true })
  report!: OutlookReportModel | null;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ type: 'varchar', length: 32 })
  promptVersion!: string;

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'boolean', default: true })
  retryable!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  claimToken!: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  errorKind!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
