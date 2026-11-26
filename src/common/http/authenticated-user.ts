import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** Identity established by the global auth guard from a verified access token. */
export interface AuthenticatedUser {
  id: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const IS_PUBLIC_ROUTE = 'isPublicRoute';

/** Marks a route as reachable without authentication (health, register, login, logout). */
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);

/** Injects the authenticated user. Never derive identity from request bodies or query params. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
