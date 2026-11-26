import { Module } from '@nestjs/common';
import { AcademicSourceModule } from './academic-source/academic-source.module';
import { LlmModule } from './llm/llm.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { MailModule } from './mail/mail.module';
import { PdfModule } from './pdf/pdf.module';
import { PersistenceModule } from './persistence/persistence.module';

/** Integration adapters: persistence, academic sources, Claude, PDF, private files, mail. */
@Module({
  imports: [
    PersistenceModule,
    AcademicSourceModule,
    LlmModule,
    PdfModule,
    FileStorageModule,
    MailModule,
  ],
  exports: [
    PersistenceModule,
    AcademicSourceModule,
    LlmModule,
    PdfModule,
    FileStorageModule,
    MailModule,
  ],
})
export class ServiceModule {}
