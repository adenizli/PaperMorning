import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../../common/http/authenticated-user';
import { UpdatePreferencesInput } from '../model/crud/update-preferences.input';
import { DAILY_DELIVERY_LOCAL_TIME } from '../model/reader-preference.model';
import type { ReaderProfileModel } from '../model/reader-profile.model';
import { PreferenceService } from '../service/preference.service';

type PreferencesResponse = ReaderProfileModel & { deliveryLocalTime: string };

@Controller('preferences')
export class PreferenceController {
  constructor(private readonly preferences: PreferenceService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<PreferencesResponse> {
    return {
      ...(await this.preferences.getForUser(user.id)),
      deliveryLocalTime: DAILY_DELIVERY_LOCAL_TIME,
    };
  }

  @Put()
  async replace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdatePreferencesInput,
  ): Promise<PreferencesResponse> {
    return {
      ...(await this.preferences.replaceForUser(user.id, input)),
      deliveryLocalTime: DAILY_DELIVERY_LOCAL_TIME,
    };
  }
}
