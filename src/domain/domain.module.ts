import { Module } from '@nestjs/common';
import { ResearchModule } from './research/research.module';

/** Business modules: Research (shared science). Account and Publication follow. */
@Module({
  imports: [ResearchModule],
})
export class DomainModule {}
