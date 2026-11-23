import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IssueModel, IssueStatus, IssueSummary } from '../model/issue.model';
import type { OutlookReportModel } from '../model/outlook-report.model';
import { IssueEntity } from './entity/issue.entity';

export type NewIssue = Pick<
  IssueModel,
  'userId' | 'issueDate' | 'timezone' | 'language' | 'content' | 'contentHash'
>;

@Injectable()
export class IssueRepositoryService {
  constructor(@InjectRepository(IssueEntity) private readonly repo: Repository<IssueEntity>) {}

  /**
   * Freezes a snapshot. If an issue already exists for (user, date) the existing, immutable
   * snapshot is returned unchanged; the new candidate content is discarded.
   */
  async freeze(data: NewIssue): Promise<{ issue: IssueModel; created: boolean }> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...data, status: IssueStatus.FROZEN })
      .orIgnore()
      .returning(['id'])
      .execute();
    const issue = await this.repo.findOneByOrFail({
      userId: data.userId,
      issueDate: data.issueDate,
    });
    return { issue: toModel(issue), created: (result.raw as unknown[]).length > 0 };
  }

  /** FROZEN -> READY exactly once; the trigger forbids changing a READY issue's PDF. */
  async markReady(
    id: string,
    pdf: { key: string; sha256: string; sizeBytes: number },
  ): Promise<IssueModel> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: IssueStatus.READY,
        pdfStorageKey: pdf.key,
        pdfSha256: pdf.sha256,
        pdfSizeBytes: pdf.sizeBytes,
        publishedAt: () => 'now()',
      })
      .where('id = :id AND status = :frozen', { id, frozen: IssueStatus.FROZEN })
      .execute();
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async findById(id: string): Promise<IssueModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  async findOwned(userId: string, id: string): Promise<IssueModel | null> {
    const entity = await this.repo.findOneBy({ id, userId });
    return entity ? toModel(entity) : null;
  }

  async findByUserDate(userId: string, issueDate: string): Promise<IssueModel | null> {
    const entity = await this.repo.findOneBy({ userId, issueDate });
    return entity ? toModel(entity) : null;
  }

  async listReady(userId: string): Promise<IssueSummary[]> {
    const entities = await this.repo.find({
      where: { userId, status: IssueStatus.READY },
      order: { issueDate: 'DESC' },
    });
    return entities.map((e) => ({
      id: e.id,
      issueDate: e.issueDate,
      issueNumber: e.content.issueNumber,
      status: e.status,
      coverHeadline: e.content.cover.headline,
      articleCount: e.content.articles.length,
      publishedAt: e.publishedAt,
    }));
  }

  countForUser(userId: string): Promise<number> {
    return this.repo.countBy({ userId });
  }

  /** Papers already published to this reader before the given date (avoid repetition). */
  async listUsedPaperIds(userId: string, beforeDate: string): Promise<string[]> {
    const rows: { paper_id: string }[] = await this.repo.query(
      `SELECT DISTINCT a->'provenance'->>'paperId' AS paper_id
         FROM issue i, jsonb_array_elements(i.content->'articles') a
        WHERE i.user_id = $1 AND i.issue_date < $2`,
      [userId, beforeDate],
    );
    return rows.map((r) => r.paper_id);
  }

  /** Reuse a closing report already generated for the same research package and level. */
  async findOutlookByFingerprint(fingerprint: string): Promise<OutlookReportModel | null> {
    const rows: { outlook: OutlookReportModel }[] = await this.repo.query(
      `SELECT content->'outlook' AS outlook FROM issue
        WHERE content->'outlook'->>'fingerprint' = $1 LIMIT 1`,
      [fingerprint],
    );
    return rows[0]?.outlook ?? null;
  }
}

function toModel(e: IssueEntity): IssueModel {
  return {
    id: e.id,
    userId: e.userId,
    issueDate: e.issueDate,
    timezone: e.timezone,
    language: e.language,
    status: e.status,
    content: e.content,
    contentHash: e.contentHash,
    pdfStorageKey: e.pdfStorageKey,
    pdfSha256: e.pdfSha256,
    pdfSizeBytes: e.pdfSizeBytes,
    createdAt: e.createdAt,
    publishedAt: e.publishedAt,
  };
}
