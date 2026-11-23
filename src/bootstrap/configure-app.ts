import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppConfig } from '../config/app.config';

/** HTTP conventions shared by the real server and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(AppConfig);
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  if (config.auth.trustProxy) express.set('trust proxy', 1);
  app.use(cookieParser());
  // Same-origin web needs no CORS. Explicit extra origins only (never "*" with credentials).
  if (config.auth.allowedOrigins.length > 0) {
    app.enableCors({ origin: config.auth.allowedOrigins, credentials: true });
  }
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
