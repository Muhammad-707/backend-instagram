/* eslint-disable no-console */
import { MediaType, MsgType, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Password123';
const PICSUM = (seed: string, w = 1080, h = 1350) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const AVATAR = (seed: string) => `https://i.pravatar.cc/300?u=${seed}`;
const SAMPLE_VIDEO =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

/** Детерминированный ПСЧ — сид всегда даёт одинаковые данные. */
let seedState = 42;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const rint = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000);

// ---------------------------------------------------------------- музыка (34)
const MUSIC: { title: string; artist: string; duration: number; genre: string }[] = [
  { title: 'Summer Walk', artist: 'Olexy', duration: 154, genre: 'Chill' },
  { title: 'Lofi Study', artist: 'FASSounds', duration: 187, genre: 'Lo-Fi' },
  { title: 'Midnight Drive', artist: 'Coma-Media', duration: 203, genre: 'Synthwave' },
  { title: 'Sunny Days', artist: 'Ashot Danielyan', duration: 142, genre: 'Pop' },
  { title: 'Deep Focus', artist: 'Lexin Music', duration: 231, genre: 'Ambient' },
  { title: 'Street Vibes', artist: 'Penguinmusic', duration: 168, genre: 'Hip-Hop' },
  { title: 'Ocean Breeze', artist: 'SergePavkinMusic', duration: 195, genre: 'Chill' },
  { title: 'Neon Lights', artist: 'Coma-Media', duration: 176, genre: 'Synthwave' },
  { title: 'Coffee Morning', artist: 'Music_Unlimited', duration: 149, genre: 'Jazz' },
  { title: 'Retro Funk', artist: 'QubeSounds', duration: 183, genre: 'Funk' },
  { title: 'Cinematic Rise', artist: 'AlexGrohl', duration: 214, genre: 'Cinematic' },
  { title: 'Happy Ukulele', artist: 'Lesfm', duration: 131, genre: 'Acoustic' },
  { title: 'Trap Nation', artist: 'Top-Flow-Production', duration: 172, genre: 'Trap' },
  { title: 'Piano Moment', artist: 'Keys of Moon', duration: 208, genre: 'Classical' },
  { title: 'Energy Rock', artist: 'AlexGrohl', duration: 165, genre: 'Rock' },
  { title: 'Dreamscape', artist: 'Lexin Music', duration: 246, genre: 'Ambient' },
  { title: 'Dance Floor', artist: 'Penguinmusic', duration: 158, genre: 'EDM' },
  { title: 'Acoustic Sunrise', artist: 'Lesfm', duration: 137, genre: 'Acoustic' },
  { title: 'Night Rider', artist: 'Coma-Media', duration: 189, genre: 'Synthwave' },
  { title: 'Chill Hop', artist: 'FASSounds', duration: 163, genre: 'Lo-Fi' },
  { title: 'Motivation', artist: 'AlexGrohl', duration: 178, genre: 'Rock' },
  { title: 'Soft Rain', artist: 'Music_Unlimited', duration: 222, genre: 'Ambient' },
  { title: 'City Pop', artist: 'QubeSounds', duration: 191, genre: 'Pop' },
  { title: 'Guitar Story', artist: 'Keys of Moon', duration: 174, genre: 'Acoustic' },
  { title: 'Bass Drop', artist: 'Top-Flow-Production', duration: 152, genre: 'EDM' },
  { title: 'Melancholy', artist: 'Keys of Moon', duration: 236, genre: 'Classical' },
  { title: 'Groove Machine', artist: 'QubeSounds', duration: 167, genre: 'Funk' },
  { title: 'Winter Tale', artist: 'SergePavkinMusic', duration: 219, genre: 'Cinematic' },
  { title: 'Skate Park', artist: 'Penguinmusic', duration: 144, genre: 'Punk' },
  { title: 'Slow Motion', artist: 'Olexy', duration: 198, genre: 'Chill' },
  { title: 'Hype Beat', artist: 'Top-Flow-Production', duration: 156, genre: 'Trap' },
  { title: 'Golden Hour', artist: 'Ashot Danielyan', duration: 181, genre: 'Pop' },
  { title: 'Space Travel', artist: 'Lexin Music', duration: 253, genre: 'Ambient' },
  { title: 'Late Night Jazz', artist: 'Music_Unlimited', duration: 227, genre: 'Jazz' },
];

