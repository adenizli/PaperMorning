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
import { ContentCoverage } from '../../../../common/enum/research.enum';
import { numericTransformer } from '../../../../common/persistence/numeric.transformer';
import {
  AnalysisStatus,
  PaperAnalysisContent,
  SourceReferenceModel,
} from '../../model/paper-analysis.model';
import { PaperVersionEntity } from './paper-version.entity';

/** Shared analysis cache. Deliberately has no user column: analyses belong to paper versions. */
@Entity('paper_analysis')
@Index('UQ_paper_analysis_fingerprint', ['fingerprint'], { unique: true })
@Index(['paperVersionId', 'status'])
export class PaperAnalysisEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paperVersionId!: string;

  @ManyToOne(() => PaperVersionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_version_id' })
  paperVersion?: PaperVersionEntity;

  @Column({ type: 'char', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: AnalysisStatus;

  @Column({ type: 'varchar', length: 16 })
  coverage!: ContentCoverage;

  @Column({ type: 'jsonb', nullable: true })
  content!: PaperAnalysisContent | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sourceReferences!: SourceReferenceModel[];

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ type: 'varchar', length: 32 })
  promptVersion!: string;

  @Column({ type: 'integer' })
  schemaVersion!: number;

  @Column({ type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ type: 'boolean', default: true })
  retryable!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  errorKind!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'integer', default: 0 })
  inputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  outputTokens!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0, transformer: numericTransformer })
  costUsd!: number;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
