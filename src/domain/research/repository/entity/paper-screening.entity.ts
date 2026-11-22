import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../../../common/persistence/numeric.transformer';
import { ScreeningDecision, ScreeningMethod } from '../../model/paper-screening.model';
import { PaperVersionEntity } from './paper-version.entity';

@Entity('paper_screening')
@Index('UQ_paper_screening_criteria', ['paperVersionId', 'topicKey', 'criteriaVersion'], {
  unique: true,
})
@Index(['topicKey', 'decision'])
export class PaperScreeningEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paperVersionId!: string;

  @ManyToOne(() => PaperVersionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_version_id' })
  paperVersion?: PaperVersionEntity;

  @Column({ type: 'varchar', length: 64 })
  topicKey!: string;

  @Column({ type: 'varchar', length: 128 })
  criteriaVersion!: string;

  @Column({ type: 'varchar', length: 16 })
  decision!: ScreeningDecision;

  @Column({ type: 'varchar', length: 16 })
  method!: ScreeningMethod;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  relevanceScore!: number | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  promptVersion!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
