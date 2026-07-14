# ТЗ — ДОПОЛНЕНИЕ: Заметки v2 + Прямые эфиры (Live)

Дополняет `docs/TZ.md`. Всё, что здесь — **обязательно**, как в настоящем Instagram.

---

# ЧАСТЬ A. Заметки v2 (Notes) — лайки и ответы

Заметка живёт над списком чатов. Раньше был только CRUD. Теперь:

- ❤️ На заметку можно **поставить лайк** → автору видно **список профилей**, кто лайкнул
- 💬 На заметку можно **ответить текстом** → ответ **уходит сообщением в чат** между вами двумя
  (в чате видно превью заметки: «Ответ на заметку: <текст>» + сам ответ)
- 🔔 Оба действия шлют **уведомление** автору

## A.1 Схема БД (дополнение)

```prisma
model Note {
  id        Int      @id @default(autoincrement())
  userId    String
  text      String?  @db.VarChar(60)
  musicId   Int?
  bgColor   String?
  createdAt DateTime @default(now())
  expiresAt DateTime                       // +24ч, cron удаляет

  likes     NoteLike[]                     // 🆕
  replies   NoteReply[]                    // 🆕
  @@index([userId, createdAt])
}

model NoteLike {                            // 🆕
  id        Int      @id @default(autoincrement())
  noteId    Int
  userId    String                          // кто лайкнул
  createdAt DateTime @default(now())
  @@unique([noteId, userId])                // повторный лайк = снять (toggle)
  @@index([noteId])
}

model NoteReply {                           // 🆕
  id        Int      @id @default(autoincrement())
  noteId    Int
  userId    String                          // кто ответил
  text      String   @db.VarChar(500)
  messageId Int?                            // ← ID созданного сообщения в чате
  createdAt DateTime @default(now())
  @@index([noteId])
}
```

**Message** дополняется:
```prisma
model Message {
  // ...существующее...
  type      MsgType   // + NOTE_REPLY
  noteId    Int?      // 🆕 на какую заметку ответ (для превью в чате)
}
```
`enum MsgType { TEXT IMAGE VIDEO AUDIO STICKER POST_SHARE STORY_REPLY NOTE_REPLY CALL LIVE_INVITE }`

**NotifType** дополняется: `LIKE_NOTE`, `REPLY_NOTE`.

## A.2 Endpoints (`/notes`) — было 4, стало 8

| Метод | Путь | Описание |
|---|---|---|
| GET | `/notes` | свои + подписок (+ `likesCount`, `isLikedByMe`) |
| POST | `/notes` | text ≤60, musicId, bgColor, TTL 24ч |
| PUT | `/notes/:id` | редактировать свою |
| DELETE | `/notes/:id` | удалить свою |
| 🆕 POST | `/notes/:id/like` | **toggle** → `{ liked, likesCount }` + уведомление |
| 🆕 GET | `/notes/:id/likes` | **список профилей, кто лайкнул** (только автору) |
| 🆕 POST | `/notes/:id/reply` | `{ text }` → **создаёт (или находит) чат** с автором + шлёт `Message(type=NOTE_REPLY, noteId)` → возвращает `{ chatId, messageId }` |
| 🆕 GET | `/notes/:id/replies` | ответы на свою заметку (только автору) |

**Логика `POST /notes/:id/reply`:**
1. Нельзя отвечать на **свою** заметку
2. Проверка `BlockGuard` (заблокирован → 403)
3. `chat = findOrCreateChat(me, note.userId)` (идемпотентно)
4. Создаётся `Message { chatId, senderId: me, type: NOTE_REPLY, noteId, text }`
5. `NoteReply` привязывается к `messageId`
6. Socket: `message:new` → автору; `notification:new` (`REPLY_NOTE`)
7. Если заметка истекла (>24ч) — 404, но **сообщение в чате остаётся навсегда** (превью показывает сохранённый `text` заметки → храним снимок текста в `Message.text` префиксом или отдельным полем `noteTextSnapshot`)

> ⚠️ Важно: заметка умирает через 24ч, а сообщение в чате — **нет**. Поэтому в `Message` сохраняем **снимок** текста заметки (`noteSnapshot String?`), чтобы превью не сломалось.

---

# ЧАСТЬ B. Прямые эфиры (Live) — как в настоящем Instagram

Самая тяжёлая часть проекта. Требует **медиасервера**, обычный WebSocket не тянет.

## B.0 Технология

| Вариант | Оценка |
|---|---|
| **LiveKit** (open-source SFU, self-hosted, Node SDK) | ✅ **Рекомендуется.** Docker-образ, серверный SDK (`livekit-server-sdk`), готовые токены доступа, поддержка 1000+ зрителей, гость в эфире = второй publisher. |
| Mediasoup | мощно, но всё писать руками (роутеры, транспорты, продюсеры) — недели работы |
| Голый WebRTC mesh | работает только до ~5 зрителей — **не подходит** |
| RTMP + HLS (nginx-rtmp) | задержка 10–30 сек — для эфира с реакциями **не годится** |

