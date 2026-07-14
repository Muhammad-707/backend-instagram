# ROADMAP — Instagram Backend

14 фаз. Claude Code идёт строго сверху вниз и отмечает `[x]`.
В одной сессии — **одна фаза**. После каждой: `npm run build` + e2e-проверка живыми запросами + `git commit`.

Правило проекта: **не выдумывать**. Каждый endpoint проверяется реальным запросом (curl/Postman), а не «должен работать».

---

## Фаза 0 — Каркас и инфраструктура
- [x] Каркас NestJS 11 в корне репозитория (package.json / tsconfig / nest-cli, TS strict)
- [x] Пакеты: `@nestjs/config @nestjs/jwt @nestjs/passport passport-jwt bcrypt @nestjs/swagger class-validator class-transformer @nestjs/throttler @nestjs/schedule @nestjs/event-emitter @nestjs/websockets socket.io prisma @prisma/client ioredis bullmq @nestjs/bullmq multer sharp fluent-ffmpeg nodemailer minio livekit-server-sdk` (766 пакетов)
- [x] `docker-compose.yml`: postgres:16 + redis:7 + minio + **livekit** + api (+ Dockerfile) — **запущен, 4 контейнера подняты**
- [x] `.env` / `.env.example`: `DATABASE_URL, REDIS_URL, JWT_*, S3_*, SMTP_*, LIVEKIT_*, APP_URL`
- [x] `common/`: `ResponseInterceptor` (`{data, errors, statusCode}`), `AllExceptionsFilter` (+ маппинг ошибок Prisma), `CursorDto` + `buildCursorPage`
- [x] `ValidationPipe` (whitelist, forbidNonWhitelisted, transform), Helmet, CORS (FRONTEND_URL)
- [x] Swagger на `/api/docs` (Bearer auth) — отвечает `200`
- [x] `PrismaService`, `RedisService`, health-check `/api/health` — проверен curl'ом
- [x] `docker compose up -d` → postgres + redis + minio + livekit подняты (`healthy`), API стартует локально и видит БД и Redis

**Проверено живыми запросами (с Docker):**
- `GET /api/health` → `{"data":{"status":"ok","database":"up","redis":"up","uptimeSec":28,…},"errors":null,"statusCode":200}` — конверт верный, `errors: null` при успехе
- `GET /api/docs` → `200`
- `GET /api/nope` → `{"data":null,"errors":["Cannot GET /api/nope"],"statusCode":404,"code":"NOT_FOUND",…}` — `errors` только при ошибке
- `npm run build` → зелёный · `tsc --noEmit` → 0 ошибок · `npm run lint` → 0 ошибок

> **Заметки Фазы 0:**
> - Каркас поднят **в корне репозитория** (не `nest new instagram-backend/` подпапкой) — репозиторий уже существовал с `docs/` и `CLAUDE.md`.
> - `PrismaService.onModuleInit` **не роняет API**, если БД недоступна: логирует ошибку и продолжает, чтобы `/api/health` честно ответил `database: "down"`. Изначально падал с `P1000` и убивал весь процесс.
> - ESLint 10 + typescript-eslint (`recommendedTypeChecked`) подключён, `no-explicit-any: error` — по ТЗ `any` запрещён.
> - `livekit-server-sdk` и сервис `livekit` в docker-compose добавлены сразу (понадобятся в Фазе 12.5).
> - Rate-limit: глобально 100/мин (`ThrottlerGuard` как `APP_GUARD`); 5/мин на auth-роуты вешаем в Фазе 3 через `@Throttle`.
> - **Порт Postgres на хосте — `5433`, не 5432** (сессия 2026-07-15): на 5432 уже слушает локально установленный Windows-сервис PostgreSQL, он перехватывал подключения и отдавал `P1000 Authentication failed`. Контейнер публикуется как `${POSTGRES_HOST_PORT:-5433}:5432`, `DATABASE_URL` на хосте → `localhost:5433`. Внутри docker-сети (сервис `api`) по-прежнему `postgres:5432` — там менять нечего.

