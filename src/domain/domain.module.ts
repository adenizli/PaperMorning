import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { PublicationModule } from './publication/publication.module';
import { ResearchModule } from './research/research.module';

/** Business modules: Research (shared science), Account (readers), Publication (issues). */
@Module({
  imports: [ResearchModule, AccountModule, PublicationModule],
})
export class DomainModule {}
