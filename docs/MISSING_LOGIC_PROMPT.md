# PROMPT: недостающая логика бэкенда относительно «настоящего» Instagram

> Это **готовый промпт** для Claude Code. Скопируй его целиком (или скажи «делай docs/MISSING_LOGIC_PROMPT.md, фаза N»).
> Составлен по РЕАЛЬНОМУ коду репозитория (проверено, не по догадкам) на 2026-07-18.
> Эталон поведения — приложение Instagram. Каждая задача: что делает IG → что у нас сейчас (с ссылкой на файл) → что построить → как проверить.

## Роль и правила (не нарушать)
- Стек не меняем: NestJS 11 · Prisma · PostgreSQL 16 · Redis · Socket.IO · BullMQ. См. `CLAUDE.md`.
- **ТАХМИН МАНЪ**: каждый новый endpoint проверяется реальным запросом (curl/Postman), а не «должно работать».
- Каждый модуль: controller + service + dto + entity. Бизнес-логика только в service. Guards: JwtAuth · Owner · Roles · Block · Privacy.
- Ответ-конверт `{ data, errors, statusCode }` (ResponseInterceptor). Пагинация везде cursor-based.
- После каждой фазы: `npm run build` + e2e-проверка + отметить пункт в `docs/ROADMAP.md`.
- Не ломать существующее: 199 endpoint уже работают (feed, stories, chat, live, notes, calls, verification).

## Что УЖЕ есть (чтобы не переделывать)
Проверено по `src/modules/*`: auth (+refresh, forgot-password по e-mail коду), profile, users (+`GET /users/suggestions` — друзья-друзей по числу общих подписок), follow (+requests, block), posts (feed, explore, reels, like, comment, favorite/collections, share, archive, tag+accept/decline, report), stories (+view, like, reaction, reply, viewers, highlights, archive, авто-удаление через cron), chat (группы, реакции, реквесты, звонки+TURN, темы, ники, mute-чата), live (гости, реквесты, реакции, kick, stats), notes (+like, reply), notifications (+profile-views), search (explore, top, hashtag), music/spotify, locations, verification, admin, upload (Cloudinary/S3).

---

