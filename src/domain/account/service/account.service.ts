import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfig } from '../../../config/app.config';
import type { RegisterUserInput } from '../model/crud/register-user.input';
import type { UserModel } from '../model/user.model';
import {
  DuplicateUserError,
  UserCapReachedError,
  UserRepositoryService,
} from '../repository/user-repository.service';

export const normalizeIdentifier = (value: string): string => value.trim().toLowerCase();

/**
 * Account identity: three-field registration (no verification email), Argon2id password hashes,
 * and credential checks for core/auth. Never returns a password hash.
 */
@Injectable()
export class AccountService {
  /** Used to keep failed-login timing similar whether or not the account exists. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly config: AppConfig,
    private readonly users: UserRepositoryService,
  ) {}

  async register(input: RegisterUserInput): Promise<UserModel> {
    if (!this.config.auth.registrationEnabled) {
      throw new ForbiddenException('Registration is disabled on this installation');
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.users.create(
        {
          username: normalizeIdentifier(input.username),
          email: normalizeIdentifier(input.email),
          passwordHash,
        },
        this.config.auth.maxUsers,
      );
    } catch (error) {
      if (error instanceof DuplicateUserError) {
        throw new ConflictException('Username or email is already registered');
      }
      if (error instanceof UserCapReachedError) {
        throw new ForbiddenException('This installation has reached its user limit');
      }
      throw error;
    }
  }

  /** Returns the user for a correct username-or-email + password, otherwise null. */
  async verifyCredentials(identifier: string, password: string): Promise<UserModel | null> {
    const credentials = await this.users.findCredentials(normalizeIdentifier(identifier));
    if (!credentials) {
      await argon2.verify(await this.getDummyHash(), password).catch(() => false);
      return null;
    }
    const valid = await argon2.verify(credentials.passwordHash, password).catch(() => false);
    return valid ? credentials.user : null;
  }

  getById(userId: string): Promise<UserModel | null> {
    return this.users.findById(userId);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
    return this.dummyHash;
  }
}
