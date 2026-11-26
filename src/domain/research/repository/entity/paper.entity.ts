import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('paper')
@Index('UQ_paper_doi', ['doi'], { unique: true, where: '"doi" IS NOT NULL' })
@Index('UQ_paper_arxiv_id', ['arxivId'], { unique: true, where: '"arxiv_id" IS NOT NULL' })
@Index('UQ_paper_openalex_id', ['openAlexId'], {
  unique: true,
  where: '"open_alex_id" IS NOT NULL',
})
export class PaperEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  authors!: string[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  doi!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  arxivId!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  openAlexId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
