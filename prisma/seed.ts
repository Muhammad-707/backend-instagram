/* eslint-disable no-console */
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SEED: импорт РЕАЛЬНЫХ данных из softclub-API в нашу базу (Prisma/PostgreSQL)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Источник: https://instagram-api.softclub.tj  (Swagger v1)
 *  Что тянем:  все пользователи (~422), их профили, посты (+медиа, комментарии,
 *              лайки), истории и подписки (followers/following). Плюс синтезируем
 *              чаты с сообщениями между взаимными подписчиками — чтобы на фронте
 *              переписки были «живыми».
 *
 *  СООТВЕТСТВИЕ СХЕМЕ (проверено — schema.prisma менять НЕ нужно):
 *   • softclub-user  { id, userName, fullName, avatar/image, about, gender,
 *                      occupation, dob, subscribersCount } → наши User + Profile.
 *   • У softclub НЕТ e-mail в выдаче и НЕТ поля «slug»: e-mail синтезируем как
 *     `${id}@softclub.import` (наш email обязателен и уникален), роль slug играет
 *     userName. Пароль у всех импортированных — общий (SEED_PASSWORD).
 *   • У softclub НЕТ эндпоинта заметок (zametki) — импортировать нечего, поэтому
 *     заметки этот seed НЕ создаёт (в отличие от постов/историй).
 *   • Реальные чаты softclub приватны (доступны только под токеном их владельца),
 *     поэтому переписки мы СИНТЕЗИРУЕМ между взаимными подписчиками.
 *   • locationId профиля НЕ переносим: id локаций softclub не совпадают с нашими
 *     (был бы битый FK).
 *
 *  Идемпотентность: пишем через upsert по естественным ключам (softclub-id →
 *  наш id для User/Post/Comment/Story, (follower,following) для Follow). Повторный
 *  запуск не плодит дубли и не стирает базу.
 *
 *  Запуск:  npx prisma db seed     (или  npx ts-node prisma/seed.ts)
 *
 *  ENV (все опциональны):
 *     SOFTCLUB_BASE    базовый URL          (default https://instagram-api.softclub.tj)
 *     SEED_USER_LIMIT  сколько юзеров тянуть (0 = все; для теста поставьте 30)
 *     SEED_CONCURRENCY параллельные запросы  (default 8)
 *     SEED_CHATS       синтезировать чаты    (default 1; 0 — выключить)
 *     SEED_PASSWORD    пароль импортированных (default Password123)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Gender, MediaType, MsgType, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─────────────────────────── конфиг ───────────────────────────
const BASE = (process.env.SOFTCLUB_BASE ?? 'https://instagram-api.softclub.tj').replace(/\/+$/, '');
const IMG_BASE = `${BASE}/images`;
const USER_LIMIT = Number(process.env.SEED_USER_LIMIT ?? 0); // 0 = все
const CONCURRENCY = Math.max(1, Number(process.env.SEED_CONCURRENCY ?? 8));
const SEED_CHATS = process.env.SEED_CHATS !== '0';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Password123';
const CHAT_LIMIT = 80; // максимум синтетических диалогов
const LIKES_CAP = 40; // не более стольких лайк-строк на пост

// ─────────────────────────── типы softclub ───────────────────────────
interface Envelope<T> {
  data: T;
  errors: string[] | null;
  statusCode: number;
}
interface Paged<T> {
  pageNumber: number;
  totalPage: number;
  data: T[];
}
interface ScUser {
  id: string;
  userName: string;
  fullName: string;
  avatar: string;
  subscribersCount: number;
}
interface ScProfile {
  image: string;
  gender: string | null;
  firstName: string;
  lastName: string;
  dob: string | null;
  occupation: string | null;
  about: string | null;
}
interface ScComment {
  postCommentId: number;
  userId: string;
  dateCommented: string;
  comment: string;
}
interface ScPost {
  postId: number;
  userId: string;
  datePublished: string;
  images: string[];
  postLikeCount: number;
  comments: ScComment[];
  title: string | null;
  content: string | null;
}
interface ScStory {
  id: number;
  fileName: string;
  createAt: string;
}
interface ScSub {
  userShortInfo: { userId: string };
}

// ─────────────────────────── http ───────────────────────────
let token = '';

async function login(): Promise<void> {
  // Выдача softclub закрыта (401) — нужен любой Bearer. Заводим одноразовый аккаунт.
  const uname = `sc_seed_${Date.now().toString(36)}`;
  await fetch(`${BASE}/Account/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userName: uname,
      fullName: 'Seed Importer',
      email: `${uname}@example.com`,
      password: 'Passw0rd!23',
      confirmPassword: 'Passw0rd!23',
    }),
  }).catch(() => undefined);

  const res = await fetch(`${BASE}/Account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: uname, password: 'Passw0rd!23' }),
  });
  const json = (await res.json()) as Envelope<string>;
  if (!json.data) throw new Error('Не удалось залогиниться в softclub-API');
  token = json.data;
}

