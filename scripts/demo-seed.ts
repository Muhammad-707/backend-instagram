/**
 * Демо-профили БЕЗ стирания базы.
 *
 * Зачем отдельный скрипт, если есть `prisma/seed.ts`: тот начинается с
 * `deleteMany()` по всем таблицам — на пустой локальной базе это правильно, а на
 * проде снёс бы живые аккаунты (на момент написания там лежал `oo1_gm`).
 * Здесь удаления нет вообще: только добавление, и повторный запуск ничего не
 * ломает — существующие юзеры пропускаются по userName.
 *
 * Лента (`/posts/feed`) отдаёт посты ТОЛЬКО тех, на кого ты подписан (плюс свои).
 * Поэтому мало создать профили — иначе в ленте будет пусто. Скрипт подписывает
 * на них аккаунт из `DEMO_FOR` (по умолчанию `oo1_gm`), и они подписываются в
 * ответ. Если такого аккаунта нет — просто пропускаем, это не ошибка.
 *
 * Запуск:
 *   DATABASE_URL=<prod> DEMO_FOR=oo1_gm npx ts-node scripts/demo-seed.ts
 */
import { MediaType, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Password123';
const DEMO_FOR = process.env.DEMO_FOR ?? 'oo1_gm';

/** Картинки внешние (picsum/pravatar): S3 для демо-данных не нужен. */
const PICSUM = (seed: string, w = 1080, h = 1350) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const AVATAR = (seed: string) => `https://i.pravatar.cc/300?u=${seed}`;

/** Детерминированный ПСЧ: один и тот же результат при каждом прогоне. */
let s = 1337;
const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
const rint = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000);

const PEOPLE: { userName: string; fullName: string; about: string }[] = [
  { userName: 'eraj.dev', fullName: 'Eraj Rahimov', about: 'Backend dev · Dushanbe' },
  { userName: 'nigora_k', fullName: 'Nigora Karimova', about: 'Photographer 📷' },
  { userName: 'farrukh.n', fullName: 'Farrukh Nazarov', about: 'Chess & coffee' },
  { userName: 'amina.k', fullName: 'Amina Karimova', about: 'Designer' },
  { userName: 'rustam_t', fullName: 'Rustam Tolibov', about: 'Mountains are calling' },
  { userName: 'shahzoda', fullName: 'Shahzoda Yusupova', about: 'Travel · Food' },
  { userName: 'komron.dev', fullName: 'Komron Sharipov', about: 'Frontend engineer' },
  { userName: 'malika_s', fullName: 'Malika Saidova', about: 'Coffee lover ☕' },
  { userName: 'daler.m', fullName: 'Daler Mirzoev', about: 'Gym every day 💪' },
  { userName: 'zarina.h', fullName: 'Zarina Hakimova', about: 'Art & music' },
  { userName: 'sunny.tj', fullName: 'Sunnat Qodirov', about: 'Sunsets only 🌅' },
  { userName: 'gulnora_a', fullName: 'Gulnora Aliyeva', about: 'Books · Tea' },
  { userName: 'bahrom.k', fullName: 'Bahrom Kamolov', about: 'Cars 🚗' },
  { userName: 'sitora.j', fullName: 'Sitora Jamshedova', about: 'Fashion' },
  { userName: 'jamshed.r', fullName: 'Jamshed Rajabov', about: 'Developer · Runner' },
  { userName: 'madina.n', fullName: 'Madina Nazarova', about: 'Nature lover 🌿' },
  { userName: 'temur.a', fullName: 'Temur Abdullo', about: 'Football ⚽' },
  { userName: 'lola.s', fullName: 'Lola Sharipova', about: 'Cats & code 🐱' },
  { userName: 'firuz.dev', fullName: 'Firuz Ismoilov', about: 'Mobile dev' },
  { userName: 'dilnoza.m', fullName: 'Dilnoza Muhiddinova', about: 'Dance 💃' },
];

const CAPTIONS = [
  'Утро начинается не с кофе ☕ #morning #coffee',
  'Горы зовут 🏔 #mountains #nature',
  'Закат сегодня был особенный 🌅 #sunset',
  'Новый проект в работе #code #dev',
  'Душанбе, ты прекрасен #city',
  'Выходные прошли отлично #family',
  'Тренировка не ждёт 💪 #gym #fitness',
  'Этот вид стоил подъёма #view #travel',
  'Музыка на весь вечер 🎧 #music',
  'Просто хороший день #photography',
];

