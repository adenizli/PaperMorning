import { Module } from '@nestjs/common';
import { ServiceModule } from '../service/service.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';

/** Application-wide capabilities: health and authentication (later: scheduling). */
@Module({
  imports: [ServiceModule, AuthModule],
  controllers: [HealthController],
})
export class CoreModule {}
