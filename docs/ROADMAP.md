# ROADMAP — Instagram Backend

14 фаз. Claude Code идёт строго сверху вниз и отмечает `[x]`.
В одной сессии — **одна фаза**. После каждой: `npm run build` + e2e-проверка живыми запросами + `git commit`.

Правило проекта: **не выдумывать**. Каждый endpoint проверяется реальным запросом (curl/Postman), а не «должен работать».

---

## Фаза 0 — Каркас и инфраструктура
- [ ] `nest new instagram-backend` (TS, pnpm/npm)
- [ ] Пакеты: `@nestjs/config @nestjs/jwt @nestjs/passport passport-jwt bcrypt @nestjs/swagger class-validator class-transformer @nestjs/throttler @nestjs/schedule @nestjs/event-emitter @nestjs/websockets socket.io prisma @prisma/client ioredis bullmq @nestjs/bullmq multer sharp fluent-ffmpeg nodemailer minio`
- [ ] `docker-compose.yml`: postgres:16 + redis:7 + minio + api
- [ ] `.env` / `.env.example`: `DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET, S3_*, SMTP_*, APP_URL`
- [ ] `common/`: `ResponseInterceptor` (`{data, errors, statusCode}`), `AllExceptionsFilter`, `CursorDto`
- [ ] `ValidationPipe` (whitelist, forbidNonWhitelisted, transform), Helmet, CORS (домен фронта)
- [ ] Swagger на `/api/docs` (Bearer auth)
- [ ] `PrismaService`, `RedisService`, health-check `/api/health`
- ✅ `docker compose up` → API поднимается, `/api/docs` открывается

## Фаза 1 — Схема БД + seed
- [ ] `prisma/schema.prisma` — **все модели из ТЗ §4** (User, Profile, Follow, Block, CloseFriend, Post, PostMedia, Music, Story, Highlight, Note, Chat, Message, Notification, Location, Verification, …)
- [ ] Индексы: `(userId, createdAt)`, `(postId, createdAt)`, `(chatId, sentAt)`, `userName`, `email`, `Hashtag.name`
- [ ] `prisma migrate dev` + `prisma studio` проверить
- [ ] `seed.ts`: **30+ треков музыки** (royalty-free mp3 + обложки + длительность), 30 локаций, 20 юзеров, 100 постов (фото и видео), истории, чаты, подписки
- ✅ БД поднята, seed прошёл, данные видны в Prisma Studio

## Фаза 2 — Storage + Upload
- [ ] `StorageService`: MinIO/S3 (в dev — локальный диск), presigned URL
- [ ] `sharp`: ресайз, конверт в webp, EXIF-strip
- [ ] `fluent-ffmpeg`: постер видео (кадр 0.1с), длительность, ширина/высота, сжатие
- [ ] Валидация: mime по **magic bytes**, лимиты (фото 10 МБ, видео 100 МБ, аудио 20 МБ)
- [ ] `POST /upload` (до 10 файлов) · `DELETE /upload/:key`
- ✅ Загрузка фото и видео работает, постер видео генерируется

## Фаза 3 — Auth (11 endpoints)
- [ ] `register` (userName / fullName / email **или** phone / password / confirmPassword / **dob**) — как на скринах регистрации
- [ ] `login` (по userName **или** email **или** phone) → access(15м) + refresh(30д)
- [ ] `refresh`, `logout` (ротация refresh-токенов, `RefreshToken` в БД)
- [ ] `forgot-password` → **код 6 цифр на реальный email** (Nodemailer) · `verify-code` → `resetToken` · `reset-password`
- [ ] `change-password`, `check-username` (live-валидация), `resend-code` (rate-limit 1/мин), `GET /auth/me`
- [ ] `JwtAuthGuard` + `@Public()` + `@CurrentUser()`
- [ ] `ThrottlerGuard`: auth 5/мин
- ✅ **Проверить письмо реально приходит на Gmail** (Mailtrap в dev, SMTP в prod)

## Фаза 4 — Users, Profile, Follow, Privacy, Block, Close Friends (39 endpoints)
- [ ] Users: поиск (по userName **и** fullName, substring), 8 endpoint'ов истории поиска (с `createdAt`!), `suggestions` (+ `followedBy`), `DELETE /users/me` (soft-delete 30 дней)
- [ ] Profile: `me`, `:userId` (+ `isFollowing/isFollowedBy/isBlocked/isPrivate/hasRequestPending`), `PUT /profile` (about, **website**, gender enum, occupation, showThreadsBadge, isAiAuthor, showAccountSuggestions), аватар upload/delete (**delete НЕ ломает login**), posts/reels/tagged/reposts/favorites/saved-music, `PUT /profile/privacy`, `GET /profile/me/activity` («Ваши действия»)
- [ ] Follow: followers, following, follow/unfollow, **заявки** (`PENDING` для приватных: requests / accept / decline), удалить подписчика
- [ ] Block: block / unblock / list + `BlockGuard` (заблокированный не видит профиль, не пишет, не в поиске)
- [ ] Close Friends: get / add / remove
- [ ] `PrivacyGuard`: закрытый аккаунт → посты/истории видит только принятый подписчик
- ✅ Проверить: подписка на приватный → `PENDING` → accept → контент виден; блок → 403