**Берём LiveKit.** Добавляется в `docker-compose.yml` как ещё один сервис. Наш NestJS:
- создаёт «комнату» (room) на LiveKit
- выдаёт **JWT-токены доступа** (publisher — стримеру, subscriber — зрителям)
- хранит состояние эфира в своей БД
- гоняет чат/реакции/заявки через **свой** Socket.IO (не через LiveKit)

## B.1 Схема БД

```prisma
model Live {
  id             String     @id @default(uuid())
  hostId         String                          // кто ведёт эфир
  roomName       String     @unique              // LiveKit room
  title          String?
  status         LiveStatus @default(LIVE)       // LIVE | ENDED
  isCameraOn     Boolean    @default(true)       // «выключить видео» → показываем аватар/картинку
  coverUrl       String?                         // картинка вместо камеры (если видео выключено)
  isAudioOn      Boolean    @default(true)       // звук ОБЯЗАН идти, даже если камера выключена
  viewersCount   Int        @default(0)          // текущие
  peakViewers    Int        @default(0)
  totalViewers   Int        @default(0)
  likesCount     Int        @default(0)
  startedAt      DateTime   @default(now())
  endedAt        DateTime?
  recordingUrl   String?                         // запись (опционально)

  viewers        LiveViewer[]
  comments       LiveComment[]
  likes          LiveLike[]
  reactions      LiveReaction[]
  joinRequests   LiveJoinRequest[]
  guests         LiveGuest[]
  @@index([hostId, startedAt])
  @@index([status])
}

enum LiveStatus { LIVE ENDED }

model LiveViewer {          // кто сейчас/был в эфире
  id        Int      @id @default(autoincrement())
  liveId    String
  userId    String
  joinedAt  DateTime @default(now())
  leftAt    DateTime?
  @@index([liveId, userId])
}

model LiveComment {         // комментарии в эфире (бегущей строкой)
  id        Int      @id @default(autoincrement())
  liveId    String
  userId    String
  text      String   @db.VarChar(300)
  createdAt DateTime @default(now())
  @@index([liveId, createdAt])
}

model LiveLike {            // ❤️ (можно много раз — как в IG)
  id        Int      @id @default(autoincrement())
  liveId    String
  userId    String
  createdAt DateTime @default(now())
  @@index([liveId])
}

model LiveReaction {        // 😂😮😢👏🔥 — всплывающие смайлы
  id        Int      @id @default(autoincrement())
  liveId    String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  @@index([liveId, createdAt])
}

model LiveJoinRequest {     // «Хочу к тебе в эфир»
  id        Int       @id @default(autoincrement())
  liveId    String
  userId    String                              // кто просится
  status    JoinStatus @default(PENDING)        // PENDING | ACCEPTED | DECLINED
  createdAt DateTime  @default(now())
  decidedAt DateTime?
  @@unique([liveId, userId])
}
enum JoinStatus { PENDING ACCEPTED DECLINED }

model LiveGuest {           // принятый гость — второй publisher в комнате
  id        Int      @id @default(autoincrement())
  liveId    String
  userId    String
  joinedAt  DateTime @default(now())
  leftAt    DateTime?
  @@unique([liveId, userId])
}
```

**NotifType** дополняется:
`LIVE_STARTED` (подписчикам: «X начал(а) прямой эфир») ·
`LIVE_JOIN_REQUEST` (хосту) ·
`LIVE_JOIN_ACCEPTED` / **`LIVE_JOIN_DECLINED`** (гостю — «хост не принял вашу заявку»)

## B.2 Правила доступа (ровно как ты описал)

| Кто | Что может |
|---|---|
| **Подписчик** | Эфир виден **в рейле историй** (первым, с красной плашкой «В ЭФИРЕ»). Заходит, смотрит, пишет, ставит ❤️ и реакции |
| **Не подписчик** | Эфир **НЕ показывается** в рейле. Но если найдёт хоста через **поиск** → на его профиле видит «В эфире» → заходит, смотрит, **комментирует, лайкает, может подписаться прямо из эфира** |
| **Любой зритель** | Может отправить **заявку на участие** («хочу в эфир») |
| **Хост** | Видит заявки, принимает / отклоняет. Принял → гость становится **вторым publisher'ом** (split-экран). Отклонил → гостю приходит **уведомление об отказе** |
| **Приватный аккаунт** | Эфир видят **только принятые подписчики** (`PrivacyGuard`) |
| **Заблокированный** | Эфир не видит вообще (`BlockGuard`) |

**Камера и звук:**
- Видео можно **выключить** → зрителям показывается **аватар хоста** или **загруженная картинка** (`coverUrl`)
- **Звук идёт всегда** — даже с выключенной камерой (это отдельный флаг `isAudioOn`, по умолчанию `true`)
- Выключение видео — это событие `live:camera` в сокет, все зрители мгновенно видят переключение

## B.3 Endpoints (`/live`) — 14

