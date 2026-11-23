import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** HTTP conventions shared by the real server and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  (app as NestExpressApplication).disable('x-powered-by');
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
