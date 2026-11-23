import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { ResearchModule } from './research/research.module';

/** Business modules: Research (shared science), Account (readers). Publication follows. */
@Module({
  imports: [ResearchModule, AccountModule],
})
export class DomainModule {}
