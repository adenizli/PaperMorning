import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AccountModule } from '../../domain/account/account.module';
import { PublicationModule } from '../../domain/publication/publication.module';
import { DailyPublicationScheduler } from './daily-publication.scheduler';

/** Single-process minute ticks; uses only exported domain services. */
@Module({
  imports: [ScheduleModule.forRoot(), AccountModule, PublicationModule],
  providers: [DailyPublicationScheduler],
  exports: [DailyPublicationScheduler],
})
export class SchedulerModule {}
