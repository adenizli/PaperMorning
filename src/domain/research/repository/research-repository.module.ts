import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaperAnalysisEntity } from './entity/paper-analysis.entity';
import { PaperScreeningEntity } from './entity/paper-screening.entity';
import { PaperVersionEntity } from './entity/paper-version.entity';
import { PaperEntity } from './entity/paper.entity';
import { ResearchRunEntity } from './entity/research-run.entity';
import { PaperAnalysisRepositoryService } from './paper-analysis-repository.service';
import { PaperRepositoryService } from './paper-repository.service';
import { PaperScreeningRepositoryService } from './paper-screening-repository.service';
import { PaperVersionRepositoryService } from './paper-version-repository.service';
import { ResearchRunRepositoryService } from './research-run-repository.service';

const repositories = [
  PaperRepositoryService,
  PaperVersionRepositoryService,
  PaperScreeningRepositoryService,
  PaperAnalysisRepositoryService,
  ResearchRunRepositoryService,
];

/** Research-owned persistence. Not exported outside the Research domain module. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaperEntity,
      PaperVersionEntity,
      PaperScreeningEntity,
      PaperAnalysisEntity,
      ResearchRunEntity,
    ]),
  ],
  providers: repositories,
  exports: repositories,
})
export class ResearchRepositoryModule {}
