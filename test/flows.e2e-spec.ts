import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, registerUser, jpegBuffer, auth, TestUser } from './utils';

/**
 * Основные пользовательские сценарии одним прогоном на общих юзерах:
 * лента · лайк · история · чат · приватный аккаунт · блок · live.
 */
describe('Core flows (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof app.getHttpServer>;
  let userA: TestUser; // публичный автор
  let userB: TestUser; // подписчик
  let userC: TestUser; // станет приватным
  let img: Buffer;
  let postId: number;
  let messageId: number;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    img = await jpegBuffer();
    userA = await registerUser(app, 'flowa');
    userB = await registerUser(app, 'flowb');
    userC = await registerUser(app, 'flowc');
  });

  afterAll(async () => {
    await app.close();
  });

  it('userA создаёт публикацию (реальный upload фото) → 201', async () => {
    const res = await request(http)
      .post('/api/posts')
      .set('Authorization', auth(userA))
      .field('caption', 'e2e post #travel')
      .attach('media', img, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.errors).toBeNull();
    postId = res.body.data.id as number;
    expect(postId).toBeGreaterThan(0);
  });

  it('userB подписывается на публичного userA → ACCEPTED сразу', async () => {
    const res = await request(http)
      .post(`/api/follow/${userA.id}`)
      .set('Authorization', auth(userB))
      .expect(201);
    expect(res.body.data.status).toBe('ACCEPTED');
    expect(res.body.data.isFollowing).toBe(true);
  });

  it('лента userB содержит пост userA (userId из JWT, курсорная)', async () => {
    const res = await request(http)
      .get('/api/posts/feed?limit=20')
      .set('Authorization', auth(userB))
      .expect(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    const ids = res.body.data.items.map((p: { id: number }) => p.id);
    expect(ids).toContain(postId);
  });

  it('лайк поста (toggle) → { liked:true, likesCount:1 }, повтор снимает', async () => {
    const on = await request(http)
      .post(`/api/posts/${postId}/like`)
      .set('Authorization', auth(userB))
      .expect(201);
    expect(on.body.data.liked).toBe(true);
    expect(typeof on.body.data.likesCount).toBe('number');
    expect(on.body.data.likesCount).toBeGreaterThanOrEqual(1);

    const off = await request(http)
      .post(`/api/posts/${postId}/like`)
      .set('Authorization', auth(userB))
      .expect(201);
    expect(off.body.data.liked).toBe(false);
  });

  it('история: userA создаёт → userB отмечает просмотренной (view на сервере)', async () => {
    const created = await request(http)
      .post('/api/stories')
      .set('Authorization', auth(userA))
      .attach('media', img, { filename: 's.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(Array.isArray(created.body.data)).toBe(true);
    const storyId = created.body.data[0].id as number;

    const viewed = await request(http)
      .post(`/api/stories/${storyId}/view`)
      .set('Authorization', auth(userB))
      .expect(201);
    expect(viewed.body.data.viewed).toBe(true);
  });

  it('чат: userA открывает чат с userB и шлёт сообщение', async () => {
    const chat = await request(http)
      .post('/api/chats')
      .set('Authorization', auth(userA))
      .send({ receiverUserId: userB.id })
      .expect(201);
    const chatId = chat.body.data.id as number;
    expect(chatId).toBeGreaterThan(0);

    const msg = await request(http)
      .post(`/api/chats/${chatId}/messages`)
      .set('Authorization', auth(userA))
      .field('text', 'привет из e2e')
      .expect(201);
    expect(msg.body.data.text).toBe('привет из e2e');
    messageId = msg.body.data.id as number;
  });

  it('реакция ЛЮБЫМ эмодзи, включая составные (семья/флаг/тон кожи), текст → 400', async () => {
    // Составной эмодзи (семья, 11 UTF-16 единиц) — раньше @MaxLength(8) отвергал его.
    await request(http)
      .post(`/api/chats/messages/${messageId}/reaction`)
      .set('Authorization', auth(userB))
      .send({ emoji: '👨‍👩‍👧‍👦' })
      .expect(201);

    // Флаг страны и тон кожи — тоже проходят.
    await request(http)
      .post(`/api/chats/messages/${messageId}/reaction`)
      .set('Authorization', auth(userB))
      .send({ emoji: '👍🏽' })
      .expect(201);

    // Не эмодзи → 400 (реакция остаётся реакцией, а не абзацем текста).
    await request(http)
      .post(`/api/chats/messages/${messageId}/reaction`)
      .set('Authorization', auth(userB))
      .send({ emoji: 'hello' })
      .expect(400);
  });

  it('приватный аккаунт: PENDING → 403 на контент → accept → 200', async () => {
    // userC закрывает аккаунт
    await request(http)
      .put('/api/profile/privacy')
      .set('Authorization', auth(userC))
      .send({ isPrivate: true })
      .expect(200);

    // userA подаёт заявку → PENDING
    const follow = await request(http)
      .post(`/api/follow/${userC.id}`)
      .set('Authorization', auth(userA))
      .expect(201);
    expect(follow.body.data.status).toBe('PENDING');

    // контент закрыт → 403
    await request(http)
      .get(`/api/profile/${userC.id}/posts`)
      .set('Authorization', auth(userA))
      .expect(403);

    // userC находит заявку и принимает
    const reqs = await request(http)
      .get('/api/follow/requests')
      .set('Authorization', auth(userC))
      .expect(200);
    const reqRow = reqs.body.data.items.find(
      (r: { user: { id: string } }) => r.user.id === userA.id,
    );
    expect(reqRow).toBeTruthy();

    await request(http)
      .post(`/api/follow/requests/${reqRow.id}/accept`)
      .set('Authorization', auth(userC))
      .expect(201);

    // теперь контент виден → 200
    await request(http)
      .get(`/api/profile/${userC.id}/posts`)
      .set('Authorization', auth(userA))
      .expect(200);
  });

  it('блок: userA блокирует userB → userB не видит профиль userA (403)', async () => {
    await request(http)
      .post(`/api/follow/${userB.id}/block`)
      .set('Authorization', auth(userA))
      .expect(201);

    await request(http)
      .get(`/api/profile/${userA.id}`)
      .set('Authorization', auth(userB))
      .expect(403);

    // разблокировка возвращает доступ
    await request(http)
      .delete(`/api/follow/${userB.id}/block`)
      .set('Authorization', auth(userA))
      .expect(200);
    await request(http)
      .get(`/api/profile/${userA.id}`)
      .set('Authorization', auth(userB))
      .expect(200);
  });

  it('live: start → feed(подписчик) → join → comment → end', async () => {
    // Блок в прошлом тесте разорвал подписку userB→userA (в обе стороны) и unblock её
    // НЕ восстанавливает — поэтому переподписываемся, чтобы эфир попал в feed подписчика.
    await request(http)
      .post(`/api/follow/${userA.id}`)
      .set('Authorization', auth(userB))
      .expect(201);

    const started = await request(http)
      .post('/api/live/start')
      .set('Authorization', auth(userA))
      .send({ title: 'e2e live' })
      .expect(201);
    const liveId = started.body.data.live.id as string;
    expect(started.body.data.token).toBeTruthy();

    const feed = await request(http)
      .get('/api/live/feed')
      .set('Authorization', auth(userB))
      .expect(200);
    const liveIds = feed.body.data.map((l: { id: string }) => l.id);
    expect(liveIds).toContain(liveId);

    const join = await request(http)
      .post(`/api/live/${liveId}/join`)
      .set('Authorization', auth(userB))
      .expect(200);
    expect(join.body.data.token).toBeTruthy();

    await request(http)
      .post(`/api/live/${liveId}/comment`)
      .set('Authorization', auth(userB))
      .send({ text: 'огонь 🔥' })
      .expect(201);

    const ended = await request(http)
      .post(`/api/live/${liveId}/end`)
      .set('Authorization', auth(userA))
      .expect(200);
    expect(ended.body.data.commentsCount).toBeGreaterThanOrEqual(1);
  });
});