/** GET c Bearer + ретраи (сеть/401/429). Возвращает распарсенный JSON или null. */
async function api<T>(path: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401) {
        await login();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch {
      await sleep(300 * (i + 1));
    }
  }
  return null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Пул с ограниченной параллельностью — не заваливаем чужой API. */
async function mapPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < items.length) await fn(items[idx++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, worker));
}

// ─────────────────────────── утилиты ───────────────────────────
const imgUrl = (f?: string | null): string | null => (f && f.trim() ? `${IMG_BASE}/${f}` : null);

const mediaTypeOf = (file: string): MediaType =>
  /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file) ? MediaType.VIDEO : MediaType.IMAGE;

function genderOf(g: string | null): Gender {
  const v = (g ?? '').toLowerCase();
  if (v === 'male') return Gender.MALE;
  if (v === 'female') return Gender.FEMALE;
  return Gender.HIDDEN;
}

function safeDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const clip = (s: string | null | undefined, max: number): string | null =>
  s == null ? null : s.length > max ? s.slice(0, max) : s;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────── шаги ───────────────────────────
async function fetchAllUsers(): Promise<ScUser[]> {
  const users: ScUser[] = [];
  for (let page = 1; ; page++) {
    const res = await api<Paged<ScUser>>(`/User/get-users?PageNumber=${page}&PageSize=100`);
    if (!res?.data?.length) break;
    users.push(...res.data);
    if (page >= res.totalPage) break;
  }
  return USER_LIMIT > 0 ? users.slice(0, USER_LIMIT) : users;
}

async function fetchAllPosts(knownIds: Set<string>): Promise<ScPost[]> {
  const posts: ScPost[] = [];
  // Сначала узнаём число страниц (с упорным ретраем — на всякий случай API «устал»).
  let first = await api<Paged<ScPost>>(`/Post/get-posts?PageNumber=1&PageSize=50`, 5);
  for (let t = 0; !first && t < 3; t++) {
    await sleep(1500);
    first = await api<Paged<ScPost>>(`/Post/get-posts?PageNumber=1&PageSize=50`, 5);
  }
  if (!first?.data) return posts; // API недоступен — вернём пусто (не роняем весь seed)
  const total = first.totalPage || 1;
  const take = (arr: ScPost[]): void => {
    for (const p of arr) if (knownIds.has(p.userId)) posts.push(p);
  };
  take(first.data);
  for (let page = 2; page <= total; page++) {
    const res = await api<Paged<ScPost>>(`/Post/get-posts?PageNumber=${page}&PageSize=50`, 5);
    if (res?.data?.length) take(res.data);
  }
  return posts;
}

