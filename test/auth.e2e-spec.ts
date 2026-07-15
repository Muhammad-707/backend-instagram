import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, registerUser, uniqueName, TestUser } from './utils';

/**
 * Auth-флоу: register → login → refresh → logout.
 * Плюс проверка конверта { data, errors, statusCode } и что passwordHash не утекает.
 */
describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof app.getHttpServer>;
  let user: TestUser;
  const password = 'Password123';

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('register → 201, пара токенов + профиль, passwordHash НЕ утекает', async () => {
    user = await registerUser(app, 'auth');
    expect(user.accessToken).toBeTruthy();
    expect(user.refreshToken).toBeTruthy();
    expect(user.id).toBeTruthy();

    const me = await request(http)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(me.body.errors).toBeNull();
    expect(me.body.statusCode).toBe(200);
    expect(me.body.data.userName).toBe(user.userName);
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  it('register: пароли не совпадают → 400', async () => {
    const name = uniqueName('bad');
    const res = await request(http)
      .post('/api/auth/register')
      .send({
        userName: name,
        fullName: 'X',
        email: `${name}@example.com`,
        password: 'Password123',
        confirmPassword: 'Nope',
        dob: '2000-01-01',
      })
      .expect(400);
    expect(res.body.errors).toBeTruthy();
    expect(res.body.errors).not.toContain('success');
  });

  it('login по userName → 200 + новая пара токенов', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ login: user.userName, password })
      .expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('login с неверным паролем → 401 (не 500)', async () => {
    const res = await request(http)
      .post('/api/auth/login')
      .send({ login: user.userName, password: 'WrongPassword1' })
      .expect(401);
    expect(res.body.statusCode).toBe(401);
  });

  it('refresh → новая пара, старый refresh отзывается', async () => {
    const login = await request(http)
      .post('/api/auth/login')
      .send({ login: user.userName, password })
      .expect(200);
    const oldRefresh = login.body.data.refreshToken as string;

    const refreshed = await request(http)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
    const newRefresh = refreshed.body.data.refreshToken as string;
    expect(newRefresh).not.toBe(oldRefresh);

    // Повторное использование старого refresh → 401 (детект кражи токена).
    await request(http).post('/api/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
  });

  it('logout → refresh больше не работает; повтор logout идемпотентен', async () => {
    const login = await request(http)
      .post('/api/auth/login')
      .send({ login: user.userName, password })
      .expect(200);
    const refresh = login.body.data.refreshToken as string;

    await request(http).post('/api/auth/logout').send({ refreshToken: refresh }).expect(200);
    await request(http).post('/api/auth/refresh').send({ refreshToken: refresh }).expect(401);
    // повторный logout не падает
    await request(http).post('/api/auth/logout').send({ refreshToken: refresh }).expect(200);
  });

  it('GET /auth/me без токена → 401', async () => {
    await request(http).get('/api/auth/me').expect(401);
  });
});
