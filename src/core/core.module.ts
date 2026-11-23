import { Module } from '@nestjs/common';
import { ServiceModule } from '../service/service.module';
import { HealthController } from './health/health.controller';

/** Application-wide capabilities: health, and later authentication and scheduling. */
@Module({
  imports: [ServiceModule],
  controllers: [HealthController],
})
export class CoreModule {}
