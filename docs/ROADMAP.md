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