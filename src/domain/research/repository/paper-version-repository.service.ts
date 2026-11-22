import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { PaperVersionModel } from '../model/paper-version.model';
import { PaperVersionEntity } from './entity/paper-version.entity';

export type NewPaperVersion = Omit<PaperVersionModel, 'id' | 'createdAt'>;

@Injectable()
export class PaperVersionRepositoryService {
  constructor(
    @InjectRepository(PaperVersionEntity) private readonly repo: Repository<PaperVersionEntity>,
  ) {}

  /**
   * Idempotent insert keyed by (paper, publication status, content fingerprint): the same
   * revision seen again — from any source — maps to the existing row.
   */
  async insertIfAbsent(
    data: NewPaperVersion,
  ): Promise<{ version: PaperVersionModel; created: boolean }> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values(data)
      .orIgnore()
      .returning(['id'])
      .execute();
    const created = (result.raw as unknown[]).length > 0;
    const entity = await this.repo.findOneByOrFail({
      paperId: data.paperId,
      publicationStatus: data.publicationStatus,
      contentFingerprint: data.contentFingerprint,
    });
    return { version: toVersionModel(entity), created };
  }

  async findById(id: string): Promise<PaperVersionModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toVersionModel(entity) : null;
  }

  async findByIds(ids: string[]): Promise<PaperVersionModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.findBy({ id: In(ids) })).map(toVersionModel);
  }

  async findByPaper(paperId: string): Promise<PaperVersionModel[]> {
    return (await this.repo.find({ where: { paperId }, order: { createdAt: 'ASC' } })).map(
      toVersionModel,
    );
  }
}

export function toVersionModel(entity: PaperVersionEntity): PaperVersionModel {
  return {
    id: entity.id,
    paperId: entity.paperId,
    source: entity.source,
    sourceRecordId: entity.sourceRecordId,
    versionLabel: entity.versionLabel,
    publicationStatus: entity.publicationStatus,
    publishedAt: entity.publishedAt,
    sourceUpdatedAt: entity.sourceUpdatedAt,
    title: entity.title,
    abstract: entity.abstract,
    contentCoverage: entity.contentCoverage,
    venue: entity.venue,
    landingUrl: entity.landingUrl,
    pdfUrl: entity.pdfUrl,
    categories: entity.categories,
    contentFingerprint: entity.contentFingerprint,
    createdAt: entity.createdAt,
  };
}