## Фаза 1 — Схема БД + seed
- [x] `prisma/schema.prisma` — **все модели из ТЗ §4** + Notes v2 (NoteLike, NoteReply, Message.noteId/noteSnapshot) + Live (Live, LiveViewer, LiveComment, LiveLike, LiveReaction, LiveJoinRequest, LiveGuest). **56 моделей, 17 enum'ов**
- [x] Индексы: `(userId, createdAt)`, `(postId, createdAt)`, `(chatId, sentAt)`, `userName`, `fullName`, `email`, `Hashtag.name`, `Story.expiresAt`, `Note.expiresAt`, `Live.status`
- [x] `npx prisma format` + `npx prisma validate` → **The schema is valid** · `prisma generate` → клиент сгенерирован
- [x] `seed.ts` написан: **34 трека**, 30 локаций, 20 юзеров, 100 постов (фото + reels), 10 юзеров с историями, 8 заметок, 5 чатов, подписки (в т.ч. PENDING на приватные)
- [x] `prisma migrate dev --name init` → миграция `20260714194128_init` применена, все 56 моделей легли в БД без конфликтов · `prisma studio` открывается
- [x] `npm run seed` → данные легли, проверено SQL-запросом к БД:
      Music **34** · User **20** · Post **100** · PostMedia 173 · Comment 174 · Follow 126 · Story 21 · Note 8 · Chat **5** (42 сообщения) · Location 30

> **Заметки Фазы 1:**
> - **`StoryReaction` без `@@unique`** (решение пользователя): в реальном IG реакция на историю — это **сообщение в чат**, и слать её можно сколько угодно раз. Добавлено поле `messageId Int?`, в `MsgType` добавлен `STORY_REACTION`.
> - **`MessageRequest` с `@@unique([fromUserId, toUserId])`** (решение пользователя, антиспам): после `DECLINED` повторная заявка **обновляет существующую строку** (`status → PENDING`, `createdAt → now`), а не создаёт новую. Реализовать в Фазе 9.
> - **`LiveLike` без `@@unique`** — в эфире можно жать ❤️ сотни раз (как в IG). `LiveJoinRequest` и `LiveGuest` — с `@@unique`: одна заявка / одно гостевое место на юзера.
> - `Message.noteSnapshot` — снимок текста заметки: заметка умирает через 24ч, а сообщение в чате остаётся навсегда (TZ_LIVE_NOTES ЧАСТЬ A).
> - Каскады: почти везде `onDelete: Cascade`; на «мягких» связях (`locationId`, `musicId`, `fromPostId`, `sharedPostId`, `collectionId`) — `SetNull`, чтобы удаление музыки/локации не сносило посты.
> - `Notification` расширен полями `noteId` и `liveId` — нужны для `LIKE_NOTE`/`REPLY_NOTE` и `LIVE_*`.
> - seed использует **детерминированный ПСЧ** (сид 42) — данные воспроизводимы. URL музыки в seed — заглушки (`cdn.pixabay.com/audio/track-N.mp3`), реальные mp3 подложим в Фазе 5 при стриминге.

## Фаза 2 — Storage + Upload
- [x] `StorageService`: MinIO/S3, авто-создание bucket, public-read политика, `presignedUrl()` (TTL 1ч), `put/remove/exists`
- [x] `sharp`: ресайз до 1440 по длинной стороне, конверт в webp (q82), EXIF-strip (проверено: `EXIF: нет`), `.rotate()` до strip — фото не ложится боком
- [x] `fluent-ffmpeg`: постер видео (кадр 0.1с → webp 720), длительность, ширина/высота. Бинари — `ffmpeg-static` + `ffprobe-static` (в системе ffmpeg не было)
- [x] Валидация: mime по **magic bytes** (`file-type`), лимиты из `.env` (фото 10 МБ, видео 100 МБ, аудио 20 МБ)
- [x] `POST /upload` (до 10 файлов) · `DELETE /upload/*key` (ключ со слешами) · MinIO добавлен в `/api/health`
- ✅ Загрузка фото и видео работает, постер видео генерируется

