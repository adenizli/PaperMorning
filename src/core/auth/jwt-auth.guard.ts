import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../common/http/authenticated-user';
import { IS_PUBLIC_ROUTE } from '../../common/http/authenticated-user';
import { AppConfig } from '../../config/app.config';
import { AuthService } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Token sources: `Authorization: Bearer` (desktop client) or the HttpOnly session cookie (web).
 * Cookie-authenticated state-changing requests must come from the same origin or an explicitly
 * allowed origin (CSRF defence in addition to SameSite=Strict).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const cookies = request.cookies as Record<string, string> | undefined;
    const cookie = cookies?.[this.config.auth.cookieName];
    const token = bearer ?? cookie;
    if (!token) throw new UnauthorizedException();

    const user = await this.auth.verify(token);
    if (!user) throw new UnauthorizedException();
    if (!bearer && !SAFE_METHODS.has(request.method)) this.assertSameOrigin(request);

    request.user = user;
    return true;
  }

  private assertSameOrigin(request: AuthenticatedRequest): void {
    const origin = request.headers.origin;
    if (origin) {
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        throw new ForbiddenException('Invalid Origin');
      }
      const allowed =
        host === request.headers.host || this.config.auth.allowedOrigins.includes(origin);
      if (!allowed) throw new ForbiddenException('Cross-origin request rejected');
      return;
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      throw new ForbiddenException('Cross-site request rejected');
    }
  }
}
