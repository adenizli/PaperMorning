import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
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

  /**
   * Exclusive render ownership of a FROZEN issue: succeeds for one caller at a time (or after the
   * previous owner's lease expired) and returns its fencing token; null when someone else holds it
   * or the issue is no longer FROZEN.
   */
  async claimRender(id: string, leaseSeconds: number): Promise<string | null> {
    const rows: { render_token: string }[] = await this.repo.query(
      `WITH claimed AS (
         UPDATE issue
            SET render_token = gen_random_uuid(),
                render_lease_expires_at = now() + make_interval(secs => $2)
          WHERE id = $1 AND status = 'FROZEN'
            AND (render_token IS NULL OR render_lease_expires_at < now())
          RETURNING render_token)
       SELECT render_token FROM claimed`,
      [id, leaseSeconds],
    );
    return rows[0]?.render_token ?? null;
  }

  /**
   * Records a durably stored, verified PDF on the still-FROZEN issue (fenced by the render token),
   * so a retry after a crash can reuse it instead of rendering again.
   */
  async stagePdf(
    id: string,
    renderToken: string,
    pdf: { key: string; sha256: string; sizeBytes: number },
  ): Promise<void> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({ pdfStorageKey: pdf.key, pdfSha256: pdf.sha256, pdfSizeBytes: pdf.sizeBytes })
      .where('id = :id AND status = :frozen AND render_token = :renderToken', {
        id,
        renderToken,
        frozen: IssueStatus.FROZEN,
      })
      .execute();
    if (!result.affected) throw new ClaimLostError(`Issue ${id} render`);
  }

  /**
   * FROZEN -> READY exactly once, only by the current render owner and only with a staged PDF.
   * From then on the trigger forbids any change of the PDF reference.
   */
  async markReady(id: string, renderToken: string): Promise<IssueModel> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        status: IssueStatus.READY,
        publishedAt: () => 'now()',
        renderToken: null,
        renderLeaseExpiresAt: null,
      })
      .where(
        'id = :id AND status = :frozen AND render_token = :renderToken AND pdf_sha256 IS NOT NULL',
        { id, renderToken, frozen: IssueStatus.FROZEN },
      )
      .execute();
    if (!result.affected) throw new ClaimLostError(`Issue ${id} render`);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  /** Gives up render ownership after a failure so a retry need not wait for the lease. */
  async releaseRender(id: string, renderToken: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ renderToken: null, renderLeaseExpiresAt: null })
      .where('id = :id AND render_token = :renderToken', { id, renderToken })
      .execute();
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
