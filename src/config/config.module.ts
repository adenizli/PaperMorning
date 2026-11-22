import { Global, Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { AppConfig, loadAppConfig } from './app.config';

@Global()
@Module({
  providers: [
    {
      provide: AppConfig,
      useFactory: (): AppConfig => {
        // Tests must be hermetic: never pick up a developer's local .env.
        if (process.env.NODE_ENV !== 'test') loadDotenv({ quiet: true });
        return loadAppConfig(process.env);
      },
    },
  ],
  exports: [AppConfig],
})
export class ConfigModule {}