// ---------------------------------------------------------------- локации (30)
const LOCATIONS: { city: string; state: string | null; country: string }[] = [
  { city: 'Dushanbe', state: null, country: 'Tajikistan' },
  { city: 'Khujand', state: 'Sughd', country: 'Tajikistan' },
  { city: 'Bokhtar', state: 'Khatlon', country: 'Tajikistan' },
  { city: 'Kulob', state: 'Khatlon', country: 'Tajikistan' },
  { city: 'Istaravshan', state: 'Sughd', country: 'Tajikistan' },
  { city: 'Tashkent', state: null, country: 'Uzbekistan' },
  { city: 'Samarkand', state: null, country: 'Uzbekistan' },
  { city: 'Bishkek', state: null, country: 'Kyrgyzstan' },
  { city: 'Almaty', state: null, country: 'Kazakhstan' },
  { city: 'Astana', state: null, country: 'Kazakhstan' },
  { city: 'Moscow', state: null, country: 'Russia' },
  { city: 'Saint Petersburg', state: null, country: 'Russia' },
  { city: 'Istanbul', state: null, country: 'Turkey' },
  { city: 'Antalya', state: null, country: 'Turkey' },
  { city: 'Dubai', state: null, country: 'UAE' },
  { city: 'Abu Dhabi', state: null, country: 'UAE' },
  { city: 'Doha', state: null, country: 'Qatar' },
  { city: 'London', state: null, country: 'United Kingdom' },
  { city: 'Paris', state: null, country: 'France' },
  { city: 'Berlin', state: null, country: 'Germany' },
  { city: 'Rome', state: null, country: 'Italy' },
  { city: 'Barcelona', state: 'Catalonia', country: 'Spain' },
  { city: 'Amsterdam', state: null, country: 'Netherlands' },
  { city: 'New York', state: 'NY', country: 'USA' },
  { city: 'Los Angeles', state: 'CA', country: 'USA' },
  { city: 'Miami', state: 'FL', country: 'USA' },
  { city: 'Tokyo', state: null, country: 'Japan' },
  { city: 'Seoul', state: null, country: 'South Korea' },
  { city: 'Singapore', state: null, country: 'Singapore' },
  { city: 'Sydney', state: 'NSW', country: 'Australia' },
];

// ---------------------------------------------------------------- юзеры (20)
const USERS: { userName: string; fullName: string }[] = [
  { userName: 'eraj', fullName: 'Eraj Rahimov' },
  { userName: 'm.ibrohim', fullName: 'Ibrohim Muhammadiev' },
  { userName: 'chessmaster', fullName: 'Farrukh Nazarov' },
  { userName: 'amerika', fullName: 'Amina Karimova' },
  { userName: 'nodira', fullName: 'Nodira Sharipova' },
  { userName: 'daler', fullName: 'Daler Juraev' },
  { userName: 'sitora', fullName: 'Sitora Yusupova' },
  { userName: 'jasur', fullName: 'Jasur Alimov' },
  { userName: 'malika', fullName: 'Malika Rustamova' },
  { userName: 'behruz', fullName: 'Behruz Safarov' },
  { userName: 'zarina', fullName: 'Zarina Hakimova' },
  { userName: 'firuz', fullName: 'Firuz Odilov' },
  { userName: 'shahzoda', fullName: 'Shahzoda Nabieva' },
  { userName: 'komron', fullName: 'Komron Ismoilov' },
  { userName: 'dilnoza', fullName: 'Dilnoza Tursunova' },
  { userName: 'rustam', fullName: 'Rustam Qodirov' },
  { userName: 'nigora', fullName: 'Nigora Salimova' },
  { userName: 'sherzod', fullName: 'Sherzod Mirzoev' },
  { userName: 'gulnora', fullName: 'Gulnora Ahmedova' },
  { userName: 'photolab', fullName: 'Photo Lab Studio' },
];

const CAPTIONS = [
  'Прекрасный день ☀️ #travel #sunset',
  'Утро начинается с кофе ☕ #coffee #morning',
  'Новый проект в работе 💻 #code #dev',
  'Горы зовут 🏔 #mountains #nature',
  'Вечерний город 🌃 #city #night',
  'Тренировка сделана 💪 #gym #fitness',
  'Лучший вид #travel #view',
  'Семья — это всё ❤️ #family',
  'Музыка на весь день 🎧 #music',
  'Просто хорошее фото 📸 #photography',
];

