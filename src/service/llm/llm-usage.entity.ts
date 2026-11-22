import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/persistence/numeric.transformer';
import type { LlmErrorKind, LlmTask } from './llm.types';

/** Ledger of every Claude call (successful or not): tokens and estimated cost by task/model. */
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
  status!: 'SUCCEEDED' | 'FAILED';

  @Column({ type: 'varchar', length: 32, nullable: true })
  errorKind!: LlmErrorKind | null;

  @Column({ type: 'integer', default: 0 })
  inputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  outputTokens!: number;

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0, transformer: numericTransformer })
  costUsd!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
