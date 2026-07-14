# ТЗ — Instagram Backend (NestJS + Prisma + PostgreSQL)

**Проект:** собственный backend для Instagram-клона
**Замещает:** `https://instagram-api.softclub.tj` (все 57 endpoint'ов воспроизводятся — но **починенными**)
**Плюс:** ~60 новых endpoint'ов (истории с музыкой, уведомления, realtime-чат, заметки, актуальное, приватность, верификация)
**Frontend:** уже готов (Next.js 16, отдельный репозиторий) — трогать его нельзя, пока backend не будет готов

---

## 1. Стек

| Слой | Технология | Зачем |
|---|---|---|
| Framework | **NestJS 11** (TypeScript) | модули, DI, guards, тот же язык, что и фронт |
| ORM | **Prisma** | schema-first, миграции, типы автоматом |
| БД | **PostgreSQL 16** | |
| Кэш / presence / rate-limit | **Redis** | онлайн-статус, счётчики, очередь уведомлений |
| Realtime | **Socket.IO** (`@nestjs/websockets`) | чат, уведомления, typing, presence, WebRTC-сигналинг |
| Файлы | **MinIO / S3** (локально — диск через Multer) | фото, видео, аудио |
| Обработка медиа | **sharp** (изображения) + **fluent-ffmpeg** (видео: превью, длительность, сжатие) | |
| Auth | **JWT access (15 мин) + refresh (30 дней)** + bcrypt | |
| Почта | **Nodemailer** (SMTP / Mailtrap в dev) | сброс пароля, код подтверждения |
| Валидация | **class-validator** + `ValidationPipe` (whitelist) | |
| Документация | **@nestjs/swagger** | Swagger генерируется автоматически и **не врёт** |
| Очереди | **BullMQ** (Redis) | удаление историй/заметок через 24ч, рассылка уведомлений |
| Планировщик | **@nestjs/schedule** | cron: чистка истёкших историй/заметок/триалов |
| Тесты | Jest + Supertest | e2e на ключевые флоу |
| Деплой | Docker Compose (api + postgres + redis + minio) | |

---

## 2. Главный принцип: чинить, а не копировать

Frontend уже нашёл **21 баг** старого API (`BACKEND_BUGS.md`). Наш backend их не повторяет:

| # | Баг softclub | Как у нас |
|---|---|---|
| 1 | `errors: ["success"]` при успехе | `errors` — **только** при ошибке. Успех → `{ data, errors: null, statusCode: 200 }` |
| 2 | `delete-user-image-profile` → `image = null` → login падает 500 | Аватар = `null` допустим, login работает. Возвращается дефолтный аватар |
| 3 | `get-following-post` без `UserId` → пустая лента | userId берётся **из JWT**, параметр не нужен |
| 4 | `get-following-post` игнорирует пагинацию | Курсорная пагинация везде (`cursor` + `limit`) |
| 5 | Лента отвечает 21 сек | Индексы + пагинация + `select` только нужного → < 300 мс |
| 6 | `comments[].userName` всегда `null` | Комментарий всегда с автором (`include: { user: true }`) |
| 7 | `get-my-posts` — голый массив без конверта | Единый конверт `Response<T>` на **всех** endpoint'ах |
| 8 | `gender` читается строкой, пишется числом | Единый enum `MALE / FEMALE / OTHER / HIDDEN` в обе стороны |
| 9 | `delete-user` → 403 всем | Пользователь удаляет **свой** аккаунт (soft-delete + 30 дней на восстановление) |
| 10 | `update-Location` → 400 AutoMapper | Работает |
| 11 | `delete-message` не проверяет владельца | `Guard` проверяет `message.senderId === user.id` |
| 12 | Опечатки `massageId`, `sendMassageDate` | Правильные имена: `messageId`, `sentAt` |
| 13 | `get-chats` без последнего сообщения / времени / unread | Отдаёт `lastMessage`, `lastMessageAt`, `unreadCount`, `peer`, `isOnline` |
| 14 | Нет realtime | Socket.IO |
| 15 | `LikeStory` возвращает строку `"Liked"` | `{ liked: boolean, likesCount: number }` |
| 16 | `viewerDto` — только счётчики, нет списка зрителей | Полный список зрителей с лайками и реакциями |
| 17 | API не знает, видел ли **я** историю | `isViewed` считается на сервере по `StoryView` |
| 18 | Пустое сообщение принимается | Валидация: нужен текст **или** медиа |
| 19 | Нет `createdAt` у истории поиска | `createdAt` везде |
| 20 | Swagger пустой (`responses.200` без схемы) | Swagger генерируется из DTO — всегда точный |
| 21 | Пагинация только `PageNumber/PageSize` | **Cursor-based** (ленты, чаты, комментарии), offset — только для админских списков |

---

## 3. Формат ответа и ошибок

```ts
// Успех
{ "data": T, "errors": null, "statusCode": 200 }

// Ошибка
{ "data": null, "errors": ["User not found"], "statusCode": 404, "code": "USER_NOT_FOUND" }
```
Реализация: глобальный `ResponseInterceptor` + `AllExceptionsFilter`.

**Пагинация (курсорная):**
```ts
{ "data": { "items": T[], "nextCursor": "string | null", "hasMore": boolean }, "errors": null, "statusCode": 200 }
```

---

## 4. Схема БД (Prisma)

### 4.1 Пользователь и аккаунт
```prisma
model User {
  id              String   @id @default(uuid())
  userName        String   @unique          // индекс
  fullName        String
  email           String   @unique
  phone           String?  @unique          // из скрина регистрации: телефон ИЛИ email
  passwordHash    String
  dob             DateTime?                 // Дата рождения (есть на скрине регистрации)
  emailVerified   Boolean  @default(false)
  role            Role     @default(USER)   // USER | ADMIN
  isPrivate       Boolean  @default(false)  // закрытый аккаунт
  isVerified      Boolean  @default(false)  // синяя галочка
  isDeleted       Boolean  @default(false)  // soft-delete, 30 дней
  deletedAt       DateTime?
  createdAt       DateTime @default(now())

  profile         Profile?
  presence        Presence?
  verification    Verification?
  // relations: posts, stories, notes, chats, followers, following, blocks, ...
}

model Profile {
  userId          String   @id
  avatarUrl       String?
  about           String?  @db.VarChar(150)   // "О себе — 3/150"
  website         String?                      // "Сайт"
  occupation      String?
  gender          Gender   @default(HIDDEN)    // MALE | FEMALE | OTHER | HIDDEN
  locationId      Int?
  showThreadsBadge      Boolean @default(false)  // "Показывать значок Threads"
  isAiAuthor            Boolean @default(false)  // "Автор ИИ"
  showAccountSuggestions Boolean @default(true)  // "Рекомендации аккаунтов в профиле"
  user            User     @relation(...)
}

model RefreshToken { id, userId, tokenHash, expiresAt, revokedAt, userAgent, ip }
model EmailCode    { id, userId, code(6), type: RESET_PASSWORD|VERIFY_EMAIL, expiresAt(15м), usedAt }
model Presence     { userId @id, isOnline Boolean, lastSeenAt DateTime }  // + Redis
model Verification { userId @id, status: TRIAL|ACTIVE|EXPIRED|CANCELED, trialEndsAt, currentPeriodEnd, priceUsd(1000) }
model Payment      { id, userId, amountUsd, status: PENDING|PAID|FAILED, provider: MOCK, createdAt }
```

### 4.2 Подписки, приватность, блокировки
```prisma
model Follow {
  id           String @id @default(uuid())
  followerId   String        // кто подписался
  followingId  String        // на кого
  status       FollowStatus  // ACCEPTED | PENDING  (PENDING — для закрытых аккаунтов)
  createdAt    DateTime
  @@unique([followerId, followingId])
}

model Block       { blockerId, blockedId, createdAt  @@unique([blockerId, blockedId]) }
model CloseFriend { userId, friendId, createdAt      @@unique([userId, friendId]) }  // «Близкие друзья»
```
**Правила приватности:**
- `isPrivate = true` → `Follow.status = PENDING`, посты/истории/reels видит **только принятый подписчик**
- Заблокированный не видит профиль, не пишет в чат, не находит в поиске
- Публичный аккаунт → `ACCEPTED` сразу

### 4.3 Посты, медиа, музыка
```prisma
model Post {
  id          Int      @id @default(autoincrement())
  userId      String
  caption     String?  @db.VarChar(2200)
  locationId  Int?
  musicId     Int?                     // музыка на посте/reels
  isReel      Boolean  @default(false) // reels = вертикальное видео
  isArchived  Boolean  @default(false)
  createdAt   DateTime @default(now())

  media       PostMedia[]
  likes       PostLike[]
  comments    Comment[]
  views       PostView[]
  favorites   Favorite[]
  shares      Share[]
  taggedUsers PostTag[]     // «Отметить людей»
  hashtags    PostHashtag[]
  @@index([userId, createdAt])
}

model PostMedia {
  id        Int    @id
  postId    Int
  url       String
  type      MediaType   // IMAGE | VIDEO
  order     Int         // порядок в карусели
  width     Int?
  height    Int?
  duration  Float?      // для видео
  thumbUrl  String?     // постер видео (ffmpeg)
  filter    String?     // применённый фильтр (клиент шлёт имя)
  @@index([postId, order])
}

model Music {          // 30+ треков в seed
  id        Int    @id
  title     String
  artist    String
  url       String   // mp3
  coverUrl  String
  duration  Int      // сек
  genre     String?
  isTrending Boolean @default(false)
}
model SavedMusic { userId, musicId, createdAt }   // «Сохранённая музыка» в профиле

model PostLike  { postId, userId, createdAt  @@unique([postId, userId]) }
model PostView  { postId, userId, viewedAt   @@unique([postId, userId]) }
model Favorite  { id, postId, userId, collectionId?, createdAt }   // «Сохранённое»
model Collection{ id, userId, name, coverUrl? }                    // папки сохранённого
model Share     { id, postId, userId, toUserId?, toStory Boolean } // «Отправить» / «Поделиться в историю»
model PostTag   { postId, userId }                                 // «Отмеченные» (таб в профиле)

model Comment {
  id        Int      @id
  postId    Int
  userId    String
  parentId  Int?          // ответы на комментарии
  text      String   @db.VarChar(2200)
  createdAt DateTime
  likes     CommentLike[]
  @@index([postId, createdAt])
}
model CommentLike { commentId, userId }

model Hashtag     { id, name @unique, postsCount }
model PostHashtag { postId, hashtagId }
model Mention     { postId?, commentId?, userId }   // @упоминания
```

### 4.4 Истории (полный набор из твоих идей)
```prisma
model Story {
  id              Int      @id
  userId          String
  mediaUrl        String
  mediaType       MediaType         // IMAGE | VIDEO
  thumbUrl        String?
  duration        Float    @default(5)   // сек; для видео — реальная
  musicId         Int?                   // музыка на истории
  musicStartSec   Float?                 // с какой секунды играет
  overlays        Json?                  // текст/стикеры/эффекты: [{type,text,x,y,rotate,scale,color,font}]
  filter          String?
  closeFriendsOnly Boolean @default(false)  // «Близкие друзья» (зелёное кольцо)
  fromPostId      Int?                      // «Поделиться постом в историю»
  createdAt       DateTime @default(now())
  expiresAt       DateTime                  // createdAt + 24ч  ← cron удаляет
  @@index([userId, createdAt])
}

model StoryView     { storyId, userId, viewedAt  @@unique([storyId, userId]) }
model StoryLike     { storyId, userId, createdAt @@unique([storyId, userId]) }
model StoryReaction { id, storyId, userId, emoji }        // ❤️😂😮😢👏🔥
model StoryReply    { id, storyId, userId, text }         // ответ уходит в ЧАТ (сообщение с превью истории)

model Highlight     { id, userId, title, coverUrl, createdAt }   // «Актуальное»
model HighlightStory{ highlightId, storyId, order }              // истории живут вечно внутри актуального
```
**Логика историй:**
- Одна загрузка = **несколько историй сразу** (multipart, до 10 файлов) → каждая своя `Story`
- `expiresAt = now + 24h`; BullMQ-задача удаляет медиа и запись
- Добавление в `Highlight` **спасает** историю от удаления (медиа не трогаем)
- Кольцо: цветное = есть непросмотренная (`StoryView` нет), серое = все просмотрены, **зелёное** = `closeFriendsOnly`
- Список зрителей: кто смотрел + кто лайкнул + реакции — **только автору**
- Reels/пост → в историю: `fromPostId`

### 4.5 Заметки (Notes)
```prisma
model Note {
  id        Int      @id
  userId    String
  text      String?  @db.VarChar(60)
  musicId   Int?                      // «музыка в заметке»
  bgColor   String?                   // фон заметки
  createdAt DateTime
  expiresAt DateTime                  // +24ч, cron удаляет
}
```
Видна подписчикам (и близким друзьям), показывается над списком чатов. CRUD + автоудаление.

### 4.6 Чат
```prisma
model Chat {
  id            Int      @id
  isGroup       Boolean  @default(false)
  title         String?
  theme         String   @default("default")  // «Тема чата»
  createdAt     DateTime
  participants  ChatParticipant[]
  messages      Message[]
}

model ChatParticipant {
  chatId      Int
  userId      String
  nickname    String?           // «Никнеймы»
  isMuted     Boolean @default(false)   // «Выключить уведомления»
  lastReadAt  DateTime?                 // → unreadCount
  joinedAt    DateTime
  @@id([chatId, userId])
}

model Message {
  id          Int       @id
  chatId      Int
  senderId    String
  text        String?   @db.VarChar(2000)
  type        MsgType   // TEXT | IMAGE | VIDEO | AUDIO | STICKER | POST_SHARE | STORY_REPLY | CALL
  mediaUrl    String?
  duration    Float?              // голосовое
  replyToId   Int?                // ответ на сообщение
  sharedPostId Int?               // отправленный пост
  storyId     Int?                // ответ на историю
  editedAt    DateTime?           // «Редактировать сообщение»
  isDeleted   Boolean @default(false)   // soft-delete, «Удалить»
  sentAt      DateTime @default(now())
  reactions   MessageReaction[]
  reads       MessageRead[]
  @@index([chatId, sentAt])
}

model MessageReaction { messageId, userId, emoji  @@unique([messageId, userId]) }
model MessageRead     { messageId, userId, readAt }        // «Просмотрено»
model MessageRequest  { id, fromUserId, toUserId, chatId, status: PENDING|ACCEPTED|DECLINED }  // «Запросы»
model CallSession     { id, chatId, callerId, type: AUDIO|VIDEO, status, startedAt, endedAt }  // WebRTC-сигналинг
```
**Realtime (Socket.IO namespace `/chat`):**
`message:new` · `message:edited` · `message:deleted` · `message:reaction` · `message:read` ·
`typing:start` / `typing:stop` · `presence:online` / `presence:offline` (+ `lastSeenAt`) ·
`call:offer` / `call:answer` / `call:ice` / `call:end` (WebRTC — сервер только сигналит)

### 4.7 Уведомления
```prisma
model Notification {
  id        Int      @id
  userId    String              // кому
  actorId   String              // кто сделал
  type      NotifType
  postId    Int?
  commentId Int?
  storyId   Int?
  chatId    Int?
  isRead    Boolean @default(false)
  createdAt DateTime
  @@index([userId, createdAt])
}

enum NotifType {
  LIKE_POST · COMMENT_POST · REPLY_COMMENT · LIKE_COMMENT · MENTION ·
  FOLLOW · FOLLOW_REQUEST · FOLLOW_ACCEPTED ·
  LIKE_STORY · STORY_REACTION · STORY_REPLY ·
  SHARE_POST · SAVE_POST · TAG_POST ·
  PROFILE_VIEW ·            // «кто заходил в твой профиль»
  NEW_POST_FROM_FOLLOWING · VERIFICATION_TRIAL_ENDING
}

model ProfileView { id, profileUserId, viewerId, viewedAt }   // «кто зашёл в профиль»
```
Уведомление создаётся событием (`EventEmitter2`) → пишется в БД → пушится в сокет `/notifications`.
**Свои действия не уведомляют себя.** Заблокированные не уведомляют.

### 4.8 Ваши действия / история / прочее
```prisma
model ActivityLog { id, userId, type: LIKE|COMMENT|VIEW|SHARE|SAVE|SEARCH, entityId, createdAt }
model SearchHistory     { id, userId, text, createdAt }
model UserSearchHistory { id, userId, searchedUserId, createdAt }
model Location  { id, city, state, zipCode, country, lat?, lng? }
model Report    { id, reporterId, targetType: POST|USER|COMMENT|STORY|CHAT, targetId, reason, createdAt }  // «Пожаловаться»
```

---

## 5. Полный список endpoint'ов

Формат: все под `/api`. 🔵 = был в старом Swagger (57 шт.), 🟢 = новый.

### 5.1 Auth (`/auth`) — 11
| | Метод | Путь | Описание |
|---|---|---|---|
| 🔵 | POST | `/auth/register` | userName, fullName, email **или** phone, password, confirmPassword, **dob** (со скрина регистрации) |
| 🔵 | POST | `/auth/login` | userName **или** email **или** phone + password → `{ accessToken, refreshToken, user }` |
| 🟢 | POST | `/auth/refresh` | обновление токена |
| 🟢 | POST | `/auth/logout` | отзыв refresh-токена |
| 🔵 | POST | `/auth/forgot-password` | **POST**, не DELETE. Отправляет **6-значный код на email** |
| 🟢 | POST | `/auth/verify-code` | проверка кода → одноразовый `resetToken` |
| 🔵 | POST | `/auth/reset-password` | resetToken + newPassword |
| 🔵 | PUT | `/auth/change-password` | oldPassword + newPassword (авторизован) |
| 🟢 | POST | `/auth/check-username` | занят / свободен (live-валидация формы регистрации) |
| 🟢 | GET | `/auth/me` | текущий пользователь + профиль |
| 🟢 | POST | `/auth/resend-code` | rate-limit 1/мин |

### 5.2 Users (`/users`) — 12
🔵 `GET /users` (поиск: q, cursor, limit) · 🔵 `DELETE /users/me` (soft-delete, 30 дней) ·
🔵 `POST /users/search-history` · 🔵 `GET /users/search-history` · 🔵 `DELETE /users/search-history/:id` · 🔵 `DELETE /users/search-history` ·
🔵 `POST /users/search-history/user` · 🔵 `GET /users/search-history/users` · 🔵 `DELETE /users/search-history/user/:id` · 🔵 `DELETE /users/search-history/users` ·
🟢 `GET /users/suggestions` («Рекомендации для вас» — с полем `followedBy: [«Подписаны: m.ibrohim»]`) ·
🟢 `POST /users/:id/report`

### 5.3 Profile (`/profile`) — 14
🔵 `GET /profile/me` · 🔵 `GET /profile/:userId` (+ `isFollowing`, `isFollowedBy`, `isBlocked`, `isPrivate`, `hasRequestPending`) ·
🔵 `GET /profile/:userId/is-following` · 🔵 `PUT /profile` (about, website, gender, occupation, dob, showThreadsBadge, isAiAuthor, showAccountSuggestions) ·
🔵 `PUT /profile/avatar` (multipart) · 🔵 `DELETE /profile/avatar` (**не ломает login!**) ·
🔵 `GET /profile/favorites` (Сохранённое) · 🟢 `GET /profile/:userId/posts` · 🟢 `GET /profile/:userId/reels` ·
🟢 `GET /profile/:userId/tagged` (Отмеченные) · 🟢 `GET /profile/me/reposts` (Репосты) ·
🟢 `GET /profile/me/saved-music` · 🟢 `PUT /profile/privacy` (isPrivate on/off) ·
🟢 `GET /profile/me/activity` («Ваши действия»: лайки / комментарии / просмотры / поиск, с фильтром по дате)

### 5.4 Follow (`/follow`) — 10
🔵 `GET /follow/:userId/followers` · 🔵 `GET /follow/:userId/following` ·
🔵 `POST /follow/:userId` (публичный → сразу; приватный → `PENDING` + уведомление) ·
🔵 `DELETE /follow/:userId` (отписка) ·
🟢 `GET /follow/requests` (входящие заявки) · 🟢 `POST /follow/requests/:id/accept` · 🟢 `POST /follow/requests/:id/decline` ·
🟢 `DELETE /follow/followers/:userId` («Удалить подписчика») ·
🟢 `POST /follow/:userId/block` · 🟢 `DELETE /follow/:userId/block` · 🟢 `GET /follow/blocked`

### 5.5 Close Friends (`/close-friends`) — 3 🟢
`GET /close-friends` · `POST /close-friends/:userId` · `DELETE /close-friends/:userId`

### 5.6 Posts (`/posts`) — 20
🔵 `GET /posts` (лента Explore: cursor) · 🔵 `GET /posts/reels` · 🔵 `GET /posts/:id` · 🔵 `GET /posts/my` ·
🔵 `GET /posts/feed` (**лента подписок — userId из JWT, курсорная пагинация, работает!**) ·
🔵 `POST /posts` (multipart: до 10 медиа, caption, locationId, musicId, taggedUserIds[], filters[], isReel) ·
🔵 `DELETE /posts/:id` · 🔵 `POST /posts/:id/like` (toggle → `{ liked, likesCount }`) · 🔵 `POST /posts/:id/view` ·
🔵 `POST /posts/:id/comments` · 🔵 `DELETE /posts/comments/:id` · 🔵 `POST /posts/:id/favorite` (toggle) ·
🟢 `PUT /posts/:id` (редактировать подпись) · 🟢 `POST /posts/:id/archive` / `DELETE /posts/:id/archive` ·
🟢 `GET /posts/:id/likes` (кто лайкнул) · 🟢 `GET /posts/:id/comments` (cursor, с ответами) ·
🟢 `POST /posts/comments/:id/like` · 🟢 `POST /posts/comments/:id/reply` ·
🟢 `POST /posts/:id/share` (отправить в чат / в историю / «Копировать ссылку») ·
🟢 `POST /posts/:id/report` («Пожаловаться»)

### 5.7 Stories (`/stories`) — 16
🔵 `GET /stories` (рейл: сгруппировано по авторам, `isViewed`, `hasCloseFriends`) ·
🔵 `GET /stories/user/:userId` · 🔵 `GET /stories/my` · 🔵 `GET /stories/:id` ·
🔵 `POST /stories` (**multipart, до 10 файлов сразу**; image **и video**; musicId, musicStartSec, overlays(text/стикеры/эффекты), filter, closeFriendsOnly, fromPostId) ·
🔵 `POST /stories/:id/like` (toggle → `{ liked, likesCount }`) · 🔵 `POST /stories/:id/view` · 🔵 `DELETE /stories/:id` ·
🟢 `GET /stories/:id/viewers` (**полный список: кто смотрел + лайкнул + реакция**) ·
🟢 `POST /stories/:id/reaction` (emoji) · 🟢 `POST /stories/:id/reply` (уходит **в чат** сообщением) ·
🟢 `GET /stories/archive` (свои истёкшие) ·
🟢 `GET /highlights/:userId` · 🟢 `POST /highlights` (title, cover, storyIds[]) · 🟢 `PUT /highlights/:id` · 🟢 `DELETE /highlights/:id`

### 5.8 Notes (`/notes`) — 4 🟢
`GET /notes` (свои + подписок) · `POST /notes` (text ≤60, musicId, bgColor; TTL 24ч) · `PUT /notes/:id` · `DELETE /notes/:id`

### 5.9 Music (`/music`) — 5 🟢
`GET /music` (поиск, cursor) · `GET /music/trending` · `GET /music/:id` ·
`POST /music/:id/save` / `DELETE /music/:id/save` (Сохранённая музыка)
**Seed: 30+ треков** (royalty-free: Pixabay Music / Free Music Archive) + обложки + длительность.

### 5.10 Chat (`/chats`) — 18
🔵 `GET /chats` (**+ lastMessage, lastMessageAt, unreadCount, peer, isOnline, lastSeenAt**) ·
🔵 `GET /chats/:id` (cursor, oldest→newest) · 🔵 `POST /chats` (receiverUserId, идемпотентно) ·
🔵 `POST /chats/:id/messages` (**POST**, multipart: text / image / video / audio / sticker; replyToId) ·
🔵 `DELETE /chats/messages/:id` (**только своё!**) · 🔵 `DELETE /chats/:id` ·
🟢 `PUT /chats/messages/:id` («Редактировать сообщение», ≤ 15 мин) ·
🟢 `POST /chats/messages/bulk-delete` (**удалить несколько выбранных**) ·
🟢 `POST /chats/messages/:id/reaction` / `DELETE …/reaction` ·
🟢 `POST /chats/:id/read` («Просмотрено») ·
🟢 `PUT /chats/:id/theme` (тема чата) · 🟢 `PUT /chats/:id/nickname` (Никнеймы) · 🟢 `PUT /chats/:id/mute` ·
🟢 `GET /chats/requests` («Запросы») · 🟢 `POST /chats/requests/:id/accept` / `decline` ·
🟢 `POST /chats/:id/report` · 🟢 `POST /chats/:id/call` (WebRTC: создать сессию; сигналинг — через сокет)

### 5.11 Notifications (`/notifications`) — 5 🟢
`GET /notifications` (cursor, группировка «X и ещё 5 оценили ваше фото») ·
`GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all` ·
`GET /notifications/profile-views` («Кто заходил в твой профиль»)

### 5.12 Search (`/search`) — 4 🟢
`GET /search?q=` (аккаунты + хэштеги + места, одним ответом) ·
`GET /search/explore` (сетка Explore: **посты и видео вперемешку**, с `likesCount`/`commentsCount` для hover) ·
`GET /search/hashtag/:name` · `GET /search/top` (тренды)

### 5.13 Locations (`/locations`) — 5
🔵 `GET /locations` · 🔵 `GET /locations/:id` · 🔵 `POST /locations` · 🔵 `PUT /locations/:id` (**чиним AutoMapper-баг**) · 🔵 `DELETE /locations/:id`

### 5.14 Verification (`/verification`) — 4 🟢
`GET /verification/status` (`TRIAL` / дней осталось) ·
`POST /verification/start-trial` (**7 дней бесплатно**, 1 раз на аккаунт) ·
`POST /verification/subscribe` (mock-платёж **$1000/мес**; `Payment.provider = MOCK`) ·
`POST /verification/cancel`
Cron: за 1 день до конца триала → уведомление «Ваше время вышло, купите или галочка снимется». По истечении → `isVerified = false`.

### 5.15 Upload (`/upload`) — 2 🟢
`POST /upload` (multipart, до 10 файлов; sharp → webp; ffmpeg → thumb + длительность) · `DELETE /upload/:key`

### 5.16 Admin (`/admin`) — 4 🟢
`GET /admin/users` · `DELETE /admin/users/:id` · `GET /admin/reports` · `POST /admin/reports/:id/resolve`

**Итого: ≈ 137 endpoint'ов** (57 старых, починенных + ~80 новых).

---

## 6. Socket.IO — события

**Namespace `/rt`** (auth через JWT в `handshake.auth.token`):

| Событие (server→client) | Когда |
|---|---|
| `message:new` / `message:edited` / `message:deleted` | чат |
| `message:reaction` / `message:read` | чат |
| `typing:start` / `typing:stop` | «печатает…» |
| `presence:update` | `{ userId, isOnline, lastSeenAt }` |
| `notification:new` / `notification:count` | уведомления |
| `story:new` | новая история у подписки |
| `call:offer` / `call:answer` / `call:ice` / `call:end` | WebRTC-сигналинг |

| Событие (client→server) | |
|---|---|
| `chat:join` / `chat:leave` · `typing:start` / `typing:stop` · `message:read` · `call:*` | |

Presence в Redis: `presence:{userId} = 1` с TTL 60 сек, heartbeat каждые 30 сек. Отключение → `lastSeenAt = now`.

---

## 7. Безопасность и лимиты

- JWT: access 15 мин (в памяти клиента), refresh 30 дней (httpOnly cookie на фронте)
- bcrypt (12 rounds), пароль ≥ 8 символов
- `ThrottlerGuard`: login/register/forgot 5/мин, остальное 100/мин
- Guards: `JwtAuthGuard` · `OwnerGuard` (свой пост/сообщение/история) · `RolesGuard` · `BlockGuard` · `PrivacyGuard` (закрытый аккаунт)
- Upload: whitelist mime (jpeg/png/webp/mp4/mov/mp3/m4a), фото ≤ 10 МБ, видео ≤ 100 МБ, аудио ≤ 20 МБ; проверка magic bytes, не по расширению
- CORS: только домен фронта. Helmet. Валидация `whitelist: true, forbidNonWhitelisted: true`
- Soft-delete аккаунта: 30 дней на восстановление, затем hard-delete (cron)

---

## 8. Cron / очереди (BullMQ)

| Задача | Расписание |
|---|---|
| Удалить истёкшие истории (`expiresAt < now`, кроме тех, что в `Highlight`) | каждые 10 мин |
| Удалить истёкшие заметки | каждый час |
| Триал верификации истёк → `isVerified = false` + уведомление | раз в сутки |
| Hard-delete аккаунтов старше 30 дней | раз в сутки |
| Пересчёт трендов (`Hashtag.postsCount`, `Music.isTrending`) | раз в час |
| Уведомление «новый пост у подписки» | по событию (queue) |

---

## 9. Структура проекта

```
instagram-backend/
├── docker-compose.yml          # api + postgres + redis + minio
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                 # 30+ треков, локации, тестовые юзеры/посты
├── src/
│   ├── main.ts                 # ValidationPipe, Swagger, CORS, Helmet
│   ├── app.module.ts
│   ├── common/
│   │   ├── interceptors/response.interceptor.ts    # { data, errors, statusCode }
│   │   ├── filters/all-exceptions.filter.ts
│   │   ├── guards/ (jwt, roles, owner, block, privacy)
│   │   ├── decorators/ (@CurrentUser, @Public, @Roles)
│   │   └── pagination/cursor.dto.ts
│   ├── prisma/prisma.service.ts
│   ├── redis/redis.service.ts
│   ├── storage/storage.service.ts        # MinIO/S3 + sharp + ffmpeg
│   ├── mail/mail.service.ts
│   ├── events/                            # EventEmitter2 → уведомления
│   ├── gateway/rt.gateway.ts              # Socket.IO
│   ├── modules/
│   │   ├── auth/  users/  profile/  follow/  close-friends/
│   │   ├── posts/  comments/  stories/  highlights/  notes/
│   │   ├── music/  chat/  notifications/  search/  locations/
│   │   ├── verification/  upload/  admin/
│   └── jobs/                              # BullMQ + @nestjs/schedule
└── test/                                  # e2e
```

---

## 10. Definition of Done

- [ ] Все **57 старых endpoint'ов** воспроизведены и **починены** (см. §2 — 21 баг)
- [ ] Все **новые** фичи из §5 работают
- [ ] Swagger на `/api/docs` — **точный**, с DTO и примерами
- [ ] Единый конверт ответа + курсорная пагинация везде
- [ ] Realtime: чат, typing, presence, уведомления, звонки (сигналинг)
- [ ] Истории: мультизагрузка, музыка, текст/стикеры/эффекты, close friends, реакции, ответы, актуальное, 24ч
- [ ] Заметки: 24ч, музыка, фон
- [ ] Приватный аккаунт, блокировки, близкие друзья, заявки на подписку
- [ ] Верификация: триал 7 дней → $1000/мес (mock)
- [ ] Seed: 30+ треков, 20 юзеров, 100 постов, истории, чаты — фронт запускается на живых данных
- [ ] Docker Compose: `docker compose up` → API + БД + Redis + MinIO
- [ ] e2e-тесты на: auth, feed, like, story, chat, follow-private
- [ ] Лента отвечает **< 300 мс** (не 21 сек!)