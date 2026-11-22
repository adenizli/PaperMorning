import Anthropic from '@anthropic-ai/sdk';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/app.config';
import { LlmUsageEntity } from './llm-usage.entity';
import { ANTHROPIC_CLIENT, LlmService } from './llm.service';

@Module({
  imports: [TypeOrmModule.forFeature([LlmUsageEntity])],
  providers: [
    {
      provide: ANTHROPIC_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Anthropic | null =>
        config.llm.apiKey
          ? new Anthropic({
              apiKey: config.llm.apiKey,
              timeout: config.llm.timeoutMs,
              maxRetries: 2,
            })
          : null,
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
