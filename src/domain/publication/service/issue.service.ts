import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ContentCoverage, PublicationStatus } from '../../../common/enum/research.enum';
import { ClaimLostError } from '../../../common/persistence/claim-lost.error';
import { fingerprint, sha256Hex } from '../../../common/text/fingerprint';
import { safeHttpUrl } from '../../../common/text/escape-html';
import { findTopic } from '../../../common/topic/topic-catalog';
import { FILE_STORAGE, FileStorage } from '../../../service/file-storage/file-storage';
import { PDF_RENDERER, PdfRenderer } from '../../../service/pdf/pdf-renderer';
import type { ResearchPaperView } from '../../research';
import type { ArticleVariantModel } from '../model/article-variant.model';
import type { FeedbackModel, FeedbackValue } from '../model/feedback.model';
import {
  ISSUE_CONTENT_SCHEMA_VERSION,
  IssueArticle,
  IssueContentModel,
  OUTLOOK_CONTENT_KEY,
} from '../model/issue-content.model';
import { IssueModel, IssueStatus, IssueSummary } from '../model/issue.model';
import type { OutlookReportModel } from '../model/outlook-report.model';
import type { SelectedArticle } from '../model/publication-run.model';
import { FeedbackRepositoryService } from '../repository/feedback-repository.service';
import { IssueRepositoryService } from '../repository/issue-repository.service';
import { PublicationError } from './publication-error';

/** Render ownership lease; far above the renderer's own timeout plus storage verification. */
export const RENDER_LEASE_SECONDS = 300;

interface StagedPdf {
  key: string;
  sha256: string;
  sizeBytes: number;
  /** Already recorded on the issue by an earlier (interrupted) attempt. */
  staged: boolean;
}

export const PUBLICATION_NAME = 'PaperMorning';

export interface ComposedArticle {
  selection: SelectedArticle;
  view: ResearchPaperView;
  variant: ArticleVariantModel;
}

/**
 * Builds the canonical snapshot, freezes it once per reader/date, renders the PDF from that same
 * frozen object, stores it privately and only then marks the issue READY. Also serves owned reads
 * and feedback.
 */