## Фаза 5 — Music (5 endpoints)
- [ ] `GET /music` (поиск), `/trending`, `/:id`, save/unsave
- [ ] Стриминг mp3 с Range-заголовками
- ✅ 30+ треков доступны, поиск работает

## Фаза 6 — Posts, Comments, Reels, Explore (20 endpoints)
- [ ] `POST /posts` — multipart: до 10 медиа (фото **и видео**), caption, locationId, **musicId**, taggedUserIds[], filters[], isReel
- [ ] `GET /posts/feed` — **лента подписок: userId из JWT, курсорная пагинация, < 300 мс** (главный баг старого API)
- [ ] `GET /posts` (Explore), `GET /posts/reels`, `/:id`, `/my`, `PUT /:id` (подпись), `DELETE /:id`, archive/unarchive
- [ ] Like (toggle → `{liked, likesCount}`), View (1 раз/юзер), Favorite (+ коллекции), Share (в чат / в историю / ссылка), Report
- [ ] Comments: добавить, удалить (**только своё**), **ответы (parentId)**, лайк комментария, список (cursor), автор всегда в ответе (не `null`!)
- [ ] Hashtags + Mentions: парсинг из caption → `Hashtag`, `Mention` + уведомление
- ✅ Проверить: лента подписок отдаёт **разные** страницы (пагинация работает!), комментарий с автором

## Фаза 7 — Stories + Highlights (16 endpoints)
- [ ] `POST /stories` — **мультизагрузка до 10 файлов за раз**, image **и video**, `musicId` + `musicStartSec`, `overlays` (текст/стикеры/эффекты, JSON), `filter`, `closeFriendsOnly`, `fromPostId` (поделиться постом/reels в историю)
- [ ] `expiresAt = +24ч` + BullMQ-задача на удаление
- [ ] `GET /stories` — рейл: группировка по авторам, `isViewed` (**считается на сервере!**), `hasCloseFriends` (зелёное кольцо)
- [ ] View, Like (toggle → `{liked, likesCount}`), **Reaction (emoji)**, **Reply → уходит сообщением в чат**
- [ ] `GET /stories/:id/viewers` — **полный список зрителей: кто смотрел, кто лайкнул, какая реакция** (только автору)
- [ ] `GET /stories/archive` — свои истёкшие
- [ ] Highlights (Актуальное): create / update / delete / list — история в актуальном **не удаляется** через 24ч
- ✅ Проверить: загрузил 3 истории одним запросом → 24ч TTL → добавил в актуальное → не удалилась

## Фаза 8 — Notes (4 endpoints)
- [ ] CRUD заметок: text ≤ 60, `musicId`, `bgColor`, TTL 24ч (cron), видны подписчикам / близким друзьям
- ✅ Заметка исчезает через 24ч

## Фаза 9 — Chat + Realtime (18 endpoints + Socket.IO)
- [ ] `GET /chats` — **lastMessage, lastMessageAt, unreadCount, peer, isOnline, lastSeenAt** (всего этого не было в старом API)
- [ ] `GET /chats/:id` (cursor), `POST /chats` (идемпотентно)
- [ ] `POST /chats/:id/messages` — текст / фото / видео / **голосовое (audio)** / стикер / **ответ (replyToId)** / отправка поста
- [ ] `PUT /chats/messages/:id` — **редактировать** (≤ 15 мин), `editedAt`
- [ ] `DELETE /chats/messages/:id` — **OwnerGuard: только своё!** (баг старого API)
- [ ] `POST /chats/messages/bulk-delete` — **удалить несколько выбранных**
- [ ] Реакции на сообщения, `POST /chats/:id/read` («Просмотрено»)
- [ ] Тема чата, никнеймы, mute, `DELETE /chats/:id`, report
- [ ] **Запросы на переписку** (от неподписанных): requests / accept / decline
- [ ] **Socket.IO `/rt`**: `message:new|edited|deleted`, `message:reaction|read`, `typing:start|stop`, `presence:update` (онлайн + «был в сети N мин назад»), `story:new`
- [ ] Presence в Redis (TTL 60с, heartbeat 30с)
- [ ] **Звонки**: `CallSession` + WebRTC-сигналинг через сокет (`call:offer/answer/ice/end`) — сервер только передаёт SDP/ICE
- ✅ Проверить с **двух** клиентов: сообщение приходит мгновенно, typing, онлайн-статус, реакция, редактирование, «просмотрено»

