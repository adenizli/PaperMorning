import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../../common/http/authenticated-user';
import type { UserModel } from '../model/user.model';
import { AccountService } from '../service/account.service';

@Controller()
export class AccountController {
  constructor(private readonly accounts: AccountService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<UserModel> {
    const account = await this.accounts.getById(user.id);
    if (!account) throw new UnauthorizedException();
    return account;
  }
}
