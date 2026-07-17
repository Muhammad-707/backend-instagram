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
- [x] `register` (userName / fullName / **email обязателен** / phone опционален / password / confirmPassword / **dob**) + проверка возраста 13+
- [x] `login` (по userName **или** email **или** phone) → access(15м) + refresh(30д)
- [x] `refresh`, `logout` (ротация refresh-токенов, SHA-256 в `RefreshToken`, детект повторного использования)
- [x] `forgot-password` → **код 6 цифр на реальный email** (Nodemailer + MailHog) · `verify-code` → `resetToken` · `reset-password`
- [x] `change-password`, `check-username` (live-валидация), `resend-code` (rate-limit 1/мин), `GET /auth/me`
- [x] `JwtAuthGuard` (глобальный APP_GUARD) + `@Public()` + `@CurrentUser()`
- [x] `ThrottlerGuard`: auth 5/мин, resend-code 1/мин
- [x] ⚠️ **TODO Фазы 2 закрыт**: `/upload` теперь под JwtAuthGuard (аноним → 401)
- ✅ **Письмо реально приходит** — проверено в MailHog (HTML: логотип с градиентом, 6 плиток с цифрами)

**Проверено живыми запросами:**
- `check-username` → `{available:true}` для свободного, `{available:false}` для занятого (`eraj` из seed)
- `register` → `201` + пара токенов + профиль; `passwordHash` наружу **не утекает**
- `register` негатив: пароли не совпадают → `400` · возраст < 13 → `400` · userName занят → `409`
- `login` по **userName**, по **email**, по **phone** → все три `200`
- `login` с неверным паролем → **`401`, а не 500** (баг старого API)
- **Rate-limit: 5 логинов проходят, 6-й → `429`** · `resend-code` второй раз подряд → `429`
- `GET /auth/me` с токеном → `200` + профиль; без токена → `401`
- **`POST /upload` без токена → `401`**, с токеном → `201` (TODO Фазы 2 закрыт)
- `refresh` → новая пара, старый токен отозван; **повторное использование старого → `401` + все сессии сброшены**
- `logout` → `200`, затем `refresh` → `401`; повторный `logout` → `200` (идемпотентно)
- **`forgot-password` → письмо реально ушло в MailHog** (To/From/Subject верные); для несуществующего email — тот же ответ и письма нет
- HTML-письмо: логотип Instagram с градиентом, **6 плиток с цифрами `433684`**, срок «15 минут»
- `verify-code`: неверный код → `400` · **просроченный код (сдвинул `expiresAt` в БД на −20 мин) → `400`** · использованный повторно → `400`
- `reset-password` → `200`; **старый пароль → `401`, новый → `200`**; повторный resetToken → `400` (одноразовый)
- `change-password`: неверный старый → `401`; верный → `200`, все refresh-сессии отозваны
- Swagger `/api/docs-json` — **14 endpoint'ов**, замок 🔒 ровно на защищённых · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 3:**
> - **email ОБЯЗАТЕЛЕН, phone опционален** (решение пользователя, записано в `docs/TZ.md §5.1` и комментарием в схеме).
>   На скрине IG одно поле «телефон или email»: если юзер вводит телефон — `phone` сохраняется, но email всё равно
>   запрашивается. Причина: код сброса уходит **только на email** (SMS-провайдера нет), иначе «телефонному» юзеру
>   пароль восстановить нечем. **Миграция не понадобилась** — схема уже была такой.
> - **JwtAuthGuard глобальный (APP_GUARD), всё закрыто по умолчанию**, открывается точечно через `@Public()`.
>   Так новый endpoint нельзя случайно забыть защитить — и именно это закрыло `/upload` без единой правки в его контроллере.
> - **Refresh хранится как SHA-256**, не в открытом виде: утечка таблицы `RefreshToken` не даст войти в аккаунты.
> - **Детект кражи токена**: повторное использование уже отозванного refresh → гасим ВСЕ сессии юзера.
> - **resetToken одноразовый через Redis**: JWT сам по себе переиспользуем, поэтому `jti` кладётся в Redis (TTL 15 мин)
>   и удаляется при первом `reset-password`. Плюс проверка `typ: 'reset'` — обычным access-токеном пароль не сменить.
> - **Нет user enumeration**: `forgot-password` отвечает одинаково для существующего и несуществующего email;
>   `verify-code` даёт один и тот же текст на «код неверен», «код чужой», «код просрочен».
> - **MailHog в docker-compose** (dev, порт 1025 SMTP / 8025 web). Код MailService **один на dev и prod** — режим
>   решают только `SMTP_*` в `.env`. Для Gmail достаточно раскомментировать блок в `.env.example` (App Password), код не трогается.
> - Смена пароля (и reset, и change) **отзывает все refresh-сессии** — украденный токен перестаёт работать.

## Фаза 4 — Users, Profile, Follow, Privacy, Block, Close Friends (39 endpoints)
Разбита на две сессии: **4а — Users + Profile (26)** · **4б — Follow + Block + Close Friends (13)**.

### Фаза 4а — Users + Profile (26 endpoints) ✅
- [x] Users: поиск (по userName **и** fullName, substring, курсорная пагинация), 8 endpoint'ов истории поиска (**с `createdAt`**), `suggestions` (+ `followedBy`), `DELETE /users/me` (soft-delete 30 дней), `POST /users/:id/report`
- [x] Profile: `me`, `:userId` (+ `isFollowing/isFollowedBy/isBlocked/isPrivate/hasRequestPending/canViewContent`), `PUT /profile` (about ≤150, **website**, gender enum, occupation, dob, showThreadsBadge, isAiAuthor, showAccountSuggestions), аватар upload/delete (**delete НЕ ломает login**), posts/reels/tagged/reposts/favorites/saved-music, `PUT /profile/privacy`, `GET /profile/me/activity` («Ваши действия»)
- [x] `AccessService` — единая точка правды по блокировкам и приватности (в 4б станет основой `BlockGuard` / `PrivacyGuard`)

