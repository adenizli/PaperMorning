import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { AppConfig } from './config/app.config';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(app.get(AppConfig).port);
}

void bootstrap();