async function upsertUsers(users: ScUser[], passwordHash: string): Promise<void> {
  let done = 0;
  await mapPool(users, CONCURRENCY, async (u) => {
    const prof = await api<Envelope<ScProfile>>(`/UserProfile/get-user-profile-by-id?id=${u.id}`);
    const p = prof?.data;
    const avatar = imgUrl(p?.image || u.avatar);
    const fullName =
      u.fullName?.trim() || `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim() || u.userName;
    const dob = safeDate(p?.dob) ?? undefined;
    const profileData = {
      avatarUrl: avatar,
      about: clip(p?.about, 150),
      occupation: clip(p?.occupation, 100),
      gender: genderOf(p?.gender ?? null),
    };

    try {
      await prisma.user.upsert({
        where: { id: u.id },
        update: { fullName },
        create: {
          id: u.id,
          userName: u.userName,
          fullName,
          email: `${u.id}@softclub.import`,
          passwordHash,
          emailVerified: true,
          dob,
        },
      });
    } catch (e) {
      // Конфликт userName с уже существующим (напр. демо-данными) — суффиксуем.
      if (/Unique|P2002/.test(String(e))) {
        await prisma.user
          .upsert({
            where: { id: u.id },
            update: {},
            create: {
              id: u.id,
              userName: `${u.userName}_${u.id.slice(0, 4)}`,
              fullName,
              email: `${u.id}@softclub.import`,
              passwordHash,
              emailVerified: true,
              dob,
            },
          })
          .catch(() => undefined);
      }
    }

    await prisma.profile
      .upsert({ where: { userId: u.id }, update: profileData, create: { userId: u.id, ...profileData } })
      .catch(() => undefined);

    if (++done % 50 === 0) console.log(`   …профилей: ${done}/${users.length}`);
  });
}

async function importPosts(posts: ScPost[], userIds: string[]): Promise<void> {
  const known = new Set(userIds);
  let done = 0;
  for (const post of posts) {
    const caption = clip([post.title, post.content].filter(Boolean).join('\n').trim() || null, 2200);
    const media = (post.images ?? []).filter(Boolean);
    const isReel = media.length === 1 && mediaTypeOf(media[0]) === MediaType.VIDEO;
    const createdAt = safeDate(post.datePublished) ?? new Date();

    try {
      await prisma.post.upsert({
        where: { id: post.postId },
        update: { caption, isReel },
        create: { id: post.postId, userId: post.userId, caption, isReel, createdAt },
      });

      // Медиа перезаписываем целиком — идемпотентно.
      await prisma.postMedia.deleteMany({ where: { postId: post.postId } });
      if (media.length) {
        await prisma.postMedia.createMany({
          data: media.map((f, i) => ({ postId: post.postId, url: imgUrl(f)!, type: mediaTypeOf(f), order: i })),
        });
      }

      // Комментарии — только от известных нам пользователей.
      for (const c of post.comments ?? []) {
        if (!known.has(c.userId)) continue;
        await prisma.comment
          .upsert({
            where: { id: c.postCommentId },
            update: {},
            create: {
              id: c.postCommentId,
              postId: post.postId,
              userId: c.userId,
              text: clip(c.comment, 2200) ?? '…',
              createdAt: safeDate(c.dateCommented) ?? createdAt,
            },
          })
          .catch(() => undefined);
      }

      // Лайки: синтезируем до postLikeCount из случайных пользователей — счётчик «живой».
      const likeN = Math.min(post.postLikeCount ?? 0, LIKES_CAP);
      if (likeN > 0) {
        const likers = shuffle(userIds.filter((id) => id !== post.userId)).slice(0, likeN);
        await prisma.postLike
          .createMany({ data: likers.map((uid) => ({ postId: post.postId, userId: uid })), skipDuplicates: true })
          .catch(() => undefined);
      }
    } catch {
      /* один битый пост не роняет весь импорт */
    }
    if (++done % 50 === 0) console.log(`   …постов: ${done}/${posts.length}`);
  }
}

async function importFollows(users: ScUser[], knownIds: Set<string>): Promise<number> {
  let count = 0;
  await mapPool(users, CONCURRENCY, async (u) => {
    const res = await api<Envelope<ScSub[]>>(`/FollowingRelationShip/get-subscriptions?UserId=${u.id}`);
    for (const s of res?.data ?? []) {
      const targetId = s.userShortInfo?.userId;
      if (!targetId || targetId === u.id || !knownIds.has(targetId)) continue;
      await prisma.follow
        .upsert({
          where: { followerId_followingId: { followerId: u.id, followingId: targetId } },
          update: {},
          create: { followerId: u.id, followingId: targetId },
        })
        .then(() => count++)
        .catch(() => undefined);
    }
  });
  return count;
}

async function importStories(users: ScUser[]): Promise<number> {
  let count = 0;
  await mapPool(users, CONCURRENCY, async (u) => {
    const res = await api<Envelope<{ stories: ScStory[] }>>(`/Story/get-user-stories/${u.id}`);
    for (const st of res?.data?.stories ?? []) {
      const url = imgUrl(st.fileName);
      if (!url) continue;
      const createdAt = safeDate(st.createAt) ?? new Date();
      await prisma.story
        .upsert({
          where: { id: st.id },
          update: {},
          create: {
            id: st.id,
            userId: u.id,
            mediaUrl: url,
            mediaType: mediaTypeOf(st.fileName),
            createdAt,
            expiresAt: new Date(createdAt.getTime() + 24 * 3600_000),
          },
        })
        .then(() => count++)
        .catch(() => undefined);
    }
  });
  return count;
}

const CHAT_LINES = [
  'Салом! Чӣ хел?',
  'Ассалом, бародар 👋',
  'Рахмат, хубам. Худат чӣ хел?',
  'Ана ин пости навамро дидӣ?',
  'Зӯр шудааст 🔥',
  'Рахмат! Пагоҳ вомехӯрем?',
  'Ҳатман, соати чанд?',
  'Соати 18, дар маркази шаҳр.',
  'Окей, розӣ 👍',
  'Онлайн бош, паём мефиристам.',
];

/** Синтетические чаты между взаимными подписчиками — чтобы переписки были «живыми». */
async function synthesizeChats(knownIds: Set<string>): Promise<number> {
  const follows = await prisma.follow.findMany({ select: { followerId: true, followingId: true } });
  const set = new Set(follows.map((f) => `${f.followerId}|${f.followingId}`));
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const f of follows) {
    if (!knownIds.has(f.followerId) || !knownIds.has(f.followingId)) continue;
    if (!set.has(`${f.followingId}|${f.followerId}`)) continue; // нужна взаимность
    const key = [f.followerId, f.followingId].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([f.followerId, f.followingId]);
    if (pairs.length >= CHAT_LIMIT) break;
  }

  let made = 0;
  for (const [a, b] of pairs) {
    const existing = await prisma.chat.findFirst({
      where: {
        isGroup: false,
        AND: [
          { participants: { some: { userId: a } } },
          { participants: { some: { userId: b } } },
        ],
      },
      select: { id: true },
    });
    if (existing) continue;

    const chat = await prisma.chat.create({
      data: { isGroup: false, participants: { create: [{ userId: a }, { userId: b }] } },
      select: { id: true },
    });

    const n = 3 + Math.floor(Math.random() * 4); // 3–6 сообщений
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      await prisma.message.create({
        data: {
          chatId: chat.id,
          senderId: i % 2 === 0 ? a : b,
          text: CHAT_LINES[(i + made) % CHAT_LINES.length],
          type: MsgType.TEXT,
          sentAt: new Date(now - (n - i) * 60_000),
        },
      });
    }
    made++;
  }
  return made;
}

/**
 * КРИТИЧНО: мы вставляем Post/Comment/Story с ЯВНЫМ id (= softclub-id). Postgres
 * при явном id НЕ двигает sequence, поэтому следующий автоинкрементный insert из
 * приложения взял бы уже занятый id → 409/unique violation. После импорта сдвигаем
 * каждую sequence на MAX(id)+1, чтобы приложение снова могло создавать записи.
 */
async function resetSequences(): Promise<void> {
  for (const t of ['Post', 'Comment', 'Story']) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"','id'), (SELECT COALESCE(MAX(id),0) FROM "${t}")+1, false)`,
    );
  }
}

