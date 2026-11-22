import { Injectable, Logger } from '@nestjs/common';
import { ContentCoverage } from '../../../common/enum/research.enum';
import { sha256Hex } from '../../../common/text/fingerprint';
import type { TopicDefinition } from '../../../common/topic/topic-catalog';
import { AcademicSourceService } from '../../../service/academic-source/academic-source.service';
import type { AcademicRecord } from '../../../service/academic-source/academic-source.types';
import type { PaperModel } from '../model/paper.model';
import type { PaperVersionModel } from '../model/paper-version.model';
import { PaperIdentifiers, PaperRepositoryService } from '../repository/paper-repository.service';
import { PaperVersionRepositoryService } from '../repository/paper-version-repository.service';

export interface DiscoveryResult {
  versionIds: string[];
  discovered: number;
  newVersions: number;
  failures: string[];
  allSourcesFailed: boolean;
}

/**
 * Deterministic discovery: query sources, normalize, deduplicate on verified identifiers only,
 * and persist each distinct revision once. No LLM involvement.
 */
@Injectable()
export class ResearchDiscoveryService {
  private readonly logger = new Logger(ResearchDiscoveryService.name);

  constructor(
    private readonly sources: AcademicSourceService,
    private readonly papers: PaperRepositoryService,
    private readonly versions: PaperVersionRepositoryService,
  ) {}

  async discover(
    topic: TopicDefinition,
    window: { from: string; until: string },
    limitPerSource: number,
  ): Promise<DiscoveryResult> {
    const search = await this.sources.search({
      keywords: topic.keywords,
      arxivCategories: topic.arxivCategories,
      from: window.from,
      until: window.until,
      limit: limitPerSource,
    });
    // arXiv first: its records carry version labels and verified journal DOI links.
    const records = [...search.records].sort(
      (a, b) => Number(a.source !== 'ARXIV') - Number(b.source !== 'ARXIV'),
    );

    const versionIds = new Set<string>();
    let newVersions = 0;
    for (const record of records) {
      const { version, created } = await this.storeRecord(record);
      versionIds.add(version.id);
      if (created) newVersions++;
    }
    const sourceCount = topic.arxivCategories.length > 0 ? 2 : 1;
    return {
      versionIds: [...versionIds],
      discovered: records.length,
      newVersions,
      failures: search.failures.map((f) => `${f.source}: ${f.message}`),
      allSourcesFailed: search.failures.length >= sourceCount && records.length === 0,
    };
  }

  /** Persists one normalized record; the same revision seen again maps to the existing row. */
  async storeRecord(
    record: AcademicRecord,
  ): Promise<{ version: PaperVersionModel; created: boolean }> {
    const paper = await this.resolvePaper(record);
    return this.versions.insertIfAbsent({
      paperId: paper.id,
      source: record.source,
      sourceRecordId: record.sourceRecordId,
      versionLabel: record.versionLabel,
      publicationStatus: record.publicationStatus,
      publishedAt: record.publishedAt,
      sourceUpdatedAt: record.sourceUpdatedAt,
      title: record.title,
      abstract: record.abstract,
      // MVP never retrieves full text; FULL_TEXT is reserved for permitted, actually-read text.
      contentCoverage: ContentCoverage.ABSTRACT_ONLY,
      venue: record.venue,
      landingUrl: record.landingUrl,
      pdfUrl: record.pdfUrl,
      categories: record.categories,
      contentFingerprint: contentFingerprintOf(record.title, record.abstract),
    });
  }

  private async resolvePaper(record: AcademicRecord): Promise<PaperModel> {
    const ids: PaperIdentifiers = {
      doi: record.doi,
      arxivId: record.arxivId,
      openAlexId: record.openAlexId,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const matches = await this.papers.findByAnyIdentifier(ids);
      if (matches.length > 0) {
        const paper = pickMatch(matches, ids);
        if (matches.length > 1) {
          this.logger.warn(
            `Record ${record.source}:${record.sourceRecordId} matches ${matches.length} papers; linked to ${paper.id} without merging`,
          );
        }
        await this.papers.fillMissingIdentifiers(paper.id, ids);
        return paper;
      }
      const inserted = await this.papers.tryInsert({
        title: record.title,
        authors: record.authors,
        ...ids,
      });
      if (inserted) return inserted;
    }
    throw new Error(
      `Could not resolve paper identity for ${record.source}:${record.sourceRecordId}`,
    );
  }
}

/** Prefer the strongest identifier: arXiv ID, then DOI, then OpenAlex ID. */
function pickMatch(matches: PaperModel[], ids: PaperIdentifiers): PaperModel {
  return (
    matches.find((p) => ids.arxivId && p.arxivId === ids.arxivId) ??
    matches.find((p) => ids.doi && p.doi === ids.doi) ??
    matches[0]
  );
}

/** Content identity of a revision, insensitive to whitespace, case and punctuation noise. */
export function contentFingerprintOf(title: string, abstract: string | null): string {
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return sha256Hex(`${normalize(title)}\n${normalize(abstract ?? '')}`);
}
