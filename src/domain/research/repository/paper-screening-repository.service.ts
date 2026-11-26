import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PaperScreeningModel, ScreeningDecision } from '../model/paper-screening.model';
import { PaperScreeningEntity } from './entity/paper-screening.entity';

@Injectable()
export class PaperScreeningRepositoryService {
  constructor(
    @InjectRepository(PaperScreeningEntity) private readonly repo: Repository<PaperScreeningEntity>,
  ) {}

  async find(
    paperVersionId: string,
    topicKey: string,
    criteriaVersion: string,
  ): Promise<PaperScreeningModel | null> {
    const entity = await this.repo.findOneBy({ paperVersionId, topicKey, criteriaVersion });
    return entity ? toModel(entity) : null;
  }

  /** Persists a decision once; a concurrent duplicate returns the stored decision. */
  async insertIfAbsent(
    data: Omit<PaperScreeningModel, 'id' | 'createdAt'>,
  ): Promise<PaperScreeningModel> {
    await this.repo.createQueryBuilder().insert().values(data).orIgnore().execute();
    return toModel(
      await this.repo.findOneByOrFail({
        paperVersionId: data.paperVersionId,
        topicKey: data.topicKey,
        criteriaVersion: data.criteriaVersion,
      }),
    );
  }

  async findAccepted(
    paperVersionIds: string[],
    topicKeys: string[],
  ): Promise<PaperScreeningModel[]> {
    if (paperVersionIds.length === 0 || topicKeys.length === 0) return [];
    return (
      await this.repo.findBy({
        paperVersionId: In(paperVersionIds),
        topicKey: In(topicKeys),
        decision: ScreeningDecision.ACCEPTED,
      })
    ).map(toModel);
  }
}

function toModel(entity: PaperScreeningEntity): PaperScreeningModel {
  return {
    id: entity.id,
    paperVersionId: entity.paperVersionId,
    topicKey: entity.topicKey,
    criteriaVersion: entity.criteriaVersion,
    decision: entity.decision,
    method: entity.method,
    relevanceScore: entity.relevanceScore,
    reason: entity.reason,
    model: entity.model,
    promptVersion: entity.promptVersion,
    createdAt: entity.createdAt,
  };
}
