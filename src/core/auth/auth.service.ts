import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Response } from 'express';
import type { AuthenticatedUser } from '../../common/http/authenticated-user';
import { ACCESS_TOKEN_TTL_SECONDS, AppConfig } from '../../config/app.config';
import { AccountService } from '../../domain/account/service/account.service';
import type { UserModel } from '../../domain/account/model/user.model';

export interface IssuedCredential {
  user: UserModel;
  accessToken: string;
  expiresAt: Date;
}

/**
 * One fixed 3-hour access credential per login. No refresh token and no sliding expiry.
 * Logout clears the client credential; an already-leaked stateless token stays valid until it
 * expires (accepted MVP trade-off, documented).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly accounts: AccountService,
  ) {}

  async login(identifier: string, password: string): Promise<IssuedCredential | null> {
    const user = await this.accounts.verifyCredentials(identifier, password);
    if (!user) return null;
    const accessToken = await this.jwt.signAsync(
      { sub: user.id },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const { exp } = this.jwt.decode<{ exp: number }>(accessToken);
    return { user, accessToken, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<AuthenticatedUser | null> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' ? { id: payload.sub } : null;
    } catch {
      return null;
    }
  }

  setSessionCookie(response: Response, credential: IssuedCredential): void {
    response.cookie(this.config.auth.cookieName, credential.accessToken, {
      ...this.cookieOptions(),
      expires: credential.expiresAt,
    });
  }

  clearSessionCookie(response: Response): void {
    response.clearCookie(this.config.auth.cookieName, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: 'strict',
      path: '/api',
    };
  }
}
