import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { AcademicSourceService } from './academic-source.service';
import { ArxivClient } from './arxiv.client';
import { OpenAlexClient } from './openalex.client';

const httpOptions = (config: AppConfig) => ({
  timeoutMs: config.research.sourceTimeoutMs,
  retries: 2,
  backoffMs: 1_000,
  headers: { 'User-Agent': 'PaperMorning (self-hosted research digest)' },
});

@Module({
  providers: [
    {
      provide: OpenAlexClient,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new OpenAlexClient(fetch, httpOptions(config), config.research.openAlexMailto),
    },
    {
      provide: ArxivClient,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => new ArxivClient(fetch, httpOptions(config)),
    },
    AcademicSourceService,
  ],
  exports: [AcademicSourceService],
})
export class AcademicSourceModule {}