**Проверено живыми запросами:**
- `POST /upload` (фото+видео+аудио одним запросом) → `201`: photo 2000×1500 jpeg → **webp 1440×1080**; video → `duration: 3`, `640×480`, `thumbUrl` сгенерирован; mp3 → `duration: 2.04`
- Публичные ссылки MinIO → `HTTP 200`, `image/webp`; постер — настоящий кадр 640×480; **EXIF вырезан**
- Подделка (exe → `fake.jpg` + подделанный заголовок `type=image/jpeg`) → `400` «Тип «application/x-msdownload» не разрешён» — **magic bytes ловят**
- Фото 48 МБ → `400` «лимит для IMAGE: 10.0 МБ» · 11 файлов → `400` «Too many files» · без файлов → `400`
- `DELETE /upload/images/2026/07/<uuid>.webp` → `200 {deleted: true}`; ссылка → MinIO `404`; повторное удаление → `404` «не найден»
- Откат: пачка «хорошее фото + подделка» → `400`, объектов в bucket **не прибавилось** (мусор в S3 не попадает)
- Swagger `/api/docs-json` — оба endpoint'а с DTO · `npm run build` · `tsc --noEmit` · `npm run lint` → 0 ошибок

> **Заметки Фазы 2:**
> - **Сначала валидируем ВСЕ файлы, потом заливаем.** Иначе при плохом 5-м файле первые четыре уже осели бы в S3 мусором. Плюс `cleanup()` откатывает залитое, если заливка упала на середине.
> - **Видео не перекодируем** — только снимаем метаданные и постер. Транскодинг дорогой и синхронно повесил бы запрос; при необходимости уйдёт в BullMQ-задачу.
> - **`.rotate()` перед `.webp()`** — sharp по умолчанию не переносит метаданные (это и есть EXIF-strip), но если не применить EXIF-ориентацию заранее, фото с телефона ляжет боком.
> - **Bucket public-read**: медиа отдаётся напрямую в `<img src>`. `presignedUrl()` готов на случай, если в проде закроем bucket.
> - ⚠️ **`/upload` пока без авторизации** — `JwtAuthGuard` появится только в Фазе 3, там же вешаем `@UseGuards` (в коде стоит `TODO(Фаза 3)`).
> - `MediaType` в Prisma — только IMAGE/VIDEO; AUDIO живёт отдельно (голосовые, музыка), поэтому в storage свой тип `MediaKind`.

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

## Фаза 8 — Notes v2 (8 endpoints)
- [ ] CRUD заметок: text ≤60, musicId, bgColor, TTL 24ч (cron)
- [ ] 🆕 `POST /notes/:id/like` — toggle + уведомление LIKE_NOTE
- [ ] 🆕 `GET /notes/:id/likes` — список профилей, кто лайкнул (только автору)
- [ ] 🆕 `POST /notes/:id/reply` — ответ → findOrCreateChat → Message(type=NOTE_REPLY, noteId)
       + noteSnapshot (заметка умрёт через 24ч, а сообщение в чате останется!)
- [ ] 🆕 `GET /notes/:id/replies`
- [ ] MsgType += NOTE_REPLY · NotifType += LIKE_NOTE, REPLY_NOTE
- ✅ Проверить: лайк → автор видит профиль; ответ → появился в чате у обоих

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

## Фаза 12.5 — LIVE (Прямые эфиры, 18 endpoints) — см. docs/TZ_LIVE_NOTES.md ЧАСТЬ B
- [ ] LiveKit в docker-compose + LiveKitService (publisher / subscriber токены)
- [ ] Prisma: Live, LiveViewer, LiveComment, LiveLike, LiveReaction, LiveJoinRequest, LiveGuest
- [ ] start / end / feed / :id / user/:userId / join / leave / viewers
- [ ] comment / like (много раз!) / reaction (всплывающие смайлы)
- [ ] request-join → accept (гость = второй publisher, split-экран) / decline (уведомление отказа)
- [ ] PUT /camera (видео выкл → аватар/картинка, ЗВУК ИДЁТ ВСЕГДА) · PUT /audio · kick · stats
- [ ] Socket namespace /live: started, viewers, comment, like, reaction,
       join-request, join-accepted, join-declined, guest-joined, camera, ended
- [ ] Доступ: подписчик → в рейле историй; НЕ подписчик → только через ПОИСК (профиль → «В эфире»),
       там может смотреть, комментировать, лайкать, подписаться
- [ ] PrivacyGuard (закрытый аккаунт) + BlockGuard
- ✅ Проверить с 3 клиентов: хост + зритель + гость (заявка → принял → split-экран)

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