import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ResearchRunCounts,
  ResearchRunStage,
  ResearchRunStatus,
} from '../../model/research-run.model';

@Entity('research_run')
@Index('UQ_research_run_key', ['runKey'], { unique: true })
export class ResearchRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  runKey!: string;

  @Column({ type: 'varchar', length: 16 })
  trigger!: string;

  @Column({ type: 'varchar', length: 64 })
  topicKey!: string;

  @Column({ type: 'date' })
  windowFrom!: string;

  @Column({ type: 'date' })
  windowUntil!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: ResearchRunStatus;

  @Column({ type: 'varchar', length: 16 })
  stage!: ResearchRunStage;

  @Column({ type: 'jsonb' })
  counts!: ResearchRunCounts;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  discoveredVersionIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  candidateVersionIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  errors!: string[];

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  /** Fencing token of the current claim; every state change must present it. */
  @Column({ type: 'uuid', nullable: true })
  claimToken!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
