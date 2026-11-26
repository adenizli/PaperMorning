import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../src/config/app.config';
import { registerAndLogin } from '../support/auth-helpers';
import { createTestApp, truncateAll } from '../support/test-app';
import { testConfig } from '../support/test-config';

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  async function boot(env?: Record<string, string>) {
    app = await createTestApp((b) =>
      env ? b.overrideProvider(AppConfig).useValue(testConfig(env)) : b,
    );
    await truncateAll(app.get(DataSource));
  }

  afterEach(() => app.close());

  describe('registration', () => {
    beforeEach(() => boot());

    it('accepts exactly username, email and password and never returns a hash', async () => {
      const response = await http()
        .post('/api/auth/register')
        .send({
          username: 'Ayse.Y',
          email: ' Ayse@Example.ORG ',
          password: 'correct-horse-battery',
        })
        .expect(201);
      expect(Object.keys(response.body).sort()).toEqual(['createdAt', 'email', 'id', 'username']);
      expect(response.body).toMatchObject({ username: 'ayse.y', email: 'ayse@example.org' });

      const [row] = await app.get(DataSource).query('SELECT password_hash FROM users');
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain('correct-horse-battery');
    });

    it.each([
      [
        'an extra field',
        { username: 'abc', email: 'a@b.org', password: 'long-enough-1', emailVerified: true },
      ],
      ['a missing field', { username: 'abc', password: 'long-enough-1' }],
      ['an invalid email', { username: 'abc', email: 'nope', password: 'long-enough-1' }],
      ['a short password', { username: 'abc', email: 'a@b.org', password: 'short' }],
      ['an invalid username', { username: 'a b!', email: 'a@b.org', password: 'long-enough-1' }],
    ])('rejects %s', async (_label, body) => {
      await http().post('/api/auth/register').send(body).expect(400);
      expect((await app.get(DataSource).query('SELECT count(*)::int AS n FROM users'))[0].n).toBe(
        0,
      );
    });

    it('enforces case-insensitive uniqueness, including concurrent signups', async () => {
      await http()
        .post('/api/auth/register')
        .send({ username: 'reader', email: 'r@example.org', password: 'long-enough-1' })
        .expect(201);
      await http()
        .post('/api/auth/register')
        .send({ username: 'READER', email: 'x@example.org', password: 'long-enough-1' })
        .expect(409);
      await http()
        .post('/api/auth/register')
        .send({ username: 'other', email: 'R@EXAMPLE.org', password: 'long-enough-1' })
        .expect(409);

      const statuses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          http()
            .post('/api/auth/register')
            .send({ username: 'racer', email: `racer${i}@example.org`, password: 'long-enough-1' })
            .then((r) => r.status),
        ),
      );
      expect(statuses.sort()).toEqual([201, 409, 409, 409, 409]);
    });

    it('has no verification or refresh endpoints and stores no verification state', async () => {
      for (const path of [
        '/api/auth/verify-email',
        '/api/auth/resend-verification',
        '/api/auth/refresh',
        '/api/auth/password-reset',
      ]) {
        expect([401, 404]).toContain((await http().post(path).send({})).status);
      }
      const columns = await app
        .get(DataSource)
        .query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`);
      expect(columns.map((c: { column_name: string }) => c.column_name).sort()).toEqual([
        'created_at',
        'email',
        'id',
        'password_hash',
        'updated_at',
        'username',
      ]);
    });
  });

  describe('login, session and logout', () => {
    beforeEach(() => boot());

    it('logs in with username or email and issues a fixed 3-hour HttpOnly cookie', async () => {
      await http()
        .post('/api/auth/register')
        .send({ username: 'reader', email: 'reader@example.org', password: 'long-enough-1' });
      for (const identifier of ['reader', 'Reader@Example.org']) {
        const response = await http()
          .post('/api/auth/login')
          .send({ identifier, password: 'long-enough-1' })
          .expect(200);
        const cookie = (response.headers['set-cookie'] as unknown as string[])[0];
        expect(cookie).toMatch(/^pm_session=/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);
        expect(cookie).toMatch(/Path=\/api/);
        expect(response.body.accessToken).toBeUndefined(); // browsers never see the raw token
        const ttl = new Date(response.body.expiresAt).getTime() - Date.now();
        expect(ttl).toBeGreaterThan(3 * 3600_000 - 60_000);
        expect(ttl).toBeLessThanOrEqual(3 * 3600_000);
      }
    });

    it('returns the same generic error for a wrong password and an unknown user', async () => {
      await http()
        .post('/api/auth/register')
        .send({ username: 'reader', email: 'reader@example.org', password: 'long-enough-1' });
      const wrong = await http()
        .post('/api/auth/login')
        .send({ identifier: 'reader', password: 'wrong-password' })
        .expect(401);
      const missing = await http()
        .post('/api/auth/login')
        .send({ identifier: 'ghost', password: 'wrong-password' })
        .expect(401);
      expect(wrong.body).toEqual(missing.body);
    });

    it('protects personal endpoints, accepts cookie or bearer, and rejects expired tokens', async () => {
      const session = await registerAndLogin(app, 'reader');
      await http().get('/api/me').expect(401);
      await http().get('/api/preferences').expect(401);
      await http().get('/api/me').set('Cookie', session.cookie).expect(200);
      const me = await http()
        .get('/api/me')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);
      expect(me.body).not.toHaveProperty('passwordHash');

      const jwt = app.get(JwtService);
      const { exp, iat } = jwt.decode<{ exp: number; iat: number }>(session.token);
      expect(exp - iat).toBe(3 * 3600);
      const expired = await jwt.signAsync({ sub: session.userId }, { expiresIn: -10 });
      await http().get('/api/me').set('Authorization', `Bearer ${expired}`).expect(401);
      const forged = new JwtService({ secret: 'another-secret-that-is-long-enough-000000' }).sign({
        sub: session.userId,
      });
      await http().get('/api/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('logout clears the browser cookie (stateless token is not revoked server-side)', async () => {
      const response = await http().post('/api/auth/logout').expect(204);
      expect((response.headers['set-cookie'] as unknown as string[])[0]).toMatch(
        /pm_session=;.*Expires=Thu, 01 Jan 1970/,
      );
    });

    it('rejects cookie-authenticated writes from a foreign origin but not same-origin or bearer', async () => {
      const session = await registerAndLogin(app, 'reader');
      const body = {
        language: 'tr',
        timezone: 'Europe/Istanbul',
        dailyEmailEnabled: false,
        topics: [],
      };
      await http()
        .put('/api/preferences')
        .set('Cookie', session.cookie)
        .set('Origin', 'https://evil.example')
        .send(body)
        .expect(403);
      await http()
        .put('/api/preferences')
        .set('Cookie', session.cookie)
        .set('Sec-Fetch-Site', 'cross-site')
        .send(body)
        .expect(403);
      await http().put('/api/preferences').set('Cookie', session.cookie).send(body).expect(200);
      await http()
        .put('/api/preferences')
        .set('Authorization', `Bearer ${session.token}`)
        .set('Origin', 'app://desktop')
        .send(body)
        .expect(200);
    });
  });

  describe('operator safeguards', () => {
    it('can disable registration', async () => {
      await boot({ REGISTRATION_ENABLED: 'false' });
      await http()
        .post('/api/auth/register')
        .send({ username: 'abc', email: 'a@b.org', password: 'long-enough-1' })
        .expect(403);
    });

    it('caps the number of users', async () => {
      await boot({ MAX_USERS: '1' });
      await http()
        .post('/api/auth/register')
        .send({ username: 'one', email: 'one@b.org', password: 'long-enough-1' })
        .expect(201);
      await http()
        .post('/api/auth/register')
        .send({ username: 'two', email: 'two@b.org', password: 'long-enough-1' })
        .expect(403);
    });

    it('rate-limits login attempts', async () => {
      await boot({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (await http().post('/api/auth/login').send({ identifier: 'x', password: 'y' })).status,
        );
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    });
  });
});
