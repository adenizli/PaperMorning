import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/persistence/numeric.transformer';
import type { LlmErrorKind, LlmTask, LlmUsageStatus } from './llm.types';

/**
 * Ledger of every Claude call (successful or not) and the daily budget's source of truth:
 * `cost_usd` is what the call counts against the budget (the reservation until settled).
 */
@Entity('llm_usage')
@Index(['createdAt'])
export class LlmUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  task!: LlmTask;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: LlmUsageStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  errorKind!: LlmErrorKind | null;

  @Column({ type: 'integer', default: 0 })
  inputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  outputTokens!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0, transformer: numericTransformer })
  costUsd!: number;

  /** Worst-case amount reserved before the call (kept for audit after settlement). */
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0, transformer: numericTransformer })
  reservedUsd!: number;

  @Column({ type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
