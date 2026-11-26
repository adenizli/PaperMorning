import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { UserModel } from '../model/user.model';
import { UserEntity } from './entity/user.entity';

/** Arbitrary constant key for the registration advisory lock (serializes user-cap checks). */
const REGISTRATION_LOCK_KEY = 72_100_001;

export class DuplicateUserError extends Error {}
export class UserCapReachedError extends Error {}

/** Internal credential record: never leaves the Account domain. */
export interface UserCredentials {
  user: UserModel;
  passwordHash: string;
}

@Injectable()
export class UserRepositoryService {
  constructor(@InjectRepository(UserEntity) private readonly repo: Repository<UserEntity>) {}

  /**
   * Inserts a user inside a short transaction holding an advisory lock, so the operator's user
   * cap cannot be exceeded by concurrent signups. Unique violations become DuplicateUserError.
   */
  async create(
    data: { username: string; email: string; passwordHash: string },
    maxUsers: number,
  ): Promise<UserModel> {
    try {
      return await this.repo.manager.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1)', [REGISTRATION_LOCK_KEY]);
        if (maxUsers > 0 && (await manager.count(UserEntity)) >= maxUsers) {
          throw new UserCapReachedError('User limit reached');
        }
        return toModel(await manager.save(manager.create(UserEntity, data)));
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new DuplicateUserError('Username or email already registered');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<UserModel | null> {
    const entity = await this.repo.findOneBy({ id });
    return entity ? toModel(entity) : null;
  }

  async findCredentials(normalizedIdentifier: string): Promise<UserCredentials | null> {
    const entity = await this.repo.findOne({
      where: [{ username: normalizedIdentifier }, { email: normalizedIdentifier }],
    });
    return entity ? { user: toModel(entity), passwordHash: entity.passwordHash } : null;
  }
}

function toModel(entity: UserEntity): UserModel {
  return {
    id: entity.id,
    username: entity.username,
    email: entity.email,
    createdAt: entity.createdAt,
  };
}
