import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleVariantRepositoryService } from './article-variant-repository.service';
import { EmailDeliveryRepositoryService } from './email-delivery-repository.service';
import { ArticleVariantEntity } from './entity/article-variant.entity';
import { EmailDeliveryEntity } from './entity/email-delivery.entity';
import { FeedbackEntity } from './entity/feedback.entity';
import { IssueEntity } from './entity/issue.entity';
import { PublicationRunEntity } from './entity/publication-run.entity';
import { FeedbackRepositoryService } from './feedback-repository.service';
import { IssueRepositoryService } from './issue-repository.service';
import { PublicationRunRepositoryService } from './publication-run-repository.service';

const repositories = [
  ArticleVariantRepositoryService,
  IssueRepositoryService,
  PublicationRunRepositoryService,
  EmailDeliveryRepositoryService,
  FeedbackRepositoryService,
];

/** Publication-owned persistence; not exported outside PublicationModule. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ArticleVariantEntity,
      IssueEntity,
      PublicationRunEntity,
      EmailDeliveryEntity,
      FeedbackEntity,
    ]),
  ],
  providers: repositories,
  exports: repositories,
})
export class PublicationRepositoryModule {}