| # | Метод | Путь | Описание |
|---|---|---|---|
| 1 | POST | `/live/start` | `{ title?, coverUrl? }` → создаёт `Live` + LiveKit-комнату → возвращает **publisher-токен** + `roomName`. Шлёт `LIVE_STARTED` **всем подписчикам** + сокет `live:started` (эфир появляется в рейле историй) |
| 2 | POST | `/live/:id/end` | завершить: `status=ENDED`, `endedAt`, комната LiveKit закрывается, все зрители получают `live:ended` со статистикой |
| 3 | GET | `/live/feed` | **активные эфиры моих подписок** → для рейла историй |
| 4 | GET | `/live/:id` | инфо об эфире (+ `isHost`, `canWatch`, `viewersCount`, `likesCount`) |
| 5 | GET | `/live/user/:userId` | активный эфир пользователя (для профиля — «В эфире» + для не-подписчика из поиска) |
| 6 | POST | `/live/:id/join` | войти зрителем → **subscriber-токен LiveKit** + `LiveViewer`. Проверки: `BlockGuard`, `PrivacyGuard`. `viewersCount++` → сокет `live:viewers` |
| 7 | POST | `/live/:id/leave` | выйти → `leftAt`, `viewersCount--` |
| 8 | GET | `/live/:id/viewers` | список зрителей (хосту — полный; зрителям — счётчик + аватарки) |
| 9 | POST | `/live/:id/comment` | `{ text }` → сохраняется + сокет `live:comment` всем |
| 10 | POST | `/live/:id/like` | ❤️ (можно **много раз**, как в IG) → `likesCount++` → сокет `live:like` (анимация сердечек) |
| 11 | POST | `/live/:id/reaction` | `{ emoji }` → сокет `live:reaction` (всплывающие смайлы) |
| 12 | POST | `/live/:id/request-join` | заявка «хочу в эфир» → `LiveJoinRequest(PENDING)` → уведомление + сокет **хосту** |
| 13 | POST | `/live/requests/:reqId/accept` | хост принимает → гостю выдаётся **publisher-токен** → `LiveGuest` → сокет `live:guest-joined` **всем** (split-экран) |
| 14 | POST | `/live/requests/:reqId/decline` | хост отклоняет → гостю **уведомление `LIVE_JOIN_DECLINED`** («хост не принял вашу заявку») |
| + | PUT | `/live/:id/camera` | `{ isCameraOn, coverUrl? }` → сокет `live:camera` (видео выкл → показываем аватар/картинку, **звук продолжается**) |
| + | PUT | `/live/:id/audio` | `{ isAudioOn }` |
| + | POST | `/live/:id/kick/:userId` | хост удаляет гостя/зрителя |
| + | GET | `/live/:id/stats` | после эфира: пик зрителей, всего зрителей, лайки, комментарии |

## B.4 Socket.IO — namespace `/live`

**client → server:** `live:join` · `live:leave` · `live:comment` · `live:like` · `live:reaction` · `live:request-join`

**server → client:**
| Событие | Кому |
|---|---|
| `live:started` | подписчикам (эфир появился в рейле) |
| `live:viewers` `{ count, recentAvatars }` | всем в комнате |
| `live:comment` `{ user, text }` | всем в комнате |
| `live:like` `{ user }` | всем (анимация сердечек) |
| `live:reaction` `{ user, emoji }` | всем (всплывающие смайлы) |
| `live:join-request` `{ user, requestId }` | **только хосту** |
| `live:join-accepted` `{ token }` | гостю (получает publisher-токен) |
| `live:join-declined` | гостю («не приняли») |
| `live:guest-joined` / `live:guest-left` | всем (split-экран) |
| `live:camera` `{ isCameraOn, coverUrl }` | всем (видео вкл/выкл) |
| `live:ended` `{ stats }` | всем |

## B.5 LiveKit — как подключаем

```yaml
# docker-compose.yml (дополнение)
livekit:
  image: livekit/livekit-server:latest
  command: --dev --bind 0.0.0.0
  ports: ["7880:7880", "7881:7881", "7882:7882/udp"]
  environment:
    LIVEKIT_KEYS: "devkey: devsecret"
```

```ts
// src/live/livekit.service.ts
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

createPublisherToken(roomName: string, userId: string) {
  const at = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, { identity: userId });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

createSubscriberToken(roomName: string, userId: string) {
  const at = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, { identity: userId });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  return at.toJwt();
}
```
Гость, которого приняли → ему выдаётся **publisher-токен** → он начинает публиковать свой поток в ту же комнату → фронт рисует split-экран.

Чат, лайки, реакции, заявки — **через наш Socket.IO**, не через LiveKit (так проще хранить в БД и слать уведомления).

## B.6 На фронте (Фаза 14) понадобится

`livekit-client` (npm) — подключение к комнате, `<video>`-треки, mute/unmute, split-экран, оверлей комментариев и всплывающих сердечек.

---

## Итог дополнения

| Модуль | Endpoints |
|---|---|
| Notes v2 (лайки + ответы в чат) | **+4** (было 4 → стало 8) |
| Live | **+18** |
| **Итого проект** | ~137 + 22 = **≈159 endpoint'ов** |