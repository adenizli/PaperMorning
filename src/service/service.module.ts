import { Module } from '@nestjs/common';
import { AcademicSourceModule } from './academic-source/academic-source.module';
import { LlmModule } from './llm/llm.module';
import { PersistenceModule } from './persistence/persistence.module';

/** Integration adapters: persistence, academic sources, Claude. */
@Module({
  imports: [PersistenceModule, AcademicSourceModule, LlmModule],
  exports: [PersistenceModule, AcademicSourceModule, LlmModule],
})
export class ServiceModule {}
