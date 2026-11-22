import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/app.config';
import { DatabaseHealthService } from './database-health.service';
import { buildPostgresOptions } from './typeorm-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        ...buildPostgresOptions(config.database),
        autoLoadEntities: true,
      }),
    }),
  ],
  providers: [DatabaseHealthService],
  exports: [DatabaseHealthService],
})
export class PersistenceModule {}
