import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { FeedbackModel, FeedbackValue } from '../model/feedback.model';
import { FeedbackEntity } from './entity/feedback.entity';

@Injectable()
export class FeedbackRepositoryService {
  constructor(
    @InjectRepository(FeedbackEntity) private readonly repo: Repository<FeedbackEntity>,
  ) {}

  /** One active vote per (user, issue, content key); a new vote replaces the old one. */
  async upsert(
    userId: string,
    issueId: string,
    contentKey: string,
    value: FeedbackValue,
  ): Promise<FeedbackModel> {
    await this.repo.upsert({ userId, issueId, contentKey, value }, [
      'userId',
      'issueId',
      'contentKey',
    ]);
    return toModel(await this.repo.findOneByOrFail({ userId, issueId, contentKey }));
  }

  async listForIssue(userId: string, issueId: string): Promise<FeedbackModel[]> {
    return (await this.repo.findBy({ userId, issueId })).map(toModel);
  }
}

function toModel(e: FeedbackEntity): FeedbackModel {
  return {
    id: e.id,
    userId: e.userId,
    issueId: e.issueId,
    contentKey: e.contentKey,
    value: e.value as FeedbackValue,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
