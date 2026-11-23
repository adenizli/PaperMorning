import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../src/config/app.config';
import { AcademicSourceService } from '../../src/service/academic-source/academic-source.service';
import { FILE_STORAGE } from '../../src/service/file-storage/file-storage';
import { ANTHROPIC_CLIENT } from '../../src/service/llm/llm.service';
import { MAIL_TRANSPORT } from '../../src/service/mail/mail-transport';
import { PDF_RENDERER } from '../../src/service/pdf/pdf-renderer';
import type { FakeMailTransport, FakePdfRenderer, InMemoryFileStorage } from './fake-integrations';
import { FakeAnthropic } from './fake-anthropic';
import { createTestApp, truncateAll } from './test-app';
import { testConfig } from './test-config';

export interface ResearchAppOptions {
  anthropic?: FakeAnthropic | null;
  sources?: Pick<AcademicSourceService, 'search'>;
  env?: Record<string, string>;
  pdf?: FakePdfRenderer;
  storage?: InMemoryFileStorage;
  mail?: FakeMailTransport;
  /** Keep existing rows (simulates a process restart). */
  keepData?: boolean;
}

/** Real AppModule + real PostgreSQL, with only network adapters replaced by fakes. */
export async function createResearchApp(
  options: ResearchAppOptions = {},
): Promise<INestApplication> {
  const app = await createTestApp((builder) => {
    builder.overrideProvider(ANTHROPIC_CLIENT).useValue(options.anthropic ?? null);
    if (options.sources) builder.overrideProvider(AcademicSourceService).useValue(options.sources);
    if (options.pdf) builder.overrideProvider(PDF_RENDERER).useValue(options.pdf);
    if (options.storage) builder.overrideProvider(FILE_STORAGE).useValue(options.storage);
    if (options.mail) builder.overrideProvider(MAIL_TRANSPORT).useValue(options.mail);
    if (options.env) builder.overrideProvider(AppConfig).useValue(testConfig(options.env));
    return builder;
  });
  if (!options.keepData) await truncateAll(app.get(DataSource));
  return app;
}