**Проверено живыми запросами (два аккаунта: `eraj` публичный, `nodira` приватная):**
- Поиск `q=er` → нашёл `eraj`, am**er**ika, chessmast**er**, dal**er**, sh**er**zod — **substring в userName И fullName**, регистронезависимо (ТЗ §11)
- **Пагинация: страница 1 ≠ страница 2** (`limit=3` + `cursor`) — баг softclub #4 не повторён
- История поиска: все 8 endpoint'ов, **`createdAt` в каждом ответе** (баг softclub #19); повторный клик по профилю **не плодит строки** (upsert поднимает наверх); удаление чужой записи → `404`
- UTF-8 round-trip проверен: «закат в горах» сохраняется и возвращается **посимвольно точно**
- `suggestions` → `photolab (followedBy: m.ibrohim, chessmaster · 4)` — второй круг подписок работает
- `PUT /profile`: отправили `gender: MALE` → вернулся **`MALE`** (симметричный enum, баг softclub #12); `about` 200 симв. → `400`
- **Приватность:** `eraj` → профиль `nodira` виден (`canViewContent: false`), но `/posts` и `/reels` → **`403`**; после `PENDING → ACCEPTED` → **`200`, 5 постов видны**; свой контент виден всегда
- **Блокировка:** `403` **в обе стороны**, заблокированный **исчезает из поиска** (найдено 0) и **из рекомендаций**
- **Аватар:** upload → файл реально отдаётся (`200 image/webp`) → **DELETE → логин ВСЁ ЕЩЁ РАБОТАЕТ (`200`)** (баг softclub #2 не повторён), старый файл удалён из S3 (`404`), повторный DELETE идемпотентен
- Вкладки на реальных данных: `favorites` 2 · `reposts` 2 · `saved-music` 3 трека · `tagged` 2 · `activity` (LIKE/SEARCH, по времени)
- `DELETE /users/me` → `200`, логин → `401`, старый токен → `401`, **строка в БД цела** (`isDeleted=true`)
- Жалоба на себя → `400` · Swagger: **users 12 + profile 14 = 26** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 4а:**
> - **`AccessService` вместо копипасты проверок.** Блокировки и приватность нужны users, profile, а дальше posts, stories, chat.
>   Одна точка правды: `isBlockedBetween`, `blockedIds`, `canViewContent`. В 4б поверх встанут guard'ы.
> - **Блокировка симметрична по последствиям**: неважно, кто кого заблокировал — контент скрыт обоим (как в IG).
> - **Профиль приватного аккаунта виден всем** (аватар, счётчики), закрыт именно **контент** — так в реальном IG,
>   иначе нельзя было бы нажать «Подписаться».
> - **Репост = `Share`**: модели `Repost` в схеме нет, `GET /profile/me/reposts` отдаёт посты, которые я расшарил.
> - **`DELETE /profile/avatar` трогает ровно одно поле** `Profile.avatarUrl`. Ни `User`, ни `passwordHash`, ни сам
>   `Profile` не удаляются — логин сломаться физически не может (баг softclub #2).
> - **Soft-delete не удаляет строку**: hard-delete каскадом снёс бы посты и переписку у собеседников. Cron на 30 дней — Фаза 12.
> - **`ProfileView` пишется не чаще 1 раза в сутки на пару** — иначе таблица распухла бы от F5.
> - Порядок роутов: конкретные пути (`me`, `favorites`, `search-history`) объявлены **до** `:userId` / `:id`, иначе параметр их перехватит.

### Фаза 4б — Follow + Block + Close Friends (14 endpoints) ✅
- [x] Follow: followers, following, follow/unfollow, **заявки** (`PENDING` для приватных: requests / accept / decline), удалить подписчика
- [x] Block: block / unblock / list + **`BlockGuard`** (заблокированный не видит профиль, не пишет, не в поиске)
- [x] Close Friends: get / add / remove
- [x] **`PrivacyGuard`**: закрытый аккаунт → посты/reels/tagged/followers/following только принятому подписчику
- [x] Уведомления в БД: `FOLLOW` (публичный) · `FOLLOW_REQUEST` (приватный) · `FOLLOW_ACCEPTED` (при accept)
- ✅ Проверено: подписка на приватный → `PENDING` → accept → контент виден; блок → 403

**Проверено живыми запросами (`eraj` публичный, `nodira` приватная):**
- **ГЛАВНЫЙ СЦЕНАРИЙ:** `posts` до подписки → `403` → `POST /follow/:nodira` → **`PENDING`** «Заявка отправлена» → `posts` всё ещё `403` → `nodira` видит заявку в `/follow/requests` → **accept** → **`posts` → `200`, 5 ПОСТОВ ВИДНЫ**, `hasRequestPending: false`, `isFollowing: true`
- Публичный аккаунт: `POST /follow/:eraj` → **`ACCEPTED` сразу**, «Вы подписались»
- Чужую заявку принять нельзя → **`403` «Это не ваша заявка»**
- `decline` → заявка удалена, `pending` сброшен, **подписаться заново можно** (не остаёшься навсегда отвергнутым)
- Повторная подписка идемпотентна — заявки не плодятся
- «Удалить подписчика» → `200`, повторно → `404`
- **БЛОКИРОВКА → `403` ВЕЗДЕ:** профиль, posts, reels, followers, following, подписаться, close-friends — все `403`; **в обе стороны** (блокировавшая тоже не видит)
- Заблокированный **исчез из поиска** (найдено 0) и из рекомендаций
- **Блокировка физически рвёт связи** — проверено SQL: `Follow` 1 → **0**, `CloseFriend` 1 → **0**
- `GET /follow/blocked` → список у блокировщика (1), у заблокированного пусто (0); разблокировка → профиль снова виден, **подписка НЕ восстановлена**
- Заблокировать себя → `400` · Close Friends: add/remove/list, идемпотентно, себя → `400`
- Уведомления в БД: `FOLLOW_REQUEST eraj→nodira`, `FOLLOW_ACCEPTED nodira→eraj`, `FOLLOW nodira→eraj`
- Перепроверено после появления guard'ов: **DELETE аватара → логин `200`**; `gender` FEMALE→FEMALE, MALE→MALE (не число)
- Swagger: **follow 11 + close-friends 3 = 14**, всего **54 endpoint'а** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 4б:**
> - **`BlockGuard` и `PrivacyGuard` — тонкие обёртки над `AccessService`** из 4а. Логика блокировок/приватности живёт
>   в одном месте: guard и сервис не могут разойтись в понимании «кто кого видит».
> - **`PrivacyGuard` — только на КОНТЕНТ** (`posts`, `reels`, `tagged`, `followers`, `following`), `BlockGuard` — на сам профиль.
>   Профиль приватного аккаунта виден всем — иначе некуда нажать «Подписаться».
> - **На block/unblock guard НЕ вешаем**: разблокировать нужно уметь именно того, с кем блокировка уже есть.
> - **`decline` удаляет строку, а не ставит `DECLINED`**: из-за `@@unique([followerId, followingId])` статус `DECLINED`
>   навсегда запретил бы повторную заявку — человек остался бы отвергнутым без права передумать.
> - **Блокировка рвёт подписки в обе стороны и убирает из близких друзей** (иначе заблокированный продолжал бы
>   видеть истории «только для близких»). Разблокировка подписки **не** восстанавливает — как в IG.
> - Заблокированному на `/posts` отдаётся текст «Аккаунт закрыт — подпишитесь», а не «вы заблокированы» —
>   **намеренно**: факт блокировки не раскрываем. Код всё равно `403`.
> - Уведомления пока **только пишутся в БД**. Socket.IO-пуш — Фаза 10.
> - Фактически в Follow **11 endpoint'ов**, а не 10: в ТЗ §5.4 заголовок говорит «10», но в самом списке перечислено 11.

## Фаза 5 — Music (6 endpoints) ✅
> Сейчас **9**: добавился поиск любой песни мира (`/music/online`) — см. «После Фазы 13».
- [x] `GET /music` (поиск по title И artist, курсорная пагинация, фильтр по genre), `/trending`, `/:id`, `POST/DELETE /:id/save`
- [x] **`GET /music/:id/stream` — стриминг mp3 с Range-заголовками** (200 целиком · **206 Partial Content** с `Content-Range`)
- [x] **`npm run music:import`** — скрипт: читает `assets/music/`, тянет ID3-теги и длительность через ffprobe, заливает mp3 + обложку в MinIO, upsert в таблицу `Music`
- [x] Seed больше **не создаёт URL-заглушки** — берёт треки, залитые импортом
- ⚠️ Сейчас **17 демо-треков** (SoundHelix), а не 30+: Pixabay и FMA из окружения недоступны — см. заметки

**Проверено живыми запросами:**
- **Стриминг:** без Range → `200`, весь файл 8 945 229 байт · `bytes=0-1023` → **`206`**, `Content-Range: bytes 0-1023/8945229` · перемотка `bytes=5000000-` → `206`, 3 945 229 байт · `bytes=-500` (хвост) → `206`, 500 байт
- **Файл реально играет:** скачанный по `streamUrl` mp3 → ffprobe: `mp3, 44100 Hz, 2 канала, 192 kbps, 373с` — совпадает с длительностью в БД
- **Байты диапазонов идентичны оригиналу** (сравнение буферов с исходным файлом → `true`)
- `/music/:id/stream` **публичный** — 206 без токена (браузерный `<audio>` не шлёт Authorization); остальные endpoint'ы → `401` без токена
- Поиск: `q=stationary` → «The Stationary Ark» (по title) · `q=SPY` → «Spy vs. Spy» (регистронезависимо) · `q=soundhelix` → 17 (по artist)
- Пагинация: страница 1 (35–39) ≠ страница 2 (40–44)
- `trending` → 11 треков, все `isTrending`, отсортированы по `usesCount` (5 ≥ 5 ≥ … ≥ 3)
- `save` → `isSaved: true`, повторно — идемпотентно, трек виден в `/profile/me/saved-music`; `unsave` → `isSaved: false`
- Обложки — реальные webp 640×640 в MinIO · `/music/99999` → `404` · `/music/abc` → `400`
- Swagger: **music 6**, всего **60 endpoint'ов** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 5:**
> - **Pixabay и Free Music Archive недоступны из этого окружения**: Pixabay отдаёт `403` (блокирует ботов),
>   archive.org и FMA не отвечают вовсе. Скачать оттуда 34 трека не вышло.
>   **Решение пользователя:** залить 17 треков SoundHelix (royalty-free, настоящие mp3 по 9 МБ),
>   чтобы стриминг и Range проверялись по-настоящему, и **написать скрипт импорта** — когда появятся
>   34 mp3 с Pixabay, достаточно положить их в `assets/music/` и выполнить `npm run music:import`. Код не трогается.
> - **`streamUrl` вместо прямой ссылки в S3.** Клиенту отдаём свой endpoint: так работает Range через наш код
>   и позже можно будет считать прослушивания.
> - **`/stream` помечен `@Public()`**: тег `<audio src="...">` в браузере не умеет слать `Authorization`.
>   Ничего нового этим не открываем — объекты в MinIO и так публичны на чтение.
> - **Неразбираемый `Range` → отдаём `200` целиком**, а не `416`: так предписывает HTTP-спецификация.
> - **34 заглушки из старого seed удалены**, 50 постов/историй переназначены на реальные треки —
>   иначе в приложении были бы посты с музыкой, которую невозможно проиграть.
> - **`assets/music/*.mp3` в `.gitignore`** — 175 МБ аудио в репозиторий не кладём.
> - `usesCount` и `isTrending` пересчитаны по факту использования в постах; автоматический пересчёт (cron) — Фаза 12.
> - Endpoint'ов получилось **6, а не 5**: ТЗ §5.9 перечисляет 5, но отдельно требует стриминг — он и стал шестым.

## Фаза 6 — Posts, Comments, Reels, Explore (22 endpoints) ✅
- [x] `POST /posts` — multipart: до 10 медиа (фото **и видео**), caption ≤2200, locationId, **musicId**, taggedUserIds[], filters[], isReel
- [x] `GET /posts/feed` — **лента подписок: userId из JWT, курсорная пагинация, < 300 мс** (главный баг старого API)
- [x] `GET /posts` (Explore), `GET /posts/reels`, `/:id`, `/my` (+archived), `PUT /:id` (подпись), `DELETE /:id`, archive/unarchive
- [x] Like (toggle → `{liked, likesCount}`), `/:id/likes`, View (1 раз/юзер), Favorite (+ коллекции), Share (в чат / в историю / ссылка), Report
- [x] Comments: добавить, удалить (**своё ИЛИ под своим постом**), **ответы (parentId)**, лайк комментария, `/replies`, список (cursor), **автор всегда в ответе**
- [x] Hashtags + Mentions: парсинг из caption → `Hashtag`, `Mention` + уведомление (кириллица поддерживается)
- ✅ Проверено: лента отдаёт разные страницы, < 300 мс, комментарий с автором, чужой коммент → 403

**Проверено живыми запросами (три бага softclub закрыты):**
- **#3 (userId из JWT):** лента `eraj` (41 пост) ≠ лента `daler` (36) — берётся из токена, не из query
- **#4 (пагинация):** стр.1 `[99,95,91,90,87]` ≠ стр.2 `[83,82,81,79,75]`
- **#5 (< 300 мс):** feed?limit=20 → **среднее 41 мс, максимум 46 мс** (SQL по EXPLAIN ANALYZE — 0.9 мс, один запрос с include, N+1 устранён)
- **#6 (автор комментария не null):** `author` — объект с userName/avatar, никогда null
- `POST /posts` (фото+видео) → `201`: постер видео, фильтры per-media, музыка, локация, отметка; `usesCount` музыки +1
- Хэштеги: `#travel`+`#Travel` → один тег, кириллический `#закат` распознан; `@упоминание` и отметка → уведомления `MENTION`/`TAG_POST` в БД
- Комментарии: ответ (parentId), лайк (toggle), список с `repliesCount`; **чужой коммент удалить → `403`**, свой → `200`
- Лайк поста (toggle), `/:id/likes` (кто лайкнул), просмотр (**второй раз тем же юзером не удваивается**), избранное + коллекция → виден в `/profile/favorites`
- Share: ссылка / в чат (создаёт чат + `POST_SHARE`) / в историю; report → `201`
- Правка чужого поста → `403`, своего → хэштеги пересобираются; архив → пропал из ленты, виден в `/posts/my?archived=true`; удаление чужого → `403`, своего → `200` → `404`
- Explore исключает свои посты и **приватные аккаунты** (nodira не видна daler'у); reels — только видео
- Swagger: **posts 22**, всего **82 endpoint'а** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 6:**
> - **Один `POST_SELECT` с include на все ленты** — автор, медиа, локация, музыка, отметки, хэштеги, счётчики за один запрос.
>   Это и есть лекарство от 21 секунды: старый API делал отдельный запрос на каждый пост (N+1). Мои лайки/избранное — тоже одним запросом на страницу.
> - **Сортировка по `id DESC`, не `createdAt`**: id монотонен, курсор однозначен, сравнение целых по btree дешевле.
> - **Замер скорости только через `127.0.0.1`**: `localhost` в Windows добавляет ~200 мс на резолв IPv6 — это артефакт curl, не API (health через localhost тоже 210 мс, через 127.0.0.1 — 9 мс).
> - **Удалять комментарий может автор ИЛИ владелец поста** (как в IG — хозяин чистит комментарии у себя). Остальные → 403.
> - **Ответы на комментарии — один уровень**: ответ на ответ прикрепляется к корневому комментарию, иначе дерево бесконечное.
> - **Просмотр и лайк — идемпотентны** (`@@unique postId+userId`): view не удваивается, повторный лайк снимает.
> - **Explore не показывает контент закрытых аккаунтов** (кроме тех, на кого подписан) и заблокированных.
> - **Откат при сбое заливки**: если пост не создался, залитые в S3 файлы удаляются — как в Фазе 2.
> - **`toBool`/`toStringArray` в DTO**: multipart шлёт всё строками, приводим `"true"`→bool, `"a,b"`→string[].
> - Endpoint'ов **22, а не 20**: ТЗ §5.6 перечисляет 20, но `/comments/:id/replies` и `/reels` в списке фигурируют — посчитаны по факту.

## Фаза 7 — Stories + Highlights (17 endpoints) ✅
- [x] `POST /stories` — **мультизагрузка до 10 файлов за раз** → до 10 отдельных Story, image **и video**, `musicId` + `musicStartSec`, `overlays` (JSON), `filter`, `closeFriendsOnly`, `fromPostId` (репост поста в историю)
- [x] `expiresAt = +24ч` + **BullMQ-задача на удаление** (`delay`, `jobId=story-N`) + cron-подстраховка раз в час
- [x] `GET /stories` — рейл: группировка по авторам, `isViewed`/`allViewed` (**на сервере!**), `hasCloseFriends`
- [x] `GET /stories/my`, `/archive`, `/user/:userId`, `/:id`; View, Like (toggle → `{liked, likesCount}`), **Reaction (emoji)**, **Reply**
- [x] Reaction и Reply **уходят сообщением в чат** (type=STORY_REACTION / STORY_REPLY)
- [x] `GET /stories/:id/viewers` — **полный список: кто смотрел + лайкнул + реакция** (только автору)
- [x] Highlights: create / list / `:id` / update / delete — история в актуальном **не удаляется** через 24ч
- ✅ Проверено: 3 файла одним запросом → 3 истории → в актуальное → **BullMQ реально не удалил их, удалил только не-актуальную**

**Проверено живыми запросами (два аккаунта):**
- **Мультизагрузка:** `POST /stories` с 3 файлами → **3 отдельные Story** (2 IMAGE + 1 VIDEO), у всех музыка+startSec, filter, overlays, `expiresAt +24ч`
- **BullMQ:** после создания в Redis — 3 delayed-задачи (`bull:stories:story-22/23/24`)
- **isViewed на СЕРВЕРЕ** (баг softclub #17): до просмотра `false` → `POST /view` → `true` (в БД, не в localStorage); `allViewed` рейла переключился после просмотра всех
- **Like — boolean, не строка** (баг softclub #15): `liked: true` (тип boolean), toggle снимает
- **Реакция ❤️/🔥 → сообщение в чат** (можно много раз, без @@unique); Reply → тоже в чат; проверено по БД: `STORY_REACTION`/`STORY_REPLY` с эмодзи и storyId
- **`GET /viewers`** (баг softclub #16): `daler viewed=true liked=true reaction=🔥`; чужому (не автору) → **`403`**
- **ГЛАВНОЕ — highlights vs 24ч:** истории 22,23 в актуальном, 24 — нет; сдвинул `expiresAt` в прошлое, **реально запустил BullMQ-процессор** → лог «История 22/23 в актуальном — не удаляем», «История 24 удалена». В БД остались **[22,23]**
- Highlights CRUD: create (cover из первой истории), list, `:id` (с историями), update (title+состав), чужой → `403`
- Архив (свои истёкшие), `fromPostId` (репост поста → история id=25 fromPostId=101), приватность (истории приватной nodira → `403`)
- Swagger: **stories 12 + highlights 5 = 17**, всего **99 endpoint'ов** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 7:**
> - **BullMQ впервые.** `JobsModule` (@Global) поднимает очередь на том же Redis. Каждая история при создании ставит
>   задачу с `delay = 24ч` и `jobId=story-N` (повторный запуск не дублирует). Процессор `StoriesProcessor` перед удалением
>   **проверяет `_count.highlights`** — история в «Актуальном» переживает 24ч.
> - **Cron-подстраховка** (`StoriesCron`, раз в час): если Redis был недоступен в момент создания и задача не встала,
>   истёкшие истории (не в актуальном) всё равно подчистятся. BullMQ — основной путь, cron — сеть безопасности.
> - **Мультизагрузка = N отдельных Story**, а не одна с N медиа: в IG каждая история своя, со своим таймером и зрителями.
> - **Реакция/ответ на историю — это Message в чате** (решение из схемы, `messageId` в `StoryReaction`/`StoryReply`).
>   Endpoint'ы чтения чата — Фаза 9, здесь проверено по БД.
> - **isViewed/allViewed только на сервере** через `StoryView` (`@@unique storyId+userId`) — клиент не участвует.
> - **close-friends истории** видны только тем, кого автор добавил в близкие друзья (проверка в `loadVisible` и `rail`).
> - Endpoint'ов **17, а не 16**: ТЗ §5.7 считает 16, но `GET /stories/:id` в списке есть — посчитан по факту.

## Фаза 8 — Notes v2 (8 endpoints) ✅
> Сейчас **9**: добавился `GET /notes/:id` (роута не существовало) + аудитория заметок.
- [x] CRUD заметок: `GET /notes` (свои+подписок), `POST` (text ≤60, musicId, bgColor, TTL 24ч), `PUT /:id`, `DELETE /:id`
- [x] 🆕 `POST /notes/:id/like` — toggle + уведомление LIKE_NOTE
- [x] 🆕 `GET /notes/:id/likes` — список профилей, кто лайкнул (**только автору**)
- [x] 🆕 `POST /notes/:id/reply` — ответ → `findOrCreateDirectChat` → Message(type=NOTE_REPLY, noteId, **noteSnapshot**) → `{chatId, messageId}`
- [x] 🆕 `GET /notes/:id/replies` (**только автору**)
- [x] TTL 24ч через **cron раз в час** (`NotesCron`); нельзя отвечать на свою заметку; BlockGuard/приватность
- ✅ Проверено: лайк → автор видит профиль; ответ → чат у обоих; **заметка умерла → сообщение живо, превью цело**

**Проверено живыми запросами (два аккаунта):**
- CRUD: `POST /notes` → `201` (text, bgColor, музыка, expiresAt +24ч); `text` >60 → `400`; `PUT` меняет текст/цвет; daler видит заметку eraj в ленте (`isMine=false`)
- **Лайк:** daler лайкает → `liked:true`, toggle снимает; **автор eraj видит профиль лайкнувшего** (`GET /likes` → `daler`); чужому → **`403`**
- **Ответ → чат у ОБОИХ:** `POST /reply` → `{chatId:6, messageId:47}`; в БД `Message(NOTE_REPLY)` с участниками `eraj,daler`; ответ на свою → `400`; `GET /replies` только автору (чужому → `403`)
- **ГЛАВНОЕ — noteSnapshot:** заметку удалил (сдвинул expiresAt, `DELETE expired`) → `заметка_есть=0`, но **сообщение в чате живое**: text «Что за трек?» цел, `noteId=NULL` (SetNull), **`noteSnapshot="Новый текст"` сохранил превью** — не сломалось
- **BlockGuard:** заблокированный не лайкает (`403`), не отвечает (`403`), не видит заметку в ленте
- Swagger: **notes 8**, всего **107 endpoint'ов** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 8:**
> - **`noteSnapshot` — снимок текста заметки в момент ответа.** Заметка живёт 24ч, а сообщение-ответ в чате — вечно.
>   `Message.noteId` при удалении заметки становится `NULL` (SetNull), а `noteSnapshot` хранит превью «в ответ на заметку …»,
>   чтобы оно не превратилось в пустоту. Проверено реальным удалением заметки.
> - **`findOrCreateChat` вынесен в общий `ChatUtilService`** (`common/chat/`, @Global). Он был скопирован в posts (share)
>   и stories (reaction/reply) — с добавлением notes стало бы три копии. Оба прежних места переведены на общий сервис.
> - **TTL заметок — простой cron, не BullMQ.** У заметок нет медиа в S3 и нет «актуального» (в отличие от историй),
>   поэтому `deleteMany({ expiresAt lte now })` раз в час достаточно; отдельная задача на каждую заметку избыточна.
> - **Одна активная заметка на юзера**: `POST /notes` удаляет прежние — в IG у профиля висит ровно одна заметка.
> - **`GET /likes` и `GET /replies` — только автору** (приватность реакций на заметку), лайк/ответ — с проверкой блокировки и приватности.
> - `NotifType.LIKE_NOTE` / `REPLY_NOTE` и `MsgType.NOTE_REPLY` уже были в схеме (заложены в Фазе 1).

## Фаза 9 — Chat + Realtime (20 endpoints + Socket.IO) ✅
> Сейчас в чате **30** endpoints: добавились группы и звонки — см. «После Фазы 13».
- [x] `GET /chats` — **lastMessage, lastMessageAt, unreadCount, peer, isOnline, lastSeenAt** (всего этого не было в старом API)
- [x] `GET /chats/:id`, `GET /chats/:id/messages` (cursor), `POST /chats` (идемпотентно, + «Запросы»)
- [x] `POST /chats/:id/messages` — текст / фото / видео / **голосовое (audio)** / стикер / **ответ (replyToId)** / отправка поста
- [x] `PUT /chats/messages/:id` — **редактировать** (≤ 15 мин), `editedAt`
- [x] `DELETE /chats/messages/:id` — **только своё!** чужое → 403 (баг softclub #11)
- [x] `POST /chats/messages/bulk-delete` — удалить несколько (только свои)
- [x] Реакции (`POST/DELETE /chats/messages/:id/reaction`), `POST /chats/:id/read` («Просмотрено»)
- [x] Тема, никнеймы, mute, `DELETE /chats/:id`, report
- [x] **Запросы на переписку**: requests / accept / decline — `@@unique`, повтор после DECLINED обновляет строку
- [x] **Socket.IO `/rt`**: `message:new|edited|deleted`, `message:reaction|read`, `typing:start|stop`, `presence:update`
- [x] Presence в Redis (TTL 60с, heartbeat) + `lastSeenAt` в Postgres
- [x] **Звонки**: `POST /chats/:id/call` (CallSession) + WebRTC-сигналинг `call:offer/answer/ice/end` через сокет
- ✅ Проверено с **двух** клиентов одновременно (socket.io-client)

**Проверено живыми запросами (2 сокет-клиента eraj+daler):**
- **МГНОВЕННАЯ доставка:** `POST message` → daler получил `message:new` через сокет за **25 мс** (не polling)
- **Главная проверка (баг #11):** daler удаляет ЧУЖОЕ сообщение eraj → **`403`**; своё → `200` + `message:deleted` собеседнику
- Realtime-события у второго клиента: `typing:start/stop`, `message:reaction`, `message:edited` (editedAt), `message:read`
- **Presence:** сокет онлайн → `isOnline:true`; отключился → `isOnline:false` + `lastSeenAt` (было в сети)
- **`GET /chats`** отдаёт весь набор: peer, lastMessage, lastMessageAt, unreadCount, isOnline, lastSeenAt
- **Редактирование ≤15 мин** (editedAt), **bulk-delete** (свои 3 удалены, чужие → 0)
- **Запросы на переписку:** неподписанная nigora → `isRequest:true`, попала в `/chats/requests` с lastMessage; decline → **повторная заявка обновляет ту же строку (1, не плодится)** — `@@unique`; accept → в основные
- Настройки: theme/nickname/mute → `200`; `POST /call` → `RINGING`
- **WebRTC-сигналинг:** `call:offer` → собеседник получил, `call:answer`/`call:ice`/`call:end` — все проходят p2p (сервер только передаёт SDP/ICE)
- Swagger: **chats 20**, всего **127 endpoint'ов** · `build` · `lint` · `prisma validate` → зелёные

> **Заметки Фазы 9:**
> - **`RealtimeService` — мост REST↔сокет.** Гейтвей регистрирует в нём `Server`, сервисы вызывают `emitToUsers` без
>   зависимости от гейтвея — иначе была бы циклическая зависимость chat↔gateway. В Фазе 10 тем же мостом полетят уведомления.
> - **Комната на пользователя** (`user:<id>`): персональные события уходят во все его вкладки/устройства.
> - **Presence: Redis (истина) + Postgres (`lastSeenAt`).** Ключ живёт 60с, heartbeat каждые 30с продлевает; пропустил два —
>   офлайн. `lastSeenAt` дублируется в БД, чтобы «был в сети N мин назад» пережил перезапуск Redis.
> - **Авторизация сокета — тем же access-JWT**, токен в `handshake.auth.token`; при disconnect остались другие сокеты юзера — он ещё онлайн.
> - **Удаление сообщения — мягкое** (`isDeleted`, text/media → null): «Сообщение удалено» в чате, история переписки не рвётся.
> - **Запрос на переписку** возникает, если я НЕ подписан на собеседника. `@@unique(from,to)`: повтор после DECLINED
>   обновляет строку в PENDING — **даже если чат уже существовал** (был баг: ранний return на существующем чате пропускал переоткрытие).
> - **Звонок: сервер только сигналит.** `POST /call` создаёт CallSession и шлёт `call:incoming`; сами SDP/ICE идут
>   `call:offer/answer/ice/end` через сокет, медиа — p2p, сервер его не трогает.
> - **`@WebSocketServer()` в namespace-шлюзе — это Namespace, не Server** (был баг `this.server.of is not a function`);
>   `adapter.rooms` берём через `client.nsp.adapter`.
> - Endpoint'ов **20, а не 18**: `GET /chats/:id/messages` и `DELETE .../reaction` в ТЗ подразумеваются, но в счёт «18» не вошли.

## Фаза 10 — Notifications (5 endpoints)
- [x] `EventEmitter2` → `NotificationService` → БД + Socket.IO push
- [x] Все типы: `LIKE_POST · COMMENT_POST · REPLY_COMMENT · LIKE_COMMENT · MENTION · FOLLOW · FOLLOW_REQUEST · FOLLOW_ACCEPTED · LIKE_STORY · STORY_REACTION · STORY_REPLY · SHARE_POST · SAVE_POST · TAG_POST · PROFILE_VIEW · NEW_POST_FROM_FOLLOWING · VERIFICATION_TRIAL_ENDING`
- [x] **Группировка**: «user1 и ещё 5 оценили вашу публикацию»
- [x] `ProfileView` — «кто заходил в твой профиль» (не чаще 1 записи/сутки на пару)
- [x] `unread-count`, `read`, `read-all`
- [x] Себя не уведомляем, заблокированные не уведомляют
- ✅ Лайк с другого аккаунта → уведомление прилетает в сокет **мгновенно** — проверено живьём: латентность ~167 мс

> Заметки Фазы 10:
> - **Статус: код завершён И проверен живыми запросами (2+ аккаунта, socket.io-client).**
> - `NotificationService` — единственная точка записи: `@OnEvent(NOTIFY_EVENT)`. Правила «себя не уведомляем»
>   и «блок не уведомляет» проверяются здесь централизованно (не в каждом сервисе).
> - Эмиттеры `NOTIFY_EVENT`: follow (FOLLOW/FOLLOW_REQUEST/FOLLOW_ACCEPTED),
>   posts (LIKE_POST/SAVE_POST/SHARE_POST/MENTION/TAG_POST/NEW_POST_FROM_FOLLOWING),
>   comments (COMMENT_POST/REPLY_COMMENT/LIKE_COMMENT/MENTION), notes (LIKE_NOTE/REPLY_NOTE),
>   stories (LIKE_STORY/STORY_REACTION/STORY_REPLY), profile (PROFILE_VIEW).
> - `VERIFICATION_TRIAL_ENDING` — тип и текст готовы, эмитится cron'ом Фазы 12 (ещё не реализован).
> - Группировка: окно 300, ключ = тип+цель, уникальные акторы → «actor и ещё N».
> - Пуш: `notification:new` = { notification, unreadCount } мгновенно получателю через RealtimeService.
> - **Живая проверка (docker up, seed):**
>   - A: like от sitora на пост eraj → сокет-пуш `notification:new` за ~167 мс, type=LIKE_POST, строка в БД. ✅
>   - B: 6 разных актёров лайкнули один пост → ОДНА строка в ленте, «firuz и ещё 5», othersCount=5, groupIds=6. ✅
>   - C: eraj лайкнул свой пост → unread не изменился (себя не уведомляем). ✅
>   - D: заблокированный komron лайкнул → unread не изменился (блок не уведомляет). ✅
>   - E: read группы → updated=6, unread 7→1; read-all → 0. ✅
>   - F: `GET /notifications/profile-views` отвечает (items[]). ✅
> - Не проверялось живьём: PROFILE_VIEW-уведомление (нужен заход в профиль) и VERIFICATION_TRIAL_ENDING (cron Фазы 12).

## Фаза 11 — Search + Explore (4 endpoints)
- [x] `GET /search?q=` — аккаунты + хэштеги + локации одним ответом
- [x] `GET /search/explore` — сетка: посты и **видео вперемешку**, с `likesCount` / `commentsCount` (для hover на фронте)
- [x] `GET /search/hashtag/:name`, `GET /search/top` (тренды)
- [x] Full-text: `ILIKE` (insensitive contains) + существующие индексы (userName, fullName, Hashtag.name, Location.city/country)
- ✅ Поиск «er» находит `eraj`, `amerika`, `chessmaster` — проверено живым запросом (все три в выдаче)

> Заметки Фазы 11:
> - **Проверено живьём (curl, seed 20 юзеров / 100 постов / 30 локаций):**
>   - `q=er` → users: [amerika, chessmaster, daler, eraj, sherzod] — три обязательных найдены (подстрока по userName И fullName).
>   - `q=trav` → hashtags: [(travel, 16)]; локации по city/state/country (Berlin, Amsterdam…).
>   - `/search/explore` → VIDEO+IMAGE вперемешку, likesCount/commentsCount есть, cursor (nextCursor), свои посты (eraj) исключены.
>   - `/search/hashtag/travel` → все посты содержат #travel (в seed нет #tj — использован реальный тег).
>   - **BlockGuard:** eraj блокирует daler → daler исчезает и из `/search`, и из `/search/explore`; после снятия блока — возвращается.
>   - Envelope: `q=` (пусто) → 400, `errors: ["q should not be empty"]` (не `["success"]`).
> - **Explore не дублирован** — `/search/explore` и `/search/hashtag/:name` делегируют в `PostsService.explore` (Фаза 6): один источник правды.
> - **Миграция Prisma не потребовалась** — поиск на ILIKE поверх существующих индексов (GIN/tsvector отложены до нагрузочного теста Фазы 13, если понадобится).
> - **PrivacyGuard:** приватные аккаунты видны в `/search` (как в IG), но их посты не попадают в explore/hashtag (фильтр внутри PostsService.explore).
> - `/search/top`: тренд-хэштеги = использование за 7 дней (groupBy PostHashtag), аккаунты недели = прирост ACCEPTED-подписчиков за 7 дней; у обоих честный фолбэк на общий топ, если за неделю пусто.

## Фаза 12 — Locations + Verification + Admin (13 endpoints)
- [x] Locations CRUD — **`PUT` работает** (в старом API 400 AutoMapper) — проверено: PUT → 200, city обновлён
- [x] Verification: `status`, `start-trial` (**7 дней бесплатно, 1 раз**), `subscribe` (**mock-платёж $1000/мес**), `cancel`
- [x] Cron: за 1 день до конца триала → уведомление `VERIFICATION_TRIAL_ENDING`; по истечении → `isVerified = false`
- [x] Admin: users, delete user, reports, resolve — `RolesGuard` (не ADMIN → 403)
- ✅ Триал → галочка появляется → cron по истечении снимает (проверено: isVerified true→false, status EXPIRED)

> Заметки Фазы 12:
> - **Новый `RolesGuard` + `@Roles(Role.ADMIN)`** (`src/common/`) — раньше в проекте не было. Работает после глобального JwtAuthGuard.
> - **Locations CRUD** — доступно любому авторизованному (ТЗ роль не требует). `PUT` — полная замена, существование проверяем явно (иначе Prisma P2025). Удаление безопасно: у постов `locationId → null` (onDelete SetNull).
> - **Verification:** одна строка на юзера (`@id userId`). `trialUsed` — триал ровно 1 раз. `subscribe` → Payment(MOCK, PAID, $1000) + период 30 дней. `cancel` → CANCELED, галочка держится до конца периода, снимает cron.
> - **Cron** `VerificationCron` (EVERY_DAY_AT_MIDNIGHT) → `VerificationService.sweepExpired()` (логика вынесена, чтобы тестировать без ожидания полуночи). Системное уведомление шлётся через новый `NotificationsService.notifySystem()` (actorId=userId, обходит правило «себя не уведомляем» — это сообщение системы).
> - **Живая проверка (14 REST + cron, docker up):**
>   - Locations: POST→201, **PUT→200 city обновлён**, GET подтверждает, DELETE→200. ✅
>   - Verification (jasur): чистый status=null → start-trial→TRIAL/isVerified=true/daysLeft=7 → повтор→**400** «триал уже использован» → subscribe→ACTIVE + Payment(PAID,MOCK)=1 → cancel→CANCELED. ✅
>   - Admin: GET /admin/users(ADMIN)→200, тот же обычным юзером→**403**, reports open→resolve→resolvedAt SET, delete user→isDeleted=true. ✅
>   - Cron: malika TRIAL с trialEndsAt=вчера → sweepExpired() → **isVerified true→false, status EXPIRED**. ✅
> - Не проверялось живьём в сокет: само уведомление VERIFICATION_TRIAL_ENDING (окно «за 1 день»); логика есть, эмиттер тот же notifySystem, что уже проверен в Фазе 10.
> - **13 endpoint'ов ровно по ТЗ** (locations 5 + verification 4 + admin 4).

## Фаза 12.5 — LIVE (Прямые эфиры, 18 endpoints)
> Сейчас **20** (посчитано по факту: `endpoints:report`).
- [x] LiveKit в docker-compose + LiveKitService (publisher / subscriber токены)
- [x] Prisma: Live, LiveViewer, LiveComment, LiveLike, LiveReaction, LiveJoinRequest, LiveGuest
- [x] start / end / feed / :id / user/:userId / join / leave / viewers
- [x] comment / like (много раз!) / reaction (всплывающие смайлы)
- [x] request-join → accept (гость = второй publisher, split-экран) / decline (уведомление отказа)
- [x] PUT /camera (видео выкл → аватар/картинка, ЗВУК ИДЁТ ВСЕГДА) · PUT /audio · kick · stats
- [x] Socket namespace /live: started, viewers, comment, like, reaction,
       join-request, join-accepted, join-declined, guest-joined, camera, ended
- [x] Доступ: подписчик → в рейле историй; НЕ подписчик → только через ПОИСК (профиль → «В эфире»)
- [x] Privacy (закрытый хост → только подписчики) + Block (заблокированный → 403)
- ✅ Проверено (4 сокет-клиента: host+follower+viewer+guest): заявка → принял → гость publisher (split-экран)

> Заметки Фазы 12.5:
> - **`docs/TZ_LIVE_NOTES.md` отсутствует** в репо — реализовано по spec из аргументов /start (полностью покрывает 18 endpoint'ов).
> - **LiveKitService** (livekit-server-sdk 2.13.1): `AccessToken.toJwt()` — async в v2. publisher-грант (canPublish=true) хосту/принятому гостю, subscriber (false) зрителям. RoomServiceClient для closeRoom/removeParticipant (best-effort — падение LiveKit не роняет endpoint). URL ws→http для RoomServiceClient.
> - **Namespace `/live`** (`LiveGateway` + `LiveRealtimeService`-мост, отдельно от `/rt`): клиент сидит в `liveuser:<id>` (личные события), на просмотр подписывается через `live:subscribe` → комната `live:<liveId>`.
> - **Уведомления** (LIVE_STARTED/JOIN_REQUEST/ACCEPTED/DECLINED) идут через существующий NotificationsService (эмит NOTIFY_EVENT), в сокет /rt; live-room-события — через /live.
> - **Токен гостю приватно**: accept шлёт publisher-токен только в `liveuser:<guestId>` (не в комнату) — split-экран.
> - **Камера/звук раздельно**: `PUT /camera` меняет только isCameraOn (видео); звук (isAudioOn) не трогается — «ЗВУК ИДЁТ ВСЕГДА».
> - **Живая проверка (все PASS):**
>   - start→201, host token canPublish=**true**; follower получил `live:started` + эфир в `/live/feed`.
>   - viewer join→subscriber token canPublish=**false**, viewersCount=1.
>   - comment→1, like×3→likesCount=3 (3 события), reaction→1 — всё в комнату.
>   - request-join→хост получил `live:join-request`; accept→гость получил `live:join-accepted` с токеном canPublish=**true** + `live:guest-joined`.
>   - decline→гость получил `live:join-declined`.
>   - camera off→isCameraOn=false (сокет), audio→isAudioOn=true (звук идёт).
>   - viewers→список; kick→зритель получил `live:kicked`.
>   - **Block: заблокированный join→403**; stats (likes/comments/reactions/peak/duration); end→`live:ended`, статус ENDED.
> - Не проверено «вживую» (нужен браузер+WebRTC): реальная передача медиа/split-экран картинкой — но токены с корректными грантами и все события выданы.

## Фаза 13 — Финал: тесты, производительность, деплой ✅
- [x] e2e (Jest + Supertest): auth-флоу, лента, лайк, история, чат, приватный аккаунт, блок, **live** — 16 тестов, все зелёные
- [x] Производительность: лента **< 300 мс** (EXPLAIN ANALYZE = **0.43 мс**, HTTP **8–65 мс**, N+1 устранён)
- [x] Rate-limit (6-й логин → 429), CORS, Helmet (CSP/HSTS/X-Frame/COOP/CORP) — проверено живьём
- [x] Аудит безопасности: `@Public()` только на 11 легитимных роутах, `.env` не в git, глобальный JwtAuthGuard (deny-by-default)
- [x] Swagger `/api/docs` — **167 операций**, экспорт `docs/swagger.json` (`npm run swagger:export`)
- [x] `docker compose down -v → up → migrate → seed` → всё работает с чистого листа (проверено, e2e 16/16)
- [x] Деплой: VPS / Railway / Render — инструкция в README
- [x] `README.md` (английский): стек, архитектура, запуск, API-таблица, 21 баг, фичи, **ER-диаграмма (56 моделей, mermaid)**
- [x] Финальная сверка: `npm run endpoints:report` — таблица модуль→endpoints→✅ (167, 157 под JWT)
- ✅ **Backend готов**

**Проверено живыми запросами (чистый стек: down -v → up → migrate → seed):**
- `npx prisma migrate deploy` → миграция `20260714194128_init` применена к пустой БД
- `npm run seed` → 20 юзеров, 100 постов, 131 подписка, 19 историй, 8 заметок, 5 чатов
- `/api/health` → db/redis/storage = up · **e2e 16/16 PASS** (auth·лента·лайк·история·чат·приват·блок·live)
- Лента seed-юзера (behruz): 20 постов, `hasMore:true` (курсор), медиа на месте, **23–65 мс**
- EXPLAIN ANALYZE ленты = **0.43 мс** (Limit+Sort, без N+1) · rate-limit 6-й логин → **429**
- Helmet-заголовки: CSP, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, COOP, CORP · CORS `Access-Control-Allow-Origin: http://localhost:3001`
- Итоговая таблица (`endpoints:report`): posts 22 · chats 20 · live 18 · profile 14 · users 12 · stories 12 · auth 11 · follow 11 · notes 8 · music 6 · highlights 5 · notifications 5 · locations 5 · search 4 · verification 4 · admin 4 · close-friends 3 · upload 2 · health 1 = **167**

> **Заметки Фазы 13:**
> - **e2e поднимает всё приложение** (`createTestApp` = тот же конвейер, что `main.ts`), ThrottlerGuard в тестах отключён
>   (иначе 5/мин на auth рубил бы серию register/login) — сам rate-limit проверен отдельно живым curl'ом (6-й → 429).
> - **Аплоады в тестах — настоящие JPEG** (генерируются `sharp`), чтобы magic-byte валидация и обработка изображений отработали по-честному.
> - **Порядок e2e-сценариев важен**: тест «блок» необратимо рвёт подписку (в обе стороны), unblock её не восстанавливает —
>   поэтому live-тест переподписывает юзера. Это верное поведение API, а не баг (см. `BACKEND_BUGS.md` #23).
> - **Сборка api-образа через Dockerfile в этом окружении очень медленная** (двойной `npm ci` в alpine со sharp/ffmpeg/livekit —
>   зависал >40 мин). Сам `docker-compose.yml` корректен (Фаза 0 поднимала api-контейнер). Чистый прогон выполнен канонически:
>   инфра-контейнеры + `migrate`/`seed`/API с хоста — тот же код, полное доказательство «с чистого листа».
> - **Скрипты фазы:** `swagger:export`, `endpoints:report`, `er:diagram` — все воспроизводимы, `docs/swagger.json` и `docs/ER.mmd` сгенерированы из кода/схемы (не руками).
> - Реальных публичных роутов **11** (health + music/stream + 9 auth); в swagger-схеме «незащищённых» видно 10 —
>   `/music/:id/stream` помечен замком из-за `@ApiBearerAuth()` на контроллере, но рантайм-доступ публичный (`BACKEND_BUGS.md` #24).

> ⚠️ **Цифры Фазы 13 (167 endpoints) — на момент 2026-07-15.** После неё backend вырос:
> актуальное состояние — в разделе «После Фазы 13» ниже.

---

## После Фазы 13 — пост-релизные работы ✅

> Фаза 13 закрыла ТЗ. Всё, что ниже, — то, что нашлось **после** неё: частью по запросу
> (группы, музыка, звонки), частью при проверках. Раздел ведётся по факту, а не по плану.

### Пост-релиз 1 (2026-07-16) — Spotify + эмодзи + аудит контракта
- [x] Модуль Spotify (поиск/save/unsave), реакции с составными эмодзи (`👨‍👩‍👧‍👦`, `🏳️‍🌈`, `👍🏽`)
- [x] Fail-fast валидация env (Joi) + диагностика `/health`; ключ медиа в БД, URL строится при отдаче
- [x] Авторизация сокета одноразовым тикетом, `docs/socket-events.md`, `GET /auth/me`
- [x] Сверка контракта: **70 лживых полей** в Swagger исправлены (`npm run contract:check`)
- [x] `scripts/smoke.ts` — живая проверка каждого роута из swagger.json

### Пост-релиз 2 (2026-07-17) — безопасность realtime, группы, звонки, музыка
Подробности каждого пункта — в `docs/BACKEND_BUGS.md` (#27–#41).

**Безопасность (обе дыры доказаны живьём, потом закрыты):**
- [x] **#27** сокет пускал в ЧУЖОЙ звонок: `call:offer` с любым `chatId` — членство не проверялось.
      Та же дыра давала фальшивый «печатает…». Починка в `chatPeers` — одно место закрыло оба.
- [x] **#28** `live:subscribe` обходил блокировку: REST `join` → 403, а сокет отдавал комментарии эфира.

**Групповые чаты (#29–31) — их не существовало, хотя схема их предполагала:**
- [x] `GET /chats` фильтровал `isGroup: false` — группа не появилась бы в списке
- [x] `sendMessage` слал `[peer.id]` — в группе сообщение получал ОДИН человек
- [x] Создать / добавить / удалить (админ) / выйти / переименовать + системные строки
- [x] «Печатает…» с аватаром, именем и `displayName`; присутствие каждого участника в `GET /chats/:id`

**Звонки (#36) — на бэкенде было только «позвонить»:**
- [x] Статусы `ONGOING/ENDED/MISSED/DECLINED` никто никогда не выставлял; `MsgType.CALL` не использовался
- [x] `answer` / `decline` / `end` + история + `GET /chats/calls/ice-servers` (STUN/TURN)
- [x] Длительность от «взяли трубку»; не ответили → **MISSED**, а не разговор нулевой длины
- [x] **#38 TURN** (coturn в compose) — без него звонок «работает на Wi-Fi и не работает с телефона»

**Заметки (#32–33):**
- [x] `audience` (FOLLOWERS / CLOSE_FRIENDS) — выбора аудитории не существовало
- [x] Проверка и в ленте, и на прямой заход по id (иначе «близкие друзья» обходились перебором)
- [x] `GET /notes/:id` — роута не было вовсе («Cannot GET»)

**Музыка (#34, #39–41):**
- [x] **Поиск любой песни мира** — `GET /music/online` через Deezer (без ключей и подписки).
      Spotify остался запасным: его `/search` отвечает 403, пока у владельца приложения нет Premium
- [x] Каталог сменный: `MusicProvider` + `Music.provider/externalId` вместо `spotifyId`
- [x] Трек из каталога → в **чат, заметку, пост, историю** (`provider`+`externalId`)
- [x] `AttachedMusicService` — один маппер вместо 4 копий; «играется целиком» = **файл есть у нас**,
      а не «трек не из Spotify». Внешний трек честно отдаёт `isFullTrack: false` и превью

**Проверки (#35, #37):**
- [x] `smoke` 176 → **190/190 роутов**, 214 запросов; голосовое — настоящим mp3 (генерируется ffmpeg)
- [x] **Эфир против настоящего LiveKit**: токен принимает сам LiveKit, комната создаётся,
      `canPublish` подтверждает LiveKit, `end` реально закрывает комнату
- [x] Новые живые проверки: `group` · `notes` · `calls` · `live` · `live:media` · `turn` · `online` · `nextauth`
- [x] `npm run verify:all` — одна команда на всё

**NextAuth (репозиторий фронта):**
- [x] Auth.js v5 поверх нашего бэкенда (Credentials), **дополнительно** — httpOnly-флоу не тронут
- [x] Токен НЕ попадает в `session`; `basePath: /api/nextauth` (иначе перекрыл бы `api/auth/session`)

**Проверено живыми запросами (`npm run verify:all` → exit 0):**
- unit **15/15** · e2e **17/17** · smoke **190/190 роутов, 214 запросов, 0 падений, 15/15 критериев**
- contract **17/0** · socket **13/13** · live **5/5** · **livekit 12/12** · group **24/24**
- notes **24/24** · calls **22/22** · **turn 9/9** (TURN реально выдал relay) · online **25/25** · nextauth **13/13**

> **Заметки пост-релиза:**
> - **Общая причина #27 и #28:** JWT отвечает «кто ты», но не «твоё ли это». На REST это спрашивали
>   guard'ы, а сокет верил `chatId`/`liveId` из payload'а на слово. Guard'ы на сокет не распространяются.
> - **«Играется целиком» трижды выводилось из происхождения трека** (#34, #40, #41), а не из наличия
>   файла — и трижды врало. Лечится не проверкой в каждом месте, а одним маппером.
> - **Тесты врали дважды и это опаснее багов:** `turn-check` печатал «9 гузашт, 0 афтод» и отдавал код
>   127 (`process.exit` при живом UDP-сокете роняет ассерт libuv на Windows); `live-media-check` искал
>   комнату по `live.id`, хотя `roomName` — отдельный UUID, не находил и «успешно» проверял закрытие
>   несуществующей комнаты.
> - **Spotify не чинится кодом:** 403 — ограничение аккаунта владельца приложения. Вывод «ничего не
>   поделать» был неверным: пользователю нужен не Spotify, а песня — каталог заменён.

---

## Итог (актуально на 2026-07-17)

| | Старый API (softclub) | Наш backend |
|---|---|---|
| Endpoints | 57 | **190** (179 под JWT, 11 публичных) |
| Багов | 21 (6 критичных) | 0 известных · 41 найден и закрыт своих (`BACKEND_BUGS.md`) |
| Realtime | нет | Socket.IO |
| Уведомления | **нет ни одного endpoint'а** | 17 типов |
| Истории | картинка + 2 счётчика | видео, музыка, текст, эффекты, close friends, реакции, ответы, актуальное, список зрителей |
| Чат | текст + файл, polling | realtime, реакции, редактирование, голосовые, **группы (до 32)**, темы, запросы, «просмотрено», онлайн |
| Звонки | нет | аудио/видео: RINGING→ONGOING→ENDED, пропущенные, история в переписке, ICE/TURN |
| Музыка | нет | **любая песня мира** (Deezer), в чат/заметку/пост/историю, свои mp3 играют целиком (Range) |
| Заметки | нет | текст, музыка, лайки, ответы→в чат, **подписчики / близкие друзья** |
| Приватность | нет | закрытый аккаунт, блок, близкие друзья, заявки, аудитория заметок |
| Пагинация | сломана | курсорная везде |
| Swagger | пустой | точный (сверяется с живыми ответами: `contract:check`) |
| Проверки | нет | `verify:all`: 190/190 роутов живьём + 12 сценарных скриптов |

---

## Что НЕ сделано (честно)

Ни один пункт не лечится кодом backend'а — поэтому они здесь, а не в задачах.

| Что | Почему | Что нужно |
|---|---|---|
| **Сами RTP-пакеты звонка/эфира** (микрофон, камера) | нужен WebRTC-стек браузера — скриптом не проверить | фронт, Фаза 14. Всё, что до них, доказано: сигналинг 13/13, жизненный цикл 22/22, TURN 9/9, LiveKit 12/12 |
| **TURN на проде** | Render **не пробрасывает UDP** — coturn там не поднимется. Локально проверен по протоколу (relay реально выдан) | VPS с coturn (сервис из compose переносится как есть) либо внешний TURN → задать `TURN_URLS/TURN_USERNAME/TURN_PASSWORD/TURN_EXTERNAL_IP` в Environment. Код готов. Пока не задано — `hasTurn: false`, звонок между мобильными сетями может не собраться |
| **Полный трек из внешнего каталога** | 30-сек превью — потолок и Spotify, и Deezer. Не обходится | положить mp3 в `assets/music/` → `npm run music:import` → трек играет целиком сам собой |
| **Spotify-каталог** | 403 `Active premium subscription required for the owner of the app` — ограничение аккаунта владельца | Premium у владельца Spotify-приложения. **Пользователя не блокирует**: поиск работает через Deezer |
| **Сборка api-образа Dockerfile** | в этом окружении зависает >40 мин (двойной `npm ci` в alpine со sharp/ffmpeg/livekit) | оптимизировать кэш слоёв. Сам `docker-compose.yml` корректен, инфра работает |
| **Регистрация по одному телефону** | SMS-провайдера нет, код сброса уходит только на email | сознательное решение, `docs/TZ.md §5.1` |

**Состояние на 2026-07-17:** 190 endpoints · 56 моделей · 19 enum'ов · 8 миграций ·
`npm run verify:all` → exit 0.