async function main(): Promise<void> {
  console.log(`\n▶ Демо-профили (БЕЗ стирания). Подписываем: ${DEMO_FOR}\n`);

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const locations = await prisma.location.findMany({ take: 30 });

  // ── Юзеры: существующих не трогаем
  const users = [];
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    const existing = await prisma.user.findUnique({ where: { userName: p.userName } });
    if (existing) {
      users.push(existing);
      skipped++;
      continue;
    }
    const user = await prisma.user.create({
      data: {
        userName: p.userName,
        fullName: p.fullName,
        email: `${p.userName.replace(/[._]/g, '')}@example.com`,
        passwordHash,
        dob: new Date(1995 + (i % 10), i % 12, ((i * 3) % 27) + 1),
        emailVerified: true,
        isVerified: i < 4,
        profile: {
          create: {
            avatarUrl: AVATAR(p.userName),
            about: p.about,
            gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
            locationId: locations.length ? locations[i % locations.length].id : null,
          },
        },
        presence: { create: { isOnline: i % 3 === 0, lastSeenAt: hoursAgo(rint(0, 48)) } },
      },
    });
    users.push(user);
    created++;
  }
  console.log(`  👤 юзеры: создано ${created}, уже были ${skipped} (пароль: ${PASSWORD})`);

  // ── Посты: по 5 на юзера. Пропускаем тех, у кого посты уже есть.
  let posts = 0;
  for (let i = 0; i < users.length; i++) {
    const author = users[i];
    const has = await prisma.post.count({ where: { userId: author.id } });
    if (has > 0) continue;

    for (let k = 0; k < 5; k++) {
      const isReel = k === 4;
      const caption = pick(CAPTIONS);
      const mediaCount = isReel ? 1 : rint(1, 3);
      const post = await prisma.post.create({
        data: {
          userId: author.id,
          caption,
          isReel,
          locationId: locations.length && rnd() > 0.4 ? pick(locations).id : null,
          createdAt: hoursAgo(rint(1, 24 * 20)),
          media: {
            create: Array.from({ length: mediaCount }, (_, m) => ({
              url: PICSUM(`demo_${author.userName}_${k}_${m}`),
              type: MediaType.IMAGE,
              order: m,
              width: 1080,
              height: 1350,
            })),
          },
        },
      });
      posts++;

      // лайки от других демо-юзеров — чтобы счётчики не были нулями
      const likers = users.filter((u) => u.id !== author.id).slice(0, rint(3, 12));
      if (likers.length) {
        await prisma.postLike.createMany({
          data: likers.map((u) => ({ postId: post.id, userId: u.id })),
          skipDuplicates: true,
        });
      }
      // пара комментариев
      const commenters = users.filter((u) => u.id !== author.id).slice(0, rint(1, 3));
      for (const c of commenters) {
        await prisma.comment.create({
          data: { postId: post.id, userId: c.id, text: pick(['🔥🔥🔥', 'Красиво!', 'Топ', '❤️']) },
        });
      }
    }
  }
  console.log(`  🖼 посты: ${posts} новых (по 5 на профиль)`);

  // ── Подписки между демо-юзерами
  const follows: { followerId: string; followingId: string; status: 'ACCEPTED' }[] = [];
  for (const f of users) {
    for (const t of users) {
      if (f.id !== t.id && rnd() > 0.55) {
        follows.push({ followerId: f.id, followingId: t.id, status: 'ACCEPTED' });
      }
    }
  }
  await prisma.follow.createMany({ data: follows, skipDuplicates: true });
  console.log(`  🔗 подписки между демо-юзерами: ${follows.length}`);

  // ── Главное: DEMO_FOR подписывается на всех → лента перестаёт быть пустой
  const me = await prisma.user.findUnique({ where: { userName: DEMO_FOR } });
  if (!me) {
    console.log(`  ⚠ аккаунт «${DEMO_FOR}» не найден — подписки не делаем.`);
    console.log(`    Лента у него будет пустой: /posts/feed отдаёт только подписки.`);
  } else {
    await prisma.follow.createMany({
      data: users
        .filter((u) => u.id !== me.id)
        .map((u) => ({ followerId: me.id, followingId: u.id, status: 'ACCEPTED' as const })),
      skipDuplicates: true,
    });
    await prisma.follow.createMany({
      data: users
        .filter((u) => u.id !== me.id)
        .map((u) => ({ followerId: u.id, followingId: me.id, status: 'ACCEPTED' as const })),
      skipDuplicates: true,
    });
    console.log(`  ✅ ${DEMO_FOR} подписан на ${users.length} профилей и они на него`);
  }

  const totalUsers = await prisma.user.count();
  const totalPosts = await prisma.post.count();
  console.log(`\n  Итого в базе: ${totalUsers} юзеров, ${totalPosts} постов\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
