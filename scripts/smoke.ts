/**
 * Санҷиши зиндаи ҳамаи 170 endpoint бо дархостҳои ВОҚЕӢ (CLAUDE.md: «ТАХМИН МАНЪ»).
 *
 * Тафовут аз e2e: e2e танҳо 17 сенарияи асосиро мепӯшонад. Ин скрипт ҳар роутеро,
 * ки дар docs/swagger.json ҳаст, мезанад ва дар охир мегӯяд, кадомаш нарасид —
 * яъне «пропустить endpoint» ғайриимкон мешавад.
 *
 * Иҷро: `npx ts-node scripts/smoke.ts` (API бояд кор кунад, SMOKE_URL-ро бинед).
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4000/api';

interface Result {
  key: string;
  status: number;
  ok: boolean;
  note: string;
}

const results: Result[] = [];
const hit = new Set<string>();
const checks: { name: string; ok: boolean; note: string }[] = [];

/** Проверка не «ответил 200», а «ответил то, что нужно» — критерии приёмки задач. */
function check(name: string, ok: boolean, note = ''): void {
  checks.push({ name, ok, note });
  process.stdout.write(ok ? '✓' : `\n  ✗ ПРОВЕРКА: ${name} — ${note}\n`);
}

interface CallOpts {
  token?: string;
  body?: unknown;
  form?: FormData;
  expect?: number[];
  /** Шаблони роут барои ҳисоби фарогирӣ: '/posts/{id}' */
  route?: string;
}

