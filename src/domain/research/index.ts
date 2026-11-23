/**
 * Public Research API. Example (from another domain service):
 *
 *   constructor(private readonly research: ResearchService, private readonly query: ResearchQueryService) {}
 *   await this.research.ensureDailyResearch({ topicKeys: ['robotics'], runDate: '2026-11-24', trigger: 'PUBLICATION' });
 *   const papers = await this.query.listAnalyzedPapers({ topicKeys: ['robotics'], publishedFrom: '2026-11-17' });
 */
export { ResearchModule } from './research.module';
export { ResearchService } from './service/research.service';
export { ResearchQueryService } from './service/research-query.service';
export type { ResearchPaperView, ResearchQuery } from './model/research-paper-view.model';
export type { DailyResearchRequest } from './model/research-request.model';
export { ResearchRunStatus } from './model/research-run.model';
export type { ResearchRunModel } from './model/research-run.model';
export type {
  PaperAnalysisContent,
  ResearchEvidenceModel,
  SourceReferenceModel,
} from './model/paper-analysis.model';
export type { PaperModel } from './model/paper.model';