async function main(): Promise<void> {
  console.log('🌱 Seeding…');

  // Порядок важен: сначала зависимые таблицы
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.message.deleteMany(),
    prisma.chatParticipant.deleteMany(),
    prisma.chat.deleteMany(),
    prisma.story.deleteMany(),
    prisma.note.deleteMany(),
    prisma.postHashtag.deleteMany(),
    prisma.hashtag.deleteMany(),
    prisma.postMedia.deleteMany(),
    prisma.post.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.savedMusic.deleteMany(),
    prisma.music.deleteMany(),
    prisma.profile.deleteMany(),
    prisma.user.deleteMany(),
    prisma.location.deleteMany(),
  ]);

  // --- Музыка
  await prisma.music.createMany({
    data: MUSIC.map((m, i) => ({
      title: m.title,
      artist: m.artist,
      genre: m.genre,
      duration: m.duration,
      url: `https://cdn.pixabay.com/audio/track-${i + 1}.mp3`,
      coverUrl: PICSUM(`cover${i}`, 300, 300),
      isTrending: i < 8,
      usesCount: rint(0, 500),
    })),
  });
  const music = await prisma.music.findMany();
  console.log(`  🎵 music: ${music.length}`);

  // --- Локации
  await prisma.location.createMany({
    data: LOCATIONS.map((l) => ({
      city: l.city,
      state: l.state,
      country: l.country,
      lat: Number((rnd() * 180 - 90).toFixed(4)),
      lng: Number((rnd() * 360 - 180).toFixed(4)),
    })),
  });
  const locations = await prisma.location.findMany();
  console.log(`  📍 locations: ${locations.length}`);

  // --- Юзеры + профили
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const users = [];
  for (let i = 0; i < USERS.length; i++) {
    const u = USERS[i];
    const user = await prisma.user.create({
      data: {
        userName: u.userName,
        fullName: u.fullName,
        email: `${u.userName.replace('.', '')}@example.com`,
        passwordHash,
        dob: new Date(1995 + (i % 10), i % 12, ((i * 3) % 27) + 1),
        emailVerified: true,
        isPrivate: i === 4 || i === 12, // nodira и shahzoda — приватные
        isVerified: i < 3,
        role: i === 0 ? 'ADMIN' : 'USER',
        profile: {
          create: {
            avatarUrl: AVATAR(u.userName),
            about: `${u.fullName} · Dushanbe`,
            website: i % 4 === 0 ? `https://${u.userName}.tj` : null,
            gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
            locationId: locations[i % locations.length].id,
          },
        },
        presence: { create: { isOnline: i % 3 === 0, lastSeenAt: hoursAgo(rint(0, 48)) } },
      },
    });
    users.push(user);
  }
  console.log(`  👤 users: ${users.length} (пароль у всех: ${PASSWORD})`);

  // --- Подписки: каждый подписан на 5-12 случайных
  const followData: { followerId: string; followingId: string; status: 'ACCEPTED' | 'PENDING' }[] =
    [];
  const seen = new Set<string>();
  for (const follower of users) {
    const count = rint(5, 12);
    for (let i = 0; i < count; i++) {
      const target = pick(users);
      const key = `${follower.id}:${target.id}`;
      if (target.id === follower.id || seen.has(key)) continue;
      seen.add(key);
      followData.push({
        followerId: follower.id,
        followingId: target.id,
        status: target.isPrivate ? (rnd() > 0.5 ? 'PENDING' : 'ACCEPTED') : 'ACCEPTED',
      });
    }
  }
  await prisma.follow.createMany({ data: followData });
  console.log(`  🔗 follows: ${followData.length}`);

  // --- Хэштеги
  const tagNames = [
    'travel',
    'sunset',
    'coffee',
    'morning',
    'code',
    'dev',
    'mountains',
    'nature',
    'city',
    'night',
    'gym',
    'fitness',
    'view',
    'family',
    'music',
    'photography',
  ];
  await prisma.hashtag.createMany({ data: tagNames.map((name) => ({ name })) });
  const hashtags = await prisma.hashtag.findMany();

  // --- Посты (100: ~70 фото/карусель, ~30 reels)
  let postCount = 0;
  for (let i = 0; i < 100; i++) {
    const author = users[i % users.length];
    const isReel = i % 10 >= 7;
    const caption = pick(CAPTIONS);
    const mediaCount = isReel ? 1 : rint(1, 3);

    const post = await prisma.post.create({
      data: {
        userId: author.id,
        caption,
        isReel,
        locationId: rnd() > 0.4 ? pick(locations).id : null,
        musicId: isReel || rnd() > 0.7 ? pick(music).id : null,
        createdAt: hoursAgo(rint(1, 24 * 30)),
        media: {
          create: Array.from({ length: mediaCount }, (_, k) => ({
            url: isReel ? SAMPLE_VIDEO : PICSUM(`post${i}_${k}`),
            type: isReel ? MediaType.VIDEO : MediaType.IMAGE,
            order: k,
            width: isReel ? 720 : 1080,
            height: isReel ? 1280 : 1350,
            duration: isReel ? 15 : null,
            thumbUrl: isReel ? PICSUM(`reelthumb${i}`, 720, 1280) : null,
          })),
        },
      },
    });
    postCount++;

    // хэштеги из подписи
    const inCaption = hashtags.filter((h) => caption.includes(`#${h.name}`));
    if (inCaption.length) {
      await prisma.postHashtag.createMany({
        data: inCaption.map((h) => ({ postId: post.id, hashtagId: h.id })),
      });
      await prisma.hashtag.updateMany({
        where: { id: { in: inCaption.map((h) => h.id) } },
        data: { postsCount: { increment: 1 } },
      });
    }

    // лайки и комментарии
    const likers = users.filter(() => rnd() > 0.6);
    if (likers.length) {
      await prisma.postLike.createMany({
        data: likers.map((u) => ({ postId: post.id, userId: u.id })),
        skipDuplicates: true,
      });
    }
    const commentCount = rint(0, 4);
    for (let c = 0; c < commentCount; c++) {
      await prisma.comment.create({
        data: {
          postId: post.id,
          userId: pick(users).id,
          text: pick(['Огонь 🔥', 'Красота!', 'Круто 👏', 'Где это?', 'Супер фото']),
          createdAt: hoursAgo(rint(1, 100)),
        },
      });
    }
  }
  console.log(`  📷 posts: ${postCount} (с медиа, лайками, комментариями)`);

  // --- Истории (у 10 юзеров, живые 24ч)
  let storyCount = 0;
  for (const author of users.slice(0, 10)) {
    for (let s = 0; s < rint(1, 3); s++) {
      const createdAt = hoursAgo(rint(1, 20));
      await prisma.story.create({
        data: {
          userId: author.id,
          mediaUrl: PICSUM(`story${author.userName}${s}`, 1080, 1920),
          mediaType: MediaType.IMAGE,
          duration: 5,
          musicId: rnd() > 0.5 ? pick(music).id : null,
          musicStartSec: 12,
          closeFriendsOnly: rnd() > 0.8,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 24 * 3600_000),
        },
      });
      storyCount++;
    }
  }
  console.log(`  📸 stories: ${storyCount}`);

  // --- Заметки (у 8 юзеров)
  for (const author of users.slice(0, 8)) {
    const createdAt = hoursAgo(rint(1, 20));
    await prisma.note.create({
      data: {
        userId: author.id,
        text: pick(['Слушаю музыку 🎧', 'Пишу код…', 'Кто в Душанбе?', 'Хорошего дня ✨']),
        musicId: rnd() > 0.5 ? pick(music).id : null,
        bgColor: pick(['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A']),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 24 * 3600_000),
      },
    });
  }
  console.log('  📝 notes: 8');

  // --- Чаты (5 диалогов с сообщениями)
  for (let c = 0; c < 5; c++) {
    const a = users[c];
    const b = users[c + 10];
    const chat = await prisma.chat.create({
      data: {
        participants: { create: [{ userId: a.id }, { userId: b.id }] },
      },
    });
    const msgCount = rint(4, 10);
    for (let m = 0; m < msgCount; m++) {
      await prisma.message.create({
        data: {
          chatId: chat.id,
          senderId: m % 2 === 0 ? a.id : b.id,
          type: MsgType.TEXT,
          text: pick(['Привет!', 'Как дела?', 'Отправил файл', 'Увидимся завтра', 'Ок 👍']),
          sentAt: hoursAgo(msgCount - m),
        },
      });
    }
  }
  console.log('  💬 chats: 5');

  console.log('✅ Seed завершён');
}

main()
  .catch((e: unknown) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