// ─────────────────────────── main ───────────────────────────
async function main(): Promise<void> {
  console.log(`\n🌱 Импорт из softclub-API: ${BASE}\n`);
  await login();
  console.log('✔ Авторизация в softclub-API получена');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  console.log('→ Тяну список пользователей…');
  const users = await fetchAllUsers();
  const knownIds = new Set(users.map((u) => u.id));
  const userIds = users.map((u) => u.id);
  console.log(`✔ Пользователей к импорту: ${users.length}`);

  // Посты тянем ДО «шторма» профильных запросов — пока API «свежий».
  console.log('→ Тяну посты…');
  const posts = await fetchAllPosts(knownIds);
  console.log(`✔ Постов найдено: ${posts.length}`);

  console.log('→ Импорт пользователей и профилей…');
  await upsertUsers(users, passwordHash);

  console.log('→ Импорт постов (медиа, комментарии, лайки)…');
  await importPosts(posts, userIds);
  console.log(`✔ Постов импортировано: ${posts.length}`);

  console.log('→ Импорт подписок (followers/following)…');
  const follows = await importFollows(users, knownIds);
  console.log(`✔ Связей подписки: ${follows}`);

  console.log('→ Импорт историй…');
  const stories = await importStories(users);
  console.log(`✔ Историй импортировано: ${stories}`);

  let chats = 0;
  if (SEED_CHATS) {
    console.log('→ Синтез чатов между взаимными подписчиками…');
    chats = await synthesizeChats(knownIds);
    console.log(`✔ Чатов создано: ${chats}`);
  }

  // Сдвигаем sequence'ы — иначе приложение не сможет создавать новые посты/истории.
  await resetSequences();
  console.log('✔ Sequence-ы (Post/Comment/Story) сброшены на MAX(id)+1');

  const [uc, pc, sc, fc, cc, mc] = await Promise.all([
    prisma.user.count(),
    prisma.post.count(),
    prisma.story.count(),
    prisma.follow.count(),
    prisma.chat.count(),
    prisma.message.count(),
  ]);
  console.log('\n═════════════ ИТОГ (вся база) ═════════════');
  console.log(`  Пользователи: ${uc}`);
  console.log(`  Посты:        ${pc}`);
  console.log(`  Истории:      ${sc}`);
  console.log(`  Подписки:     ${fc}`);
  console.log(`  Чаты:         ${cc}  ·  Сообщения: ${mc}`);
  console.log('═══════════════════════════════════════════');
  console.log(`\n🔑 Пароль всех импортированных: «${PASSWORD}» · вход по userName.\n`);
}

main()
  .catch((e) => {
    console.error('💥 Seed упал:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
