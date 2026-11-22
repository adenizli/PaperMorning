import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CoreModule } from './core/core.module';
import { DomainModule } from './domain/domain.module';
import { ServiceModule } from './service/service.module';

@Module({
  imports: [ConfigModule, CoreModule, ServiceModule, DomainModule],
})
export class AppModule {}
