import { Module } from '@nestjs/common';
import { PersistenceModule } from './persistence/persistence.module';

/** Integration adapters (persistence, and later academic sources, LLM, mail, PDF, storage). */
@Module({
  imports: [PersistenceModule],
  exports: [PersistenceModule],
})
export class ServiceModule {}
