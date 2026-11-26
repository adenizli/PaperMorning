import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

export interface TestSession {
  userId: string;
  cookie: string;
  token: string;
}

/** Registers a reader with the three allowed fields and logs in as the desktop client. */
export async function registerAndLogin(
  app: INestApplication<App>,
  username: string,
): Promise<TestSession> {
  const password = `${username}-correct-horse`;
  const registered = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.org`, password })
    .expect(201);
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-PaperMorning-Client', 'desktop')
    .send({ identifier: username, password })
    .expect(200);
  const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  return { userId: registered.body.id, cookie, token: login.body.accessToken };
}
