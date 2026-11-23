import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/http/authenticated-user';
import { RegisterUserDto } from '../../domain/account/model/crud/register-user.input';
import type { UserModel } from '../../domain/account/model/user.model';
import { AccountService } from '../../domain/account/service/account.service';
import { AuthService } from './auth.service';
import { LoginInput } from './login.input';

/** Header a desktop (Electron) client sends to receive the token for Bearer transport. */
export const DESKTOP_CLIENT_HEADER = 'x-papermorning-client';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
  ) {}

  /** Exactly three fields; no verification email is ever sent. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('register')
  register(@Body() input: RegisterUserDto): Promise<UserModel> {
    return this.accounts.register(input);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginInput,
    @Headers(DESKTOP_CLIENT_HEADER) client: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: UserModel; expiresAt: string; accessToken?: string }> {
    const credential = await this.auth.login(input.identifier, input.password);
    if (!credential) throw new UnauthorizedException('Invalid credentials');
    this.auth.setSessionCookie(response, credential);
    const body = { user: credential.user, expiresAt: credential.expiresAt.toISOString() };
    // Browsers keep the token only in the HttpOnly cookie; the desktop shell stores it itself.
    return client === 'desktop' ? { ...body, accessToken: credential.accessToken } : body;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    this.auth.clearSessionCookie(response);
  }
}
