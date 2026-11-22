import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AcademicQuery, AcademicSearchResult } from './academic-source.types';
import { ArxivClient } from './arxiv.client';
import { OpenAlexClient } from './openalex.client';

/**
 * Queries every configured academic source. One failing source does not discard results from
 * the others; failures are returned so the caller can record them.
 */
@Injectable()
export class AcademicSourceService {
  private readonly logger = new Logger(AcademicSourceService.name);

  constructor(
    @Inject(OpenAlexClient) private readonly openAlex: OpenAlexClient,
    @Inject(ArxivClient) private readonly arxiv: ArxivClient,
  ) {}

  async search(query: AcademicQuery): Promise<AcademicSearchResult> {
    const result: AcademicSearchResult = { records: [], failures: [] };
    const sources = [
      { name: 'OPENALEX' as const, run: () => this.openAlex.search(query) },
      { name: 'ARXIV' as const, run: () => this.arxiv.search(query) },
    ];
    for (const source of sources) {
      try {
        result.records.push(...(await source.run()));
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(`${source.name} discovery failed: ${message}`);
        result.failures.push({ source: source.name, message });
      }
    }
    return result;
  }
}
