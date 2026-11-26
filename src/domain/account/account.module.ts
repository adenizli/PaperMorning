import { Module } from '@nestjs/common';
import { AccountController } from './controller/account.controller';
import { PreferenceController } from './controller/preference.controller';
import { AccountRepositoryModule } from './repository/account-repository.module';
import { AccountService } from './service/account.service';
import { PreferenceService } from './service/preference.service';

/** Users and reader preferences. Does not depend on core/auth, Research or Publication. */
@Module({
  imports: [AccountRepositoryModule],
  controllers: [AccountController, PreferenceController],
  providers: [AccountService, PreferenceService],
  exports: [AccountService, PreferenceService],
})
export class AccountModule {}
