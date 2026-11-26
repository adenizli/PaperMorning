import { Module } from '@nestjs/common';
import { FileStorageModule } from '../../service/file-storage/file-storage.module';
import { LlmModule } from '../../service/llm/llm.module';
import { MailModule } from '../../service/mail/mail.module';
import { PdfModule } from '../../service/pdf/pdf.module';
import { AccountModule } from '../account/account.module';
import { ResearchModule } from '../research/research.module';
import { FeedbackController } from './controller/feedback.controller';
import { PublicationController } from './controller/publication.controller';
import { PublicationRepositoryModule } from './repository/publication-repository.module';
import { ArticleWritingService } from './service/article-writing.service';
import { DeliveryService } from './service/delivery.service';
import { EditorialService } from './service/editorial.service';
import { IssueService } from './service/issue.service';
import { OutlookService } from './service/outlook.service';
import { PublicationService } from './service/publication.service';

/**
 * Personalized issues, Ufuk Raporu, immutable archive, delivery state and feedback — one domain
 * module by owner decision. Uses Research/Account only through their exported services.
 */
@Module({
  imports: [
    PublicationRepositoryModule,
    ResearchModule,
    AccountModule,
    LlmModule,
    PdfModule,
    FileStorageModule,
    MailModule,
  ],
  controllers: [PublicationController, FeedbackController],
  providers: [
    PublicationService,
    EditorialService,
    ArticleWritingService,
    OutlookService,
    IssueService,
    DeliveryService,
  ],
  exports: [PublicationService, DeliveryService],
})
export class PublicationModule {}
