import { Module } from '@nestjs/common';
import { ServiceModule } from '../service/service.module';
import { AuthModule } from './auth/auth.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { HealthController } from './health/health.controller';

/** Application-wide capabilities: health, authentication and the daily scheduler. */
@Module({
  imports: [ServiceModule, AuthModule, SchedulerModule],
  controllers: [HealthController],
})
export class CoreModule {}
