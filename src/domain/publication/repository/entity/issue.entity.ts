import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { IssueContentModel } from '../../model/issue-content.model';
import { IssueStatus } from '../../model/issue.model';

/**
 * One immutable issue per reader and local date. A database trigger (see migration) rejects
 * any change to the frozen content and to the PDF reference once READY.
 */
@Entity('issue')
@Index('UQ_issue_user_date', ['userId', 'issueDate'], { unique: true })
export class IssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Account user id (cross-domain reference; no FK by module boundary). */
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'date' })
  issueDate!: string;

  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: IssueStatus;

  @Column({ type: 'jsonb' })
  content!: IssueContentModel;

  @Column({ type: 'char', length: 64 })
  contentHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pdfStorageKey!: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  pdfSha256!: string | null;

  @Column({ type: 'integer', nullable: true })
  pdfSizeBytes!: number | null;

  /**
   * Exclusive PDF render ownership of a FROZEN issue (one renderer at a time). The PDF columns may
   * hold a staged, verified artifact before READY; once READY the trigger freezes them.
   */
  @Column({ type: 'uuid', nullable: true })
  renderToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  renderLeaseExpiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