## Фаза 10 — Notifications (5 endpoints)
- [ ] `EventEmitter2` → `NotificationService` → БД + Socket.IO push
- [ ] Все типы: `LIKE_POST · COMMENT_POST · REPLY_COMMENT · LIKE_COMMENT · MENTION · FOLLOW · FOLLOW_REQUEST · FOLLOW_ACCEPTED · LIKE_STORY · STORY_REACTION · STORY_REPLY · SHARE_POST · SAVE_POST · TAG_POST · PROFILE_VIEW · NEW_POST_FROM_FOLLOWING · VERIFICATION_TRIAL_ENDING`
- [ ] **Группировка**: «user1 и ещё 5 оценили вашу публикацию»
- [ ] `ProfileView` — «кто заходил в твой профиль» (не чаще 1 записи/сутки на пару)
- [ ] `unread-count`, `read`, `read-all`
- [ ] Себя не уведомляем, заблокированные не уведомляют
- ✅ Лайк с другого аккаунта → уведомление прилетает в сокет **мгновенно**

## Фаза 11 — Search + Explore (4 endpoints)
- [ ] `GET /search?q=` — аккаунты + хэштеги + локации одним ответом
- [ ] `GET /search/explore` — сетка: посты и **видео вперемешку**, с `likesCount` / `commentsCount` (для hover на фронте)
- [ ] `GET /search/hashtag/:name`, `GET /search/top` (тренды)
- [ ] Full-text (Postgres `tsvector`) или `ILIKE` + индексы
- ✅ Поиск «er» находит `eraj`, `amERica`, `chessmastER`

## Фаза 12 — Locations + Verification + Admin (13 endpoints)
- [ ] Locations CRUD — **`PUT` работает** (в старом API 400 AutoMapper)
- [ ] Verification: `status`, `start-trial` (**7 дней бесплатно, 1 раз**), `subscribe` (**mock-платёж $1000/мес**), `cancel`
- [ ] Cron: за 1 день до конца триала → уведомление «Ваше время вышло — купите, иначе галочка снимется»; по истечении → `isVerified = false`
- [ ] Admin: users, delete user, reports, resolve
- ✅ Триал → галочка появляется → через 7 дней снимается

## Фаза 13 — Финал: тесты, производительность, деплой
- [ ] e2e (Jest + Supertest): auth-флоу, лента, лайк, история, чат, приватный аккаунт, блок
- [ ] Производительность: лента **< 300 мс** (EXPLAIN ANALYZE, индексы, `select` только нужного, N+1 устранён)
- [ ] Rate-limit проверен, CORS, Helmet
- [ ] Swagger `/api/docs` — все ~137 endpoint'ов с DTO и примерами
- [ ] `docker compose up` → всё поднимается с нуля
- [ ] Деплой: VPS / Railway / Render + Postgres + Redis + S3
- [ ] `README.md`: стек, запуск, схема БД, список endpoint'ов, чем лучше softclub-API (21 баг)
- ✅ **Backend готов**

## Фаза 14 — Подключение фронта (в репозитории frontend!)
- [ ] `.env.local`: `NEXT_PUBLIC_API_URL` → новый backend
- [ ] `lib/axios.ts` + `api/proxy` — адаптировать под новый формат (`cursor` вместо `PageNumber`)
- [ ] Типы и сервисы: заменить DTO на новые (Swagger нового API — точный)
- [ ] **Новые экраны:** Уведомления (реально работают) · Актуальное · Заметки · Близкие друзья · Реакции в чате · Голосовые · Онлайн-статус · Редактирование сообщений · Приватный аккаунт · Заявки · Блокировки · Верификация · Музыка в постах и историях · Эффекты/текст в историях · Звонки
- [ ] Socket.IO-клиент вместо polling
- ✅ **Full-stack Instagram готов**

---

## Итог

| | Старый API (softclub) | Наш backend |
|---|---|---|
| Endpoints | 57 | **~137** |
| Багов | 21 (6 критичных) | 0 |
| Realtime | нет | Socket.IO |
| Уведомления | **нет ни одного endpoint'а** | 17 типов |
| Истории | картинка + 2 счётчика | видео, музыка, текст, эффекты, close friends, реакции, ответы, актуальное, список зрителей |
| Чат | текст + файл, polling | realtime, реакции, редактирование, голосовые, звонки, темы, запросы, «просмотрено», онлайн |
| Приватность | нет | закрытый аккаунт, блок, близкие друзья, заявки |
| Пагинация | сломана | курсорная везде |
| Swagger | пустой | точный |