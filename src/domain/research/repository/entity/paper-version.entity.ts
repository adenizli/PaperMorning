import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ContentCoverage, PublicationStatus } from '../../../../common/enum/research.enum';
import { PaperEntity } from './paper.entity';

@Entity('paper_version')
@Index('UQ_paper_version_content', ['paperId', 'publicationStatus', 'contentFingerprint'], {
  unique: true,
})
@Index(['source', 'sourceRecordId'])
@Index(['publishedAt'])
export class PaperVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  paperId!: string;

  @ManyToOne(() => PaperEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paper_id' })
  paper?: PaperEntity;

  @Column({ type: 'varchar', length: 16 })
  source!: 'OPENALEX' | 'ARXIV';

  @Column({ type: 'varchar', length: 64 })
  sourceRecordId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  versionLabel!: string | null;

  @Column({ type: 'varchar', length: 16 })
  publicationStatus!: PublicationStatus;

  @Column({ type: 'date' })
  publishedAt!: string;

  @Column({ type: 'timestamptz', nullable: true })
  sourceUpdatedAt!: Date | null;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  abstract!: string | null;

  @Column({ type: 'varchar', length: 16 })
  contentCoverage!: ContentCoverage;

  @Column({ type: 'text', nullable: true })
  venue!: string | null;

  @Column({ type: 'text' })
  landingUrl!: string;

  @Column({ type: 'text', nullable: true })
  pdfUrl!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  categories!: string[];

  @Column({ type: 'char', length: 64 })
  contentFingerprint!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
