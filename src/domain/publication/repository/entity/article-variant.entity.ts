import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContentCoverage, PublicationStatus } from '../../../../common/enum/research.enum';
import { numericTransformer } from '../../../../common/persistence/numeric.transformer';
import type { KnowledgeLevel } from '../../../account';
import type { SourceReferenceModel } from '../../../research';
import { ArticleContent, GenerationStatus } from '../../model/article-variant.model';

/** Shared narration cache. No user column: variants are reused across readers. */
@Entity('article_variant')
@Index('UQ_article_variant_fingerprint', ['generationFingerprint'], { unique: true })
@Index(['analysisId'])
export class ArticleVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Research analysis id (cross-domain reference; no FK by module boundary). */
  @Column({ type: 'uuid' })
  analysisId!: string;

  @Column({ type: 'char', length: 64 })
  analysisFingerprint!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 16 })
  knowledgeLevel!: KnowledgeLevel;

  @Column({ type: 'char', length: 64 })
  generationFingerprint!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: GenerationStatus;

  @Column({ type: 'jsonb', nullable: true })
  content!: ArticleContent | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  sourceReferences!: SourceReferenceModel[];

  @Column({ type: 'varchar', length: 16 })
  coverage!: ContentCoverage;

  @Column({ type: 'varchar', length: 16 })
  publicationStatus!: PublicationStatus;

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

  /** Fencing token of the current claim; completion and failure must present it. */
  @Column({ type: 'uuid', nullable: true })
  claimToken!: string | null;

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
