import { Module } from '@nestjs/common';
import { AcademicSourceModule } from '../../service/academic-source/academic-source.module';
import { LlmModule } from '../../service/llm/llm.module';
import { ResearchRepositoryModule } from './repository/research-repository.module';
import { PaperAnalysisService } from './service/paper-analysis.service';
import { PaperScreeningService } from './service/paper-screening.service';
import { ResearchDiscoveryService } from './service/research-discovery.service';
import { ResearchQueryService } from './service/research-query.service';
import { ResearchService } from './service/research.service';

/** Shared, user-independent research pool. Exports only its public services. */
@Module({
  imports: [ResearchRepositoryModule, AcademicSourceModule, LlmModule],
  providers: [
    ResearchService,
    ResearchDiscoveryService,
    PaperScreeningService,
    PaperAnalysisService,
    ResearchQueryService,
  ],
  exports: [ResearchService, ResearchQueryService],
})
export class ResearchModule {}