async function call(
  method: string,
  path: string,
  opts: CallOpts = {},
): Promise<{ status: number; data: any }> {
  const expect = opts.expect ?? [200, 201];
  const route = `${method} /api${opts.route ?? path.split('?')[0]}`;

  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  let json: any;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${BASE}${path}`, { method, headers, body });
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = text.slice(0, 200);
    }
    // Throttler дар /auth 5/дақ аст — ин лимити воқеии прод, вайрон намекунем, интизор мешавем.
    if (res.status === 429 && attempt < 2) {
      process.stdout.write(' [429 → интизори 61с] ');
      await new Promise((r) => setTimeout(r, 61_000));
      continue;
    }
    break;
  }

  hit.add(route);
  const ok = expect.includes(res.status);
  results.push({
    key: route,
    status: res.status,
    ok,
    note: ok ? '' : JSON.stringify(json?.errors ?? json).slice(0, 160),
  });
  process.stdout.write(ok ? '.' : `\n  ✗ ${route} → ${res.status}\n`);
  return { status: res.status, data: json?.data };
}

const jpeg = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 80, b: 40 } } })
    .jpeg()
    .toBuffer();

async function imageForm(field: string, count = 1): Promise<FormData> {
  const fd = new FormData();
  const buf = await jpeg();
  for (let i = 0; i < count; i++) {
    fd.append(field, new Blob([new Uint8Array(buf)], { type: 'image/jpeg' }), `t${i}.jpg`);
  }
  return fd;
}

const uniq = Date.now().toString().slice(-8);
const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log(`\n▶ Санҷиши зинда: ${BASE}\n`);

  // ── health ────────────────────────────────────────────────────────────
  await call('GET', '/health');

  // ── auth ──────────────────────────────────────────────────────────────
  const mkUser = (n: string) => ({
    userName: `smoke_${n}_${uniq}`,
    fullName: `Smoke ${n}`,
    email: `smoke_${n}_${uniq}@example.com`,
    password: 'Passw0rd!23',
    confirmPassword: 'Passw0rd!23',
    dob: '2000-01-01',
  });
  const u1 = mkUser('a');
  const u2 = mkUser('b');

  const r1 = await call('POST', '/auth/register', { body: u1, expect: [201, 200] });
  const r2 = await call('POST', '/auth/register', { body: u2, expect: [201, 200] });
  let t1: string = r1.data?.accessToken;
  let t2: string = r2.data?.accessToken;
  const id1: string = r1.data?.user?.id;
  const id2: string = r2.data?.user?.id;

  const login = await call('POST', '/auth/login', {
    body: { login: u1.userName, password: u1.password },
  });
  t1 = login.data?.accessToken ?? t1;
  const refreshToken: string = login.data?.refreshToken;

  await call('GET', '/auth/me', { token: t1 });
  await call('POST', '/auth/check-username', { body: { userName: `free_${uniq}` } });
  await call('POST', '/auth/refresh', { body: { refreshToken } });
  await call('POST', '/auth/forgot-password', { body: { email: u1.email } });
  await call('POST', '/auth/resend-code', { body: { email: u1.email } });
  await call('POST', '/auth/verify-code', {
    body: { email: u1.email, code: '000000' },
    expect: [400, 401], // коди нодуруст — 4xx интизор аст, на 500
  });
  await call('POST', '/auth/reset-password', {
    body: { email: u1.email, code: '000000', password: 'NewPassw0rd!23', confirmPassword: 'NewPassw0rd!23' },
    expect: [400, 401],
  });
  await call('PUT', '/auth/change-password', {
    token: t1,
    body: { oldPassword: u1.password, newPassword: u1.password, confirmPassword: u1.password },
    expect: [200, 400],
  });

  // ── upload ────────────────────────────────────────────────────────────
  const up = await call('POST', '/upload', { token: t1, form: await imageForm('files') });
  const upKey: string | undefined = up.data?.[0]?.key ?? up.data?.files?.[0]?.key;

  // ── profile ───────────────────────────────────────────────────────────
  await call('GET', '/profile/me', { token: t1 });
  await call('PUT', '/profile', { token: t1, body: { about: 'smoke bio', gender: 'MALE' } });
  await call('PUT', '/profile/privacy', { token: t1, body: { isPrivate: false } });
  await call('PUT', '/profile/avatar', { token: t1, form: await imageForm('file') });
  // Баги softclub-API (ТЗ §2): нест кардани аватар логинро мешикаст — барои ҳамин
  // баъд аз ин логин дубора санҷида мешавад.
  await call('DELETE', '/profile/avatar', { token: t1 });
  await call('POST', '/auth/login', {
    body: { login: u1.userName, password: u1.password },
    route: '/auth/login',
  });
  await call('PUT', '/profile/avatar', { token: t1, form: await imageForm('file'), route: '/profile/avatar' });
  await call('GET', `/profile/${id2}`, { token: t1, route: '/profile/{userId}' });
  await call('GET', `/profile/${id2}/is-following`, { token: t1, route: '/profile/{userId}/is-following' });
  await call('GET', `/profile/${id2}/posts`, { token: t1, route: '/profile/{userId}/posts' });
  await call('GET', `/profile/${id2}/reels`, { token: t1, route: '/profile/{userId}/reels' });
  await call('GET', `/profile/${id2}/tagged`, { token: t1, route: '/profile/{userId}/tagged' });
  await call('GET', '/profile/favorites', { token: t1 });
  await call('GET', '/profile/me/reposts', { token: t1 });
  await call('GET', '/profile/me/saved-music', { token: t1 });
  await call('GET', '/profile/me/activity', { token: t1 });

  // ── users ─────────────────────────────────────────────────────────────
  await call('GET', '/users?q=smoke', { token: t1, route: '/users' });
  await call('GET', '/users/suggestions', { token: t1 });

  // Вазифаи 9: ҷустуҷӯ бо userName-и АНИҚ, регистр аҳамият надорад.
  const byName = await call('GET', `/users/by-username/${u2.userName.toUpperCase()}`, {
    token: t1,
    route: '/users/by-username/{userName}',
  });
  check('by-username регистрро фарқ намекунад', byName.data?.id === id2, `гирифт: ${byName.data?.id}`);
  await call('GET', '/users/by-username/nest_chunin_kas_1234', {
    token: t1,
    route: '/users/by-username/{userName}',
    expect: [404],
  });
  const sh = await call('POST', '/users/search-history', { token: t1, body: { text: 'smoke' } });
  await call('GET', '/users/search-history', { token: t1 });
  // Ҳам ин ва ҳам роути зерин бо id-и САТРИ таърих кор мекунанд, на бо userId.
  if (sh.data?.id)
    await call('DELETE', `/users/search-history/${sh.data.id}`, { token: t1, route: '/users/search-history/{id}' });
  const su = await call('POST', '/users/search-history/user', { token: t1, body: { searchedUserId: id2 } });
  await call('GET', '/users/search-history/users', { token: t1 });
  await call('DELETE', `/users/search-history/user/${su.data?.id}`, { token: t1, route: '/users/search-history/user/{id}' });
  await call('DELETE', '/users/search-history/users', { token: t1 });
  await call('DELETE', '/users/search-history', { token: t1 });
  await call('POST', `/users/${id2}/report`, { token: t1, body: { reason: 'SPAM' }, route: '/users/{id}/report' });

  // ── follow ────────────────────────────────────────────────────────────
  await call('POST', `/follow/${id2}`, { token: t1, route: '/follow/{userId}' });
  await call('GET', `/follow/${id2}/followers`, { token: t1, route: '/follow/{userId}/followers' });
  await call('GET', `/follow/${id2}/following`, { token: t1, route: '/follow/{userId}/following' });
  await call('GET', '/follow/requests', { token: t1 });
  await call('GET', '/follow/blocked', { token: t1 });
  await call('POST', `/follow/${id2}/block`, { token: t1, route: '/follow/{userId}/block' });
  await call('DELETE', `/follow/${id2}/block`, { token: t1, route: '/follow/{userId}/block' });
  await call('DELETE', `/follow/${id2}`, { token: t1, route: '/follow/{userId}' });
  await call('POST', `/follow/${id2}`, { token: t1, route: '/follow/{userId}' });
  await call('DELETE', `/follow/followers/${id2}`, { token: t1, route: '/follow/followers/{userId}', expect: [200, 404] });

  // Дархостҳои обуна танҳо дар аккаунти ПРИВАТ пайдо мешаванд — барои ҳамин u3.
  const u3 = mkUser('c');
  const r3 = await call('POST', '/auth/register', { body: u3, route: '/auth/register', expect: [201, 200] });
  const t3: string = r3.data?.accessToken;
  const id3: string = r3.data?.user?.id;
  await call('PUT', '/profile/privacy', { token: t3, body: { isPrivate: true }, route: '/profile/privacy' });

  await call('POST', `/follow/${id3}`, { token: t1, route: '/follow/{userId}' });
  await call('POST', `/follow/${id3}`, { token: t2, route: '/follow/{userId}' });
  const freq = await call('GET', '/follow/requests', { token: t3, route: '/follow/requests' });
  const reqs: any[] = Array.isArray(freq.data) ? freq.data : (freq.data?.items ?? []);
  if (reqs[0]?.id)
    await call('POST', `/follow/requests/${reqs[0].id}/accept`, { token: t3, route: '/follow/requests/{id}/accept' });
  if (reqs[1]?.id)
    await call('POST', `/follow/requests/${reqs[1].id}/decline`, { token: t3, route: '/follow/requests/{id}/decline' });
  else console.log('\n  ⚠ дархости дуюми обуна наомад — /follow/requests/{id}/decline назада монд');

  // ── close-friends ─────────────────────────────────────────────────────
  await call('POST', `/close-friends/${id2}`, { token: t1, route: '/close-friends/{userId}' });
  await call('GET', '/close-friends', { token: t1 });
  await call('DELETE', `/close-friends/${id2}`, { token: t1, route: '/close-friends/{userId}' });

  // ── locations ─────────────────────────────────────────────────────────
  const loc = await call('POST', '/locations', {
    token: t1,
    body: { city: 'Dushanbe', country: 'Tajikistan', lat: 38.56, lng: 68.79 },
  });
  const locId: number = loc.data?.id;
  await call('GET', '/locations?q=Dush', { token: t1, route: '/locations' });
  await call('GET', `/locations/${locId}`, { token: t1, route: '/locations/{id}' });
  await call('PUT', `/locations/${locId}`, { token: t1, body: { city: 'Khujand', country: 'Tajikistan' }, route: '/locations/{id}' });

  // ── music ─────────────────────────────────────────────────────────────
  const music = await call('GET', '/music', { token: t1 });
  const musicId: number | undefined = music.data?.items?.[0]?.id ?? music.data?.[0]?.id;
  await call('GET', '/music/trending', { token: t1 });
  if (musicId) {
    await call('GET', `/music/${musicId}`, { token: t1, route: '/music/{id}' });
    await call('GET', `/music/${musicId}/stream`, { token: t1, route: '/music/{id}/stream', expect: [200, 206] });
    await call('POST', `/music/${musicId}/save`, { token: t1, route: '/music/{id}/save' });
    await call('DELETE', `/music/${musicId}/save`, { token: t1, route: '/music/{id}/save' });
  } else {
    console.log('\n  ⚠ music холӣ — /music/{id}* нагузашт (seed лозим)');
  }

  // ── spotify ───────────────────────────────────────────────────────────
  // Бе SPOTIFY_CLIENT_ID модул калид надорад — 4xx/5xx-и интизорнашуда набояд бошад.
  const sp = await call('GET', '/spotify/search?q=drake', { token: t1, route: '/spotify/search', expect: [200, 401, 500, 502, 503] });
  const spId: string | undefined = sp.data?.items?.[0]?.spotifyId ?? sp.data?.[0]?.spotifyId;
  const spProbe = spId ?? '4uLU6hMCjMI75M1A2tKUQC';
  await call('POST', `/spotify/tracks/${spProbe}/save`, { token: t1, route: '/spotify/tracks/{spotifyId}/save', expect: [200, 201, 401, 404, 500, 502, 503] });
  await call('DELETE', `/spotify/tracks/${spProbe}/save`, { token: t1, route: '/spotify/tracks/{spotifyId}/save', expect: [200, 204, 401, 404, 500, 502, 503] });

  // ── posts ─────────────────────────────────────────────────────────────
  const pf = await imageForm('media');
  pf.append('caption', 'smoke post #test');
  if (locId) pf.append('locationId', String(locId));
  const post = await call('POST', '/posts', { token: t1, form: pf, expect: [201, 200] });
  const postId: number = post.data?.id;

  const rf = await imageForm('media');
  rf.append('isReel', 'true');
  await call('POST', '/posts', { token: t1, form: rf, route: '/posts', expect: [201, 200] });

  // Вазифаи 2 (критерия): дар БД калид, вале ба фронт URL-и МУТЛАҚ меравад.
  const createdMedia = post.data?.media?.[0]?.url;
  check(
    'медиа: url мутлақ аст, на калиди урён',
    typeof createdMedia === 'string' && /^https?:\/\//.test(createdMedia),
    `гирифт: ${createdMedia}`,
  );
  const dbKey = await prisma.postMedia.findFirst({
    where: { postId: postId },
    select: { url: true },
  });
  check(
    'медиа: дар БД КАЛИД нигоҳ дошта мешавад, на URL',
    !!dbKey && !/^https?:\/\//.test(dbKey.url),
    `дар БД: ${dbKey?.url}`,
  );

  await call('GET', '/posts', { token: t1 });
  await call('GET', '/posts/feed', { token: t1 });
  await call('GET', '/posts/reels', { token: t1 });
  await call('GET', '/posts/my', { token: t1 });

  // Вазифаи 7 (критерия): пости u1 бо ин локация ба u2 намоён аст.
  const locPosts = await call('GET', `/locations/${locId}/posts`, {
    token: t2,
    route: '/locations/{id}/posts',
  });
  const lpItems: any[] = locPosts.data?.items ?? locPosts.data ?? [];
  check(
    'локация: ленти он пости сохташударо дорад',
    lpItems.some((p: any) => p.id === postId),
    `гирифт ${lpItems.length} пост, кофтам id=${postId}`,
  );
  await call('GET', `/posts/${postId}`, { token: t1, route: '/posts/{id}' });
  await call('PUT', `/posts/${postId}`, { token: t1, body: { caption: 'edited' }, route: '/posts/{id}' });
  await call('POST', `/posts/${postId}/view`, { token: t2, route: '/posts/{id}/view' });
  await call('POST', `/posts/${postId}/like`, { token: t2, route: '/posts/{id}/like' });
  await call('GET', `/posts/${postId}/likes`, { token: t1, route: '/posts/{id}/likes' });
  await call('POST', `/posts/${postId}/favorite?collection=Smoke`, { token: t1, route: '/posts/{id}/favorite' });
  await call('POST', `/posts/${postId}/share`, { token: t1, body: { toUserId: id2 }, route: '/posts/{id}/share' });
  await call('POST', `/posts/${postId}/report`, { token: t2, body: { reason: 'SPAM' }, route: '/posts/{id}/report' });
  await call('POST', `/posts/${postId}/archive`, { token: t1, route: '/posts/{id}/archive' });
  await call('DELETE', `/posts/${postId}/archive`, { token: t1, route: '/posts/{id}/archive' });

  // Вазифаи 11 (критерия): коллексияи «Smoke» бояд бо превю баргардад.
  const cols = await call('GET', '/profile/me/collections', { token: t1 });
  const colItems: any[] = cols.data ?? [];
  const smokeCol = colItems.find((c) => c.name === 'Smoke');
  check(
    'коллексияҳо: «Smoke» бо postsCount ва coverUrl',
    !!smokeCol && smokeCol.postsCount >= 1 && !!smokeCol.coverUrl,
    `гирифт: ${JSON.stringify(smokeCol)}`,
  );

  const cm = await call('POST', `/posts/${postId}/comments`, {
    token: t2,
    body: { text: 'smoke comment' },
    route: '/posts/{id}/comments',
  });
  const commentId: number = cm.data?.id;
  await call('GET', `/posts/${postId}/comments`, { token: t1, route: '/posts/{id}/comments' });
  await call('POST', `/posts/comments/${commentId}/like`, { token: t1, route: '/posts/comments/{id}/like' });
  const reply = await call('POST', `/posts/comments/${commentId}/reply`, {
    token: t1,
    body: { text: 'smoke reply' },
    route: '/posts/comments/{id}/reply',
  });
  await call('GET', `/posts/comments/${commentId}/replies`, { token: t1, route: '/posts/comments/{id}/replies' });
  if (reply.data?.id)
    await call('DELETE', `/posts/comments/${reply.data.id}`, { token: t1, route: '/posts/comments/{id}' });

  // ── stories ───────────────────────────────────────────────────────────
  const st = await call('POST', '/stories', { token: t1, form: await imageForm('media'), expect: [201, 200] });
  const storyId: number = Array.isArray(st.data) ? st.data[0]?.id : st.data?.id;
  await call('GET', '/stories', { token: t2 });
  await call('GET', '/stories/my', { token: t1 });
  await call('GET', '/stories/archive', { token: t1 });
  await call('GET', `/stories/user/${id1}`, { token: t2, route: '/stories/user/{userId}' });
  await call('GET', `/stories/${storyId}`, { token: t2, route: '/stories/{id}' });
  await call('POST', `/stories/${storyId}/view`, { token: t2, route: '/stories/{id}/view' });
  await call('POST', `/stories/${storyId}/like`, { token: t2, route: '/stories/{id}/like' });
  await call('POST', `/stories/${storyId}/reaction`, { token: t2, body: { emoji: '🔥' }, route: '/stories/{id}/reaction' });
  await call('POST', `/stories/${storyId}/reply`, { token: t2, body: { text: 'nice' }, route: '/stories/{id}/reply' });
  await call('GET', `/stories/${storyId}/viewers`, { token: t1, route: '/stories/{id}/viewers' });

  // ── highlights ────────────────────────────────────────────────────────
  const hl = await call('POST', '/highlights', {
    token: t1,
    body: { title: 'Smoke', storyIds: [storyId] },
  });
  const hlId: number = hl.data?.id;
  await call('GET', `/highlights/user/${id1}`, { token: t1, route: '/highlights/user/{userId}' });
  await call('GET', `/highlights/${hlId}`, { token: t1, route: '/highlights/{id}' });
  await call('PUT', `/highlights/${hlId}`, { token: t1, body: { title: 'Smoke2' }, route: '/highlights/{id}' });

  // ── notes ─────────────────────────────────────────────────────────────
  const note = await call('POST', '/notes', { token: t1, body: { text: 'smoke note' } });
  const noteId: number = note.data?.id;
  await call('GET', '/notes', { token: t1 });
  await call('PUT', `/notes/${noteId}`, { token: t1, body: { text: 'note2' }, route: '/notes/{id}' });
  await call('POST', `/notes/${noteId}/like`, { token: t2, route: '/notes/{id}/like' });
  await call('GET', `/notes/${noteId}/likes`, { token: t1, route: '/notes/{id}/likes' });
  await call('POST', `/notes/${noteId}/reply`, { token: t2, body: { text: 'reply' }, route: '/notes/{id}/reply' });
  await call('GET', `/notes/${noteId}/replies`, { token: t1, route: '/notes/{id}/replies' });

  // ── chats ─────────────────────────────────────────────────────────────
  const chat = await call('POST', '/chats', { token: t1, body: { receiverUserId: id2 } });
  const chatId: number = chat.data?.id;
  const mf = new FormData();
  mf.append('text', 'smoke message');
  const msg = await call('POST', `/chats/${chatId}/messages`, { token: t1, form: mf, route: '/chats/{id}/messages', expect: [201, 200] });
  const msgId: number = msg.data?.id;
  await call('GET', '/chats', { token: t1 });
  await call('GET', `/chats/${chatId}`, { token: t1, route: '/chats/{id}' });
  await call('GET', `/chats/${chatId}/messages`, { token: t1, route: '/chats/{id}/messages' });
  await call('POST', `/chats/${chatId}/read`, { token: t2, route: '/chats/{id}/read' });
  await call('PUT', `/chats/messages/${msgId}`, { token: t1, body: { text: 'edited' }, route: '/chats/messages/{id}' });
  await call('POST', `/chats/messages/${msgId}/reaction`, { token: t2, body: { emoji: '❤️' }, route: '/chats/messages/{id}/reaction' });
  await call('DELETE', `/chats/messages/${msgId}/reaction`, { token: t2, route: '/chats/messages/{id}/reaction' });
  await call('PUT', `/chats/${chatId}/theme`, { token: t1, body: { theme: 'DEFAULT' }, route: '/chats/{id}/theme', expect: [200, 400] });
  await call('PUT', `/chats/${chatId}/nickname`, { token: t1, body: { userId: id2, nickname: 'Bro' }, route: '/chats/{id}/nickname' });
  await call('PUT', `/chats/${chatId}/mute`, { token: t1, body: { muted: true }, route: '/chats/{id}/mute' });
  await call('POST', `/chats/${chatId}/report`, { token: t1, body: { reason: 'SPAM' }, route: '/chats/{id}/report' });
  await call('POST', `/chats/${chatId}/call`, { token: t1, route: '/chats/{id}/call' });
  // Дархости чат аз бегона пайдо мешавад (u3 приват аст ва ба u1/u2 обуна нест).
  const chat3 = await call('POST', '/chats', { token: t3, body: { receiverUserId: id2 }, route: '/chats' });
  if (chat3.data?.id) {
    const f3 = new FormData();
    f3.append('text', 'salom, in darxosti chat ast');
    await call('POST', `/chats/${chat3.data.id}/messages`, { token: t3, form: f3, route: '/chats/{id}/messages', expect: [201, 200] });
  }
  const creq = await call('GET', '/chats/requests', { token: t2, route: '/chats/requests' });
  const creqs: any[] = Array.isArray(creq.data) ? creq.data : (creq.data?.items ?? []);
  if (creqs[0]?.id) {
    await call('POST', `/chats/requests/${creqs[0].id}/accept`, { token: t2, route: '/chats/requests/{id}/accept' });
  } else {
    console.log('\n  ⚠ дархости чат наомад — /chats/requests/{id}/accept назада монд');
  }

  // decline дархости ДУЮМРО талаб мекунад — якумаш аллакай қабул шуд.
  const u4 = mkUser('d');
  const r4 = await call('POST', '/auth/register', { body: u4, route: '/auth/register', expect: [201, 200] });
  const t4: string = r4.data?.accessToken;
  const chat4 = await call('POST', '/chats', { token: t4, body: { receiverUserId: id2 }, route: '/chats' });
  if (chat4.data?.id) {
    const f4 = new FormData();
    f4.append('text', 'darxosti duyum');
    await call('POST', `/chats/${chat4.data.id}/messages`, { token: t4, form: f4, route: '/chats/{id}/messages', expect: [201, 200] });
  }
  const creq2 = await call('GET', '/chats/requests', { token: t2, route: '/chats/requests' });
  const creqs2: any[] = Array.isArray(creq2.data) ? creq2.data : (creq2.data?.items ?? []);
  if (creqs2[0]?.id) {
    await call('POST', `/chats/requests/${creqs2[0].id}/decline`, { token: t2, route: '/chats/requests/{id}/decline' });
  } else {
    console.log('\n  ⚠ дархости дуюми чат наомад — /chats/requests/{id}/decline назада монд');
  }
  await call('POST', '/chats/messages/bulk-delete', { token: t1, body: { messageIds: [msgId] } });
  await call('DELETE', `/chats/messages/${msgId}`, { token: t1, route: '/chats/messages/{id}', expect: [200, 404] });

  // ── notifications ─────────────────────────────────────────────────────
  const nots = await call('GET', '/notifications', { token: t1 });
  const notId: number | undefined = nots.data?.items?.[0]?.id ?? nots.data?.[0]?.id;
  const nItems: any[] = nots.data?.items ?? nots.data ?? [];
  const likeNot = nItems.find((n) => n.type === 'LIKE_POST');
  check(
    'уведомление: LIKE_POST postThumbUrl дорад',
    !!likeNot && typeof likeNot.postThumbUrl === 'string' && likeNot.postThumbUrl.length > 0,
    `гирифт: ${likeNot?.postThumbUrl}`,
  );

  await call('GET', '/notifications/unread-count', { token: t1 });
  await call('GET', '/notifications/profile-views', { token: t1 });
  if (notId) await call('POST', `/notifications/${notId}/read`, { token: t1, route: '/notifications/{id}/read' });
  await call('POST', '/notifications/read-all', { token: t1 });

  // ── search ────────────────────────────────────────────────────────────
  await call('GET', '/search?q=smoke', { token: t1, route: '/search' });
  await call('GET', '/search/explore', { token: t1 });
  await call('GET', '/search/top?q=smoke', { token: t1, route: '/search/top' });
  await call('GET', '/search/hashtag/test', { token: t1, route: '/search/hashtag/{name}' });

  // ── verification ──────────────────────────────────────────────────────
  await call('GET', '/verification/status', { token: t1 });
  await call('POST', '/verification/start-trial', { token: t1, expect: [200, 201, 400, 409] });
  await call('POST', '/verification/subscribe', { token: t1, expect: [200, 201, 400, 409] });
  await call('POST', '/verification/cancel', { token: t1, expect: [200, 400, 409] });

  // ── live ──────────────────────────────────────────────────────────────
  const live = await call('POST', '/live/start', { token: t1, body: { title: 'Smoke live' }, expect: [201, 200] });
  const liveId: string = live.data?.id ?? live.data?.live?.id;
  await call('GET', '/live/feed', { token: t2 });
  await call('GET', `/live/user/${id1}`, { token: t2, route: '/live/user/{userId}' });
  await call('GET', `/live/${liveId}`, { token: t2, route: '/live/{id}' });
  await call('POST', `/live/${liveId}/join`, { token: t2, route: '/live/{id}/join' });
  await call('GET', `/live/${liveId}/viewers`, { token: t1, route: '/live/{id}/viewers' });
  await call('POST', `/live/${liveId}/comment`, { token: t2, body: { text: 'hi' }, route: '/live/{id}/comment' });
  // Вазифаи 5 (критерия): u2 коммент менависад → u1 бояд ОНРО бинад.
  const liveComments = await call('GET', `/live/${liveId}/comments`, {
    token: t1,
    route: '/live/{id}/comments',
  });
  const lcItems: any[] = liveComments.data?.items ?? liveComments.data ?? [];
  check(
    'эфир: коммети u2 ба u1 намоён аст',
    lcItems.some((c) => c.text === 'hi'),
    `гирифт ${lcItems.length} коммент`,
  );

  await call('POST', `/live/${liveId}/like`, { token: t2, route: '/live/{id}/like' });
  await call('POST', `/live/${liveId}/reaction`, { token: t2, body: { emoji: '🔥' }, route: '/live/{id}/reaction' });
  const jr = await call('POST', `/live/${liveId}/request-join`, { token: t2, route: '/live/{id}/request-join' });
  const reqId: number | undefined = jr.data?.id;

  // Вазифаи 6 (критерия): ХОСТ бояд дархостро дар рӯйхати худ бинад.
  const hostReqs = await call('GET', `/live/${liveId}/requests?status=PENDING`, {
    token: t1,
    route: '/live/{id}/requests',
  });
  const hrItems: any[] = hostReqs.data ?? [];
  check(
    'эфир: хост дархости u2-ро мебинад',
    hrItems.some((r) => r.id === reqId),
    `гирифт ${hrItems.length} дархост, кофтам id=${reqId}`,
  );
  // Ғайри хост → 403, вагарна рӯйхат ба ҳама кушода мешуд.
  await call('GET', `/live/${liveId}/requests`, {
    token: t2,
    route: '/live/{id}/requests',
    expect: [403],
  });

  // Вазифаи 6.2: уведомление бояд liveId ва requestId дошта бошад.
  const hostNots = await call('GET', '/notifications', { token: t1, route: '/notifications' });
  const hnItems: any[] = hostNots.data?.items ?? hostNots.data ?? [];
  const joinNot = hnItems.find((n) => n.type === 'LIVE_JOIN_REQUEST');
  check(
    'уведомление: LIVE_JOIN_REQUEST liveId+requestId дорад',
    !!joinNot && joinNot.liveId === liveId && joinNot.requestId === reqId,
    `гирифт: liveId=${joinNot?.liveId} requestId=${joinNot?.requestId}`,
  );

  if (reqId) {
    await call('POST', `/live/requests/${reqId}/decline`, { token: t1, route: '/live/requests/{id}/decline' });
  }
  const jr2 = await call('POST', `/live/${liveId}/request-join`, { token: t2, route: '/live/{id}/request-join', expect: [200, 201, 409] });
  if (jr2.data?.id)
    await call('POST', `/live/requests/${jr2.data.id}/accept`, { token: t1, route: '/live/requests/{id}/accept' });
  await call('PUT', `/live/${liveId}/camera`, { token: t1, body: { on: false }, route: '/live/{id}/camera' });
  await call('PUT', `/live/${liveId}/audio`, { token: t1, body: { on: false }, route: '/live/{id}/audio' });
  await call('GET', `/live/${liveId}/stats`, { token: t1, route: '/live/{id}/stats' });
  await call('POST', `/live/${liveId}/kick/${id2}`, { token: t1, route: '/live/{id}/kick/{userId}' });
  await call('POST', `/live/${liveId}/leave`, { token: t2, route: '/live/{id}/leave' });
  await call('POST', `/live/${liveId}/end`, { token: t1, route: '/live/{id}/end' });

  // ── admin (u1 → ADMIN мустақиман дар БД) ──────────────────────────────
  await prisma.user.update({ where: { id: id1 }, data: { role: 'ADMIN' } });
  const adminLogin = await call('POST', '/auth/login', { body: { login: u1.userName, password: u1.password }, route: '/auth/login' });
  const ta: string = adminLogin.data?.accessToken ?? t1;
  await call('GET', '/admin/users', { token: ta });
  const reps = await call('GET', '/admin/reports', { token: ta });
  const repId: number | undefined = reps.data?.items?.[0]?.id ?? reps.data?.[0]?.id;
  if (repId) await call('POST', `/admin/reports/${repId}/resolve`, { token: ta, route: '/admin/reports/{id}/resolve' });

  // ── тозакунӣ (роутҳои DELETE низ бояд санҷида шаванд) ─────────────────
  await call('DELETE', `/highlights/${hlId}`, { token: t1, route: '/highlights/{id}' });
  await call('DELETE', `/notes/${noteId}`, { token: t1, route: '/notes/{id}' });
  await call('DELETE', `/stories/${storyId}`, { token: t1, route: '/stories/{id}' });
  await call('DELETE', `/posts/${postId}`, { token: t1, route: '/posts/{id}' });
  await call('DELETE', `/chats/${chatId}`, { token: t1, route: '/chats/{id}' });
  await call('DELETE', `/locations/${locId}`, { token: ta, route: '/locations/{id}' });
  if (upKey) await call('DELETE', `/upload/${encodeURIComponent(upKey)}`, { token: t1, route: '/upload/{key}', expect: [200, 204, 404] });
  await call('POST', '/auth/logout', { token: t1, body: { refreshToken }, expect: [200, 201] });
  await call('DELETE', `/admin/users/${id2}`, { token: ta, route: '/admin/users/{id}' });
  await call('DELETE', '/users/me', { token: ta, expect: [200, 204] });

  report();
}

function report(): void {
  const doc = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'swagger.json'), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const all: string[] = [];
  for (const [p, methods] of Object.entries(doc.paths))
    for (const m of Object.keys(methods))
      if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) all.push(`${m.toUpperCase()} ${p}`);

  const failed = results.filter((r) => !r.ok);
  const missed = all.filter((r) => !hit.has(r));

  console.log('\n\n══════════ ҲИСОБОТ ══════════');
  console.log(`Зада шуд:  ${hit.size}/${all.length} роут · ${results.length} дархост`);
  console.log(`Гузашт:    ${results.length - failed.length}`);
  console.log(`Афтод:     ${failed.length}`);
  const badChecks = checks.filter((c) => !c.ok);
  console.log(`Критерия:  ${checks.length - badChecks.length}/${checks.length} санҷиши маъно`);
  if (badChecks.length) {
    console.log('\n──── КРИТЕРИЯҲОИ НОГУЗАШТА ────');
    for (const c of badChecks) console.log(`  ✗ ${c.name} — ${c.note}`);
  }

  if (failed.length) {
    console.log('\n──── АФТОДАҲО ────');
    for (const f of failed) console.log(`${String(f.status).padEnd(4)} ${f.key.padEnd(46)} ${f.note}`);
  }
  if (missed.length) {
    console.log(`\n──── НАЗАДА (${missed.length}) ────`);
    for (const m of missed) console.log('     ' + m);
  }
  console.log('═════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n💥 Скрипт афтод:', e);
    report();
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
