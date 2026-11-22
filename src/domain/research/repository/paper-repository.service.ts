import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import type { PaperModel } from '../model/paper.model';
import { PaperEntity } from './entity/paper.entity';

export interface PaperIdentifiers {
  doi: string | null;
  arxivId: string | null;
  openAlexId: string | null;
}

@Injectable()
export class PaperRepositoryService {
  constructor(@InjectRepository(PaperEntity) private readonly repo: Repository<PaperEntity>) {}

  /** Papers sharing any verified identifier with the given record. */
  async findByAnyIdentifier(ids: PaperIdentifiers): Promise<PaperModel[]> {
    const where = [
      ids.doi ? { doi: ids.doi } : null,
      ids.arxivId ? { arxivId: ids.arxivId } : null,
      ids.openAlexId ? { openAlexId: ids.openAlexId } : null,
    ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);
    if (where.length === 0) return [];
    return (await this.repo.find({ where })).map(toModel);
  }

  async findByIds(ids: string[]): Promise<PaperModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.findBy({ id: In(ids) })).map(toModel);
  }

  /** Inserts a paper; returns null when a concurrent writer already claimed an identifier. */
  async tryInsert(
    data: Omit<PaperModel, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PaperModel | null> {
    try {
      return toModel(await this.repo.save(this.repo.create(data)));
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** Fills identifiers that are still empty; never overwrites a verified identifier. */
  async fillMissingIdentifiers(id: string, ids: Partial<PaperIdentifiers>): Promise<void> {
    for (const [column, value] of Object.entries(ids)) {
      if (!value) continue;
      try {
        await this.repo
          .createQueryBuilder()
          .update()
          .set({ [column]: value })
          .where('id = :id', { id })
          .andWhere(`${toSnake(column)} IS NULL`)
          .execute();
      } catch (error) {
        // Another paper already owns this identifier: keep both records unmerged.
        if (!isUniqueViolation(error)) throw error;
      }
    }
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

function toSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function toModel(entity: PaperEntity): PaperModel {
  return {
    id: entity.id,
    title: entity.title,
    authors: entity.authors,
    doi: entity.doi,
    arxivId: entity.arxivId,
    openAlexId: entity.openAlexId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