@Injectable()
export class IssueService {
  constructor(
    private readonly issues: IssueRepositoryService,
    private readonly feedback: FeedbackRepositoryService,
    @Inject(PDF_RENDERER) private readonly pdfRenderer: PdfRenderer,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  buildContent(params: {
    issueDate: string;
    issueNumber: number;
    language: string;
    articles: ComposedArticle[];
    outlook: OutlookReportModel;
    generatedAt: Date;
  }): IssueContentModel {
    const articles: IssueArticle[] = params.articles.map(({ selection, view, variant }, index) => {
      const article = variant.content!;
      return {
        key: `a${index + 1}`,
        paperKey: `P${index + 1}`,
        role: selection.role,
        topicKey: selection.topicKey,
        topicLabel: findTopic(selection.topicKey)?.labelTr ?? selection.topicKey,
        priority: selection.priority,
        knowledgeLevel: selection.knowledgeLevel,
        headline: article.headline,
        dek: article.dek,
        whyItMatters: article.whyItMatters,
        sections: article.sections,
        glossary: article.glossary,
        source: {
          title: view.title,
          authors: view.authors,
          publishedAt: view.publishedAt,
          venue: view.venue,
          publicationStatus: view.publicationStatus,
          coverage: view.coverage,
          references: view.sourceReferences,
        },
        provenance: {
          analysisId: view.analysisId,
          variantId: variant.id,
          paperId: view.paperId,
          paperVersionId: view.paperVersionId,
        },
      };
    });
    const cover = articles[0];
    const topicLabels = [...new Set(articles.map((a) => a.topicLabel))];
    const notes = [
      "Ufuk Raporu'ndaki yorum ve öneriler PaperMorning'in çıkarımıdır; kaynakların gösterdiği bulgulardan ayrı etiketlenmiştir.",
    ];
    if (articles.some((a) => a.source.coverage === ContentCoverage.ABSTRACT_ONLY)) {
      notes.unshift(
        'Bu sayıdaki analizler yalnızca makale özetlerine ve yayın bilgilerine dayanır; tam metinler incelenmedi.',
      );
    }
    if (articles.some((a) => a.source.publicationStatus === PublicationStatus.PREPRINT)) {
      notes.unshift(
        'Ön baskı (preprint) olarak işaretlenen çalışmalar henüz hakem değerlendirmesinden geçmemiştir.',
      );
    }

    const content: IssueContentModel = {
      schemaVersion: ISSUE_CONTENT_SCHEMA_VERSION,
      publicationName: PUBLICATION_NAME,
      issueDate: params.issueDate,
      issueNumber: params.issueNumber,
      language: params.language,
      generatedAt: params.generatedAt.toISOString(),
      cover: { headline: cover.headline, dek: cover.dek, articleKey: cover.key },
      intro: `Bu sayıda ${articles.length} araştırma var (${topicLabels.join(', ')}). Kapak dosyası: “${cover.headline}”. Sayı, çalışmaları birlikte değerlendiren Ufuk Raporu ile kapanıyor.`,
      toc: [
        ...articles.map((a) => ({ key: a.key, title: a.headline, kind: 'ARTICLE' as const })),
        { key: OUTLOOK_CONTENT_KEY, title: params.outlook.title, kind: 'OUTLOOK' as const },
      ],
      articles,
      outlook: params.outlook,
      editorialNotes: notes,
    };
    validateIssueContent(content);
    return content;
  }

  /**
   * Freezes the snapshot (first writer wins) and publishes its PDF exactly once:
   * - one renderer at a time per issue (render claim with fencing token);
   * - content-addressed storage keys (`issues/<user>/<issue>-<sha256>.pdf`), so no writer can ever
   *   replace the bytes behind a recorded checksum, even a stale one;
   * - a verified, stored PDF is staged on the FROZEN issue before READY, so a retry after a crash
   *   reuses it instead of rendering again;
   * - READY only after durable write + read-back verification, by the current render owner.
   */
  async publish(
    params: { userId: string; issueDate: string; timezone: string; content: IssueContentModel },
    options: { waitMs?: number; pollMs?: number } = {},
  ): Promise<IssueModel> {
    const { issue } = await this.issues.freeze({
      userId: params.userId,
      issueDate: params.issueDate,
      timezone: params.timezone,
      language: params.content.language,
      content: params.content,
      contentHash: fingerprint(params.content),
    });
    if (issue.status === IssueStatus.READY) return issue;

    const renderToken = await this.issues.claimRender(issue.id, RENDER_LEASE_SECONDS);
    if (!renderToken) return this.awaitOtherRenderer(issue.id, options);
    try {
      const pdf = (await this.reuseStagedPdf(issue)) ?? (await this.renderAndStore(issue));
      if (!pdf.staged) await this.issues.stagePdf(issue.id, renderToken, pdf);
      return await this.issues.markReady(issue.id, renderToken);
    } catch (error) {
      // A newer render owner took over (our lease expired): its result is authoritative.
      if (error instanceof ClaimLostError) return this.awaitOtherRenderer(issue.id, options);
      await this.issues.releaseRender(issue.id, renderToken);
      throw error;
    }
  }

  /** A stored, still-intact PDF from an interrupted earlier attempt. */
  private async reuseStagedPdf(issue: IssueModel): Promise<StagedPdf | null> {
    if (!issue.pdfStorageKey || !issue.pdfSha256 || issue.pdfSizeBytes === null) return null;
    try {
      const bytes = await this.storage.read(issue.pdfStorageKey);
      if (sha256Hex(bytes) !== issue.pdfSha256 || bytes.length !== issue.pdfSizeBytes) return null;
      assertPdf(bytes);
      return {
        key: issue.pdfStorageKey,
        sha256: issue.pdfSha256,
        sizeBytes: bytes.length,
        staged: true,
      };
    } catch {
      return null;
    }
  }

  /** Always renders the FROZEN snapshot (the one the web API serves), never a fresh candidate. */
  private async renderAndStore(issue: IssueModel): Promise<StagedPdf> {
    let pdf: Buffer;
    try {
      pdf = await this.pdfRenderer.render(issue.content);
    } catch (error) {
      throw new PublicationError('PDF_RENDER_FAILED', (error as Error).message, true);
    }
    assertPdf(pdf);

    const sha256 = sha256Hex(pdf);
    const key = `issues/${issue.userId}/${issue.id}-${sha256}.pdf`;
    try {
      const stored = await this.storage.write(key, pdf);
      if (stored.sha256 !== sha256 || stored.sizeBytes !== pdf.length) {
        throw new Error('stored PDF does not match rendered bytes');
      }
      const readBack = await this.storage.read(key);
      if (sha256Hex(readBack) !== sha256)
        throw new Error('stored PDF failed read-back verification');
      return { key, sha256, sizeBytes: pdf.length, staged: false };
    } catch (error) {
      throw new PublicationError('PDF_STORAGE_FAILED', (error as Error).message, true);
    }
  }

  /** Another worker is rendering this issue: wait briefly for its READY result. */
  private async awaitOtherRenderer(
    issueId: string,
    { waitMs = 30_000, pollMs = 500 }: { waitMs?: number; pollMs?: number },
  ): Promise<IssueModel> {
    const deadline = Date.now() + waitMs;
    for (let first = true; first || Date.now() < deadline; first = false) {
      if (!first) await new Promise((resolve) => setTimeout(resolve, pollMs));
      const current = await this.issues.findById(issueId);
      if (current?.status === IssueStatus.READY) return current;
    }
    throw new PublicationError(
      'PDF_RENDER_IN_PROGRESS',
      'The PDF of this issue is being rendered by another worker',
      true,
    );
  }

  nextIssueNumber(userId: string): Promise<number> {
    return this.issues.countForUser(userId).then((count) => count + 1);
  }

  findByUserDate(userId: string, issueDate: string): Promise<IssueModel | null> {
    return this.issues.findByUserDate(userId, issueDate);
  }

  listUsedPaperIds(userId: string, beforeDate: string): Promise<string[]> {
    return this.issues.listUsedPaperIds(userId, beforeDate);
  }

  listForUser(userId: string): Promise<IssueSummary[]> {
    return this.issues.listReady(userId);
  }

  /** Owned READY issue or 404 (another reader's issue is indistinguishable from a missing one). */
  async getForUser(
    userId: string,
    issueId: string,
  ): Promise<{ issue: IssueModel; feedback: Record<string, FeedbackValue> }> {
    const issue = await this.requireOwnedReady(userId, issueId);
    const votes = await this.feedback.listForIssue(userId, issueId);
    return { issue, feedback: Object.fromEntries(votes.map((v) => [v.contentKey, v.value])) };
  }

  async getPdfForUser(
    userId: string,
    issueId: string,
  ): Promise<{ bytes: Buffer; filename: string }> {
    const issue = await this.requireOwnedReady(userId, issueId);
    return {
      bytes: await this.readVerifiedPdf(issue),
      filename: `PaperMorning-${issue.issueDate}.pdf`,
    };
  }

  /** Reads the stored PDF and verifies it is the exact file recorded for this issue. */
  async readVerifiedPdf(issue: IssueModel): Promise<Buffer> {
    if (issue.status !== IssueStatus.READY || !issue.pdfStorageKey || !issue.pdfSha256) {
      throw new PublicationError('PDF_MISSING', 'Issue has no stored PDF', false);
    }
    const bytes = await this.storage.read(issue.pdfStorageKey);
    if (sha256Hex(bytes) !== issue.pdfSha256 || bytes.length !== issue.pdfSizeBytes) {
      throw new PublicationError(
        'PDF_INTEGRITY',
        'Stored PDF does not match the published checksum',
        false,
      );
    }
    assertPdf(bytes);
    return bytes;
  }

  async setFeedback(
    userId: string,
    issueId: string,
    contentKey: string,
    value: FeedbackValue,
  ): Promise<FeedbackModel> {
    const issue = await this.requireOwnedReady(userId, issueId);
    const keys = new Set([...issue.content.articles.map((a) => a.key), OUTLOOK_CONTENT_KEY]);
    if (!keys.has(contentKey))
      throw new BadRequestException(`Unknown content key for this issue: ${contentKey}`);
    return this.feedback.upsert(userId, issueId, contentKey, value);
  }

  private async requireOwnedReady(userId: string, issueId: string): Promise<IssueModel> {
    const issue = await this.issues.findOwned(userId, issueId);
    if (!issue || issue.status !== IssueStatus.READY)
      throw new NotFoundException('Issue not found');
    return issue;
  }
}

export function assertPdf(bytes: Buffer): void {
  const header = bytes.subarray(0, 5).toString('latin1');
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  if (header !== '%PDF-' || !tail.includes('%%EOF')) {
    throw new PublicationError(
      'PDF_INVALID',
      'Renderer output is not a complete PDF document',
      true,
    );
  }
}

/** Structural checks before anything is frozen. */
export function validateIssueContent(content: IssueContentModel): void {
  const problems: string[] = [];
  if (content.articles.length === 0) problems.push('issue has no articles');
  const keys = content.articles.map((a) => a.key);
  if (new Set(keys).size !== keys.length) problems.push('duplicate article keys');
  for (const article of content.articles) {
    if (!article.source.references.some((ref) => safeHttpUrl(ref.url))) {
      problems.push(`article ${article.key} has no valid source link`);
    }
  }
  const last = content.toc[content.toc.length - 1];
  if (!last || last.kind !== 'OUTLOOK' || last.key !== OUTLOOK_CONTENT_KEY)
    problems.push('Ufuk Raporu must be the last section');
  const paperKeys = new Set(content.articles.map((a) => a.paperKey));
  const cited = [
    content.outlook.synthesis,
    ...content.outlook.evidence,
    ...content.outlook.inferences,
    ...content.outlook.academicOpportunities,
    ...content.outlook.industryOpportunities,
  ].flatMap((item) => item.paperKeys);
  const unknown = cited.filter((key) => !paperKeys.has(key));
  if (unknown.length > 0)
    problems.push(
      `Ufuk Raporu cites papers not in this issue: ${[...new Set(unknown)].join(', ')}`,
    );
  if (problems.length > 0)
    throw new PublicationError('INVALID_SNAPSHOT', problems.join('; '), false);
}