## ФАЗА 1 — Ранжирование ленты (Feed Ranking) 🔴 приоритет ✅ СДЕЛАНО (2026-07-18, см. ROADMAP.md)
**IG:** лента не хронологическая — посты ранжируются моделью по предсказанному интересу: близость к автору (частота лайков/сообщений/просмотров), свежесть, тип контента, вероятность лайка/комментария/сохранения. Уже увиденные посты опускаются/помечаются («You're all caught up»).
**Сейчас:** `src/modules/posts/posts.service.ts:279` `feed()` — чистый `orderBy: { id: 'desc' }` по подпискам + свои. Ранжирования нет. `PostView` (см. `schema.prisma:507`) существует, но лента его НЕ учитывает — уже просмотренные показываются снова.
**Построить:**
1. `FeedRankingService`: скоринг кандидатов за окно (напр. посты подписок за 7 дней) по формуле `score = w1·affinity + w2·recency + w3·engagementRate − w4·alreadySeen`.
   - `affinity(viewer, author)` = f(лайки/комменты/просмотры/сообщения между ними за 30 дней). Кэшировать в Redis (TTL 1ч).
   - `recency` = экспоненциальное затухание по `createdAt`.
   - `engagementRate` = (likes+comments·2+saves·3) / max(views,1).
2. Флаг `feed_ranked` (env/настройка) — чтобы можно было откатиться на хронологию.
3. Секция «Suggested posts» в конце ленты (посты не-подписок с высоким engagement) — как IG вставляет рекомендации.
4. «You're all caught up» — маркер, когда все посты подписок за N часов уже во `PostView`.
**Проверить:** два аккаунта, A часто лайкает B и редко C → посты B выше C в `/posts/feed`. Просмотренные (`POST /posts/:id/view`) не всплывают вверх при повторном запросе.

## ФАЗА 2 — Персонализация Explore и Reels 🔴 ✅ СДЕЛАНО (2026-07-18, см. ROADMAP.md)
**IG:** Explore и лента Reels — персональные, по интересам (хэштеги/аккаунты, с которыми ты взаимодействовал), с дедупликацией авторов и подмешиванием свежего вирусного контента.
**Сейчас:** `posts.service.ts:299` `explore()` и `reels()` (`:336`) — `orderBy: { id: 'desc' }`, только фильтр приватности/блоков. Никакой персонализации, один автор может занять весь экран.
**Построить:**
1. Профиль интересов пользователя: топ хэштегов/категорий из его лайков, просмотров, сохранений (таблица `UserInterest` или агрегация в Redis).
2. Explore-скоринг: engagementRate поста × совпадение с интересами × свежесть; **дедуп по автору** (не более 1–2 подряд).
3. Reels-лента: то же, но `isReel=true`, плюс учёт досмотра (когда появится `watchTime`), сигнал «переходы по аудио».
**Проверить:** пользователь, лайкавший #travel, видит в `/search/explore` больше travel-контента, чем нейтральный аккаунт; в выдаче нет 3+ постов одного автора подряд.

## ФАЗА 3 — Интерактивные стикеры историй 🟠 ✅ СДЕЛАНО (2026-07-18, см. ROADMAP.md)
**IG:** в историях есть опросы (poll), викторина (quiz), вопросы (questions), слайдер эмодзи (slider), обратный отсчёт (countdown), ссылка (link), упоминание, локация, хэштег, музыка — со сбором ответов и статистикой для автора.
**Сейчас:** `Story.overlays Json?` (`schema.prisma:720`) хранит статичные наложения; логики взаимодействия НЕТ. Есть только view/like/reaction/reply.
**Построить:**
1. Модели: `StorySticker` (тип, geometry, конфиг) и ответы: `StoryPollVote`, `StoryQuizAnswer`, `StoryQuestionResponse`, `StorySliderVote`.
2. Endpoints: `POST /stories/:id/stickers/:stickerId/answer` (унифицированно по типу), `GET /stories/:id/stickers/:stickerId/results` (только автору).
3. Уведомления автору о новых ответах; ответы на «вопросы» можно репостить в свою историю.
4. Link-стикер: учитывать право (в IG раньше по порогу подписчиков — у нас можно всем или verified).
**Проверить:** создать историю с опросом, вторым аккаунтом проголосовать, автор видит проценты; повторный голос одного юзера меняет, а не плодит запись.

## ФАЗА 4 — Черновики и отложенная публикация 🟠 ✅ СДЕЛАНО (2026-07-18, см. ROADMAP.md)
**IG:** черновики постов/reels; для бизнес/creator — запланированная публикация.
**Сейчас:** нет ничего (`grep draft|schedule` — только stories/verification cron). Пост создаётся сразу.
**Построить:**
1. `Post.status: DRAFT | SCHEDULED | PUBLISHED` + `Post.scheduledAt`. Черновики/запланированные не попадают в ленты/профиль.
2. `POST /posts` с `status=draft|scheduled`; `GET /posts/drafts`; `PUT /posts/:id/publish`.
3. BullMQ-джоба публикации по `scheduledAt` (у нас BullMQ уже в стеке).
**Проверить:** создать scheduled-пост на +2 мин, убедиться что его нет в `/posts/my`, через 2 мин cron публикует и он появляется.

## ФАЗА 5 — Закрепление и управление контентом 🟠
**IG:** закрепить до 3 постов в профиле; закрепить комментарий; отключить/скрыть счётчик лайков на посте; выключить комментарии на конкретном посте.
**Сейчас:** глобальный `whoCanComment` есть (`UserSettings`, `schema.prisma:595`), но **по-постовых** нет: пина постов/комментариев нет, скрытия числа лайков нет (`grep pin|hideLike` — пусто).
**Построить:**
1. `Post.pinnedAt` + `POST /posts/:id/pin` / `DELETE` (max 3, отдавать закреплённые первыми в `/posts/my`).
2. `Comment.pinnedAt` + `POST /posts/:postId/comments/:id/pin` (только автор поста).
3. `Post.hideLikeCount Boolean`, `Post.commentsDisabled Boolean` — учитывать в DTO и при добавлении комментария.
**Проверить:** закрепить 4-й пост → 400; скрыть лайки → в DTO число скрыто для чужих, автору видно.

## ФАЗА 6 — Vanish mode и исчезающие сообщения 🟢 ✅ СДЕЛАНО (2026-07-18, см. ROADMAP.md)
**IG:** vanish mode в директе — сообщения исчезают после прочтения и выхода из чата; медиа «просмотр один раз».
**Сейчас:** нет (`grep vanish|disappearing` — пусто). Есть обычные сообщения, реакции, реквесты.
**Построить:**
1. `Message.expiresAfterRead Boolean` / `viewOnce Boolean`; удаление/скрытие после `MessageRead` + выхода (событие через socket).
2. Режим чата `vanish` (эфемерный) — новые сообщения помечаются исчезающими.
**Проверить:** включить vanish, отправить, прочитать вторым аккаунтом, выйти — сообщение исчезает у обоих.

## ФАЗА 7 — Ремиксы Reels и «Add Yours» 🟢
**IG:** Remix (снять рядом с чужим reel), «Add Yours» стикер-цепочка в историях, оригинальное аудио и «использовать это аудио».
**Сейчас:** нет (`grep remix|addYours` — пусто). Музыка привязывается к посту/истории, но цепочек/ремиксов нет.
**Построить:**
1. `Post.remixOfId Int?` (self-relation) → в reel показывать «Remix of @author».
2. `Story` «Add Yours»: `AddYoursPrompt` + лента ответивших (`GET /stories/add-yours/:promptId`).
3. «Use this audio»: `GET /music/:id/reels` — все reels с этим треком.
**Проверить:** создать remix существующего reel → в DTO виден `remixOf`; открыть аудио → список reels с ним.

## ФАЗА 8 — Инсайты для авторов (Insights) 🟢
**IG:** аналитика поста/истории/аккаунта: охват, показы, вовлечённость, источники трафика, приросты подписчиков, демография.
**Сейчас:** нет (`grep insight|reach|impression` — пусто). Есть только сырые `PostView`/`StoryView`/`ProfileView`.
**Построить:**
1. `GET /posts/:id/insights`, `GET /stories/:id/insights`, `GET /profile/insights?period=7d` — агрегации по существующим view/like/comment/save/share + приросту `Follow` за период.
2. Разбивка «подписчики vs не-подписчики», топ-источники (feed/explore/profile/hashtag) — потребует writing `source` в `PostView` при просмотре.
**Проверить:** набрать просмотры/лайки на пост → `/posts/:id/insights` отдаёт корректные суммы и engagement-rate.

## ФАЗА 9 — 2FA и безопасность аккаунта 🟠
**IG:** двухфакторная аутентификация (TOTP/SMS), список активных сессий с возможностью выйти, письма о новом входе.
**Сейчас:** только forgot-password по e-mail коду (`auth.service.ts:225`). 2FA/TOTP нет (`grep 2fa|totp` — пусто). `RefreshToken` хранит `userAgent/ip` (`schema.prisma:281`), но endpoint «мои сессии/выйти отовсюду» отсутствует.
**Построить:**
1. TOTP: `POST /auth/2fa/setup` (secret+QR otpauth://), `POST /auth/2fa/enable` (проверка кода), `POST /auth/2fa/verify` в логине, backup-коды.
2. Сессии: `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/logout-all` (ревок всех refresh, кроме текущего).
3. Письмо-уведомление о входе с нового устройства (Nodemailer уже есть).
**Проверить:** включить 2FA, войти — требуется код; убить чужую сессию — её refresh перестаёт работать.

## ФАЗА 10 — Совместные посты (Collab) 🟢
**IG:** пост/reel с соавтором — виден в профиле обоих, лайки/комментарии общие.
**Сейчас:** нет (`grep collab|coauthor` — пусто). `PostTag` есть, но это отметки, не соавторство.
**Построить:**
1. `PostCollaborator` (postId, userId, status PENDING/ACCEPTED) + `POST /posts/:id/collaborators`, accept/decline.
2. Пост показывается в `/posts/my` каждого ACCEPTED-соавтора; в шапке DTO — список авторов.
**Проверить:** пригласить соавтора, он принимает → пост есть в профилях обоих.

---

## Порядок выполнения
🔴 Фазы 1–2 (ранжирование ленты и Explore/Reels) дают наибольший «эффект настоящего Instagram» — начинать с них.
🟠 Фазы 3, 4, 5, 9 — заметные фичи, средняя сложность.
🟢 Фазы 6, 7, 8, 10 — «вишенки», можно позже.

Каждую фазу вести по правилам `CLAUDE.md`: одна фаза за сессию, план перед стартом, отчёт (что сделано / что проверено / что осталось), отметка в `docs/ROADMAP.md`.
