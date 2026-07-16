# Socket.IO — авторизация и события

Источник правды — код гейтвеев (`src/modules/realtime/realtime.gateway.ts`,
`src/modules/live/live.gateway.ts`) и `emit`-вызовы в сервисах. Всё ниже
выписано из них, а не из проекта документации: **имена и payload'ы отличаются
от «ожидаемых»** — см. раздел «Расхождения с ТЗ».

Два независимых namespace:

| Namespace | Зачем | Комнаты |
| --------- | ----- | ------- |
| `/rt`     | чат, typing, presence, уведомления, звонки | `user:<userId>` — автоматически при подключении |
| `/live`   | эфиры | `live:user:<userId>` (авто) + `live:<liveId>` по `live:subscribe` |

---

## 1. Авторизация

### Тикет (основной способ для браузера)

Access-токен лежит в **httpOnly-куке**: из JS его не достать, а cross-origin
сокету браузер куку не отправит. Поэтому токен в `auth` положить нечем.

Решение: `POST /api/socket/ticket` — обычный HTTP-запрос, кука туда доедет.

```
POST /api/socket/ticket        (JWT: кука или Authorization)
→ 200 { "data": { "ticket": "3f1c0a5e-…", "expiresInSec": 30 } }
```

Тикет: **одноразовый**, TTL **30 секунд**, хранится в Redis. Гейтвей сжигает
его атомарно (`GETDEL`) при подключении.

- повторное использование → `disconnect`
- просроченный / несуществующий → `disconnect`
- нет ни `ticket`, ни `token` → `disconnect`

Тикет ничего не даёт, кроме одного подключения: доступа к REST-API у него нет.

### Токен (для клиентов, у которых он на руках)

`auth.token` (или заголовок `Authorization`) продолжает работать — серверные
интеграции и тесты подключаются так. Способ оставлен намеренно.

### Пример подключения

```ts
import { io } from 'socket.io-client';

// 1) Тикет — обычным HTTP-запросом, кука уедет сама
const res = await fetch('https://<api>/api/socket/ticket', {
  method: 'POST',
  credentials: 'include', // ← иначе httpOnly-кука не уйдёт
});
const { data } = await res.json();

// 2) Подключаемся тикетом. НЕ переиспользовать: он уже сгорел.
const socket = io('https://<api>/rt', {
  auth: { ticket: data.ticket },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('готово'));

// Реконнект: тикет одноразовый — на каждую попытку нужен новый.
socket.io.on('reconnect_attempt', async () => {
  const r = await fetch('https://<api>/api/socket/ticket', {
    method: 'POST',
    credentials: 'include',
  });
  socket.auth = { ticket: (await r.json()).data.ticket };
});

socket.on('message:new', (msg) => { /* MessageDto */ });
```

Для эфиров — тот же тикет, но новый (одноразовый!), namespace `/live`:

```ts
const live = io('https://<api>/live', { auth: { ticket: freshTicket } });
live.emit('live:subscribe', liveId); // без этого события эфира не придут
```

---

## 2. `/rt` — server → client

| Событие | Payload |
| ------- | ------- |
| `message:new` | `MessageDto` |
| `message:edited` | `MessageDto` |
| `message:deleted` | `{ id: number, chatId: number }` — одиночное удаление |
| `message:deleted` | `{ ids: number[], chatId: number }` — bulk-delete |
| `message:reaction` | `{ messageId: number, userId: string, emoji: string \| null }` — `null` = реакция снята |
| `message:read` | `{ chatId: number, userId: string, readAt: Date }` |
| `chat:theme` | `{ chatId: number, theme: string }` |
| `typing:start` | `{ chatId: number, userId: string }` |
| `typing:stop` | `{ chatId: number, userId: string }` |
| `presence:update` | `{ userId: string, isOnline: boolean, lastSeenAt: Date }` |
| `notification:new` | `{ notification: NotificationDto, unreadCount: number }` |

### Звонки (сигналинг)

Реализованы. Сервер только **передаёт** SDP/ICE между участниками чата —
медиа идёт p2p, сервер его не видит и не хранит.

| Событие | Payload |
| ------- | ------- |
| `call:incoming` | `{ callId: number, chatId: number, type: string, fromUserId: string }` — шлётся после `POST /chats/{id}/call` |
| `call:offer` | `{ chatId: number, fromUserId: string, sdp: unknown }` |
| `call:answer` | `{ chatId: number, fromUserId: string, sdp: unknown }` |
| `call:ice` | `{ chatId: number, fromUserId: string, candidate: unknown }` |
| `call:end` | `{ chatId: number, fromUserId: string }` |

## 3. `/rt` — client → server

| Событие | Аргумент | Что делает |
| ------- | -------- | ---------- |
| `heartbeat` | — | продлевает presence (слать ~раз в 30 с) |
| `typing:start` | `chatId: number` | → `typing:start` собеседникам |
| `typing:stop` | `chatId: number` | → `typing:stop` собеседникам |
| `call:offer` | `{ chatId, sdp }` | → `call:offer` собеседникам |
| `call:answer` | `{ chatId, sdp }` | → `call:answer` |
| `call:ice` | `{ chatId, candidate }` | → `call:ice` |
| `call:end` | `{ chatId }` | → `call:end` |

`fromUserId` сервер проставляет сам — подделать отправителя нельзя.

---

## 4. `/live` — server → client

Комната эфира — только после `live:subscribe`. Персональные события
(`live:started`, `live:join-*`, `live:kicked`) приходят в `live:user:<id>` без
подписки.

| Событие | Payload | Кому |
| ------- | ------- | ---- |
| `live:started` | `{ live: LiveDto }` | подписчикам хоста |
| `live:ended` | `{ liveId: string }` | комната эфира |
| `live:viewers` | `{ liveId: string, viewersCount: number }` | комната |
| `live:comment` | `LiveCommentDto` | комната |
| `live:like` | `{ liveId: string, userId: string, likesCount: number }` | комната |
| `live:reaction` | `{ liveId: string, userId: string, emoji: string }` | комната |
| `live:camera` | `{ liveId: string, isCameraOn: boolean, coverUrl: string \| null }` | комната |
| `live:audio` | `{ liveId: string, isAudioOn: boolean }` | комната |
| `live:guest-joined` | `{ liveId: string, userId: string }` | комната |
| `live:guest-left` | `{ liveId: string, userId: string }` | комната |
| `live:join-request` | `{ liveId: string, request: JoinRequestDto }` | **хосту** лично |
| `live:join-accepted` | `{ liveId: string, token: string, wsUrl: string }` | гостю лично — `token` уже **publisher** |
| `live:join-declined` | `{ liveId: string }` | гостю лично |
| `live:kicked` | `{ liveId: string }` | выгнанному лично |

## 5. `/live` — client → server

| Событие | Аргумент |
| ------- | -------- |
| `live:subscribe` | `liveId: string` |
| `live:unsubscribe` | `liveId: string` |

---

## 6. Расхождения с ТЗ

Имена и payload'ы в задании были предположением. Реальность:

| Ожидалось в ТЗ | На самом деле |
| -------------- | ------------- |
| `typing` (обе стороны), `{ chatId, userId, isTyping }` | **два** события `typing:start` / `typing:stop`, payload `{ chatId, userId }` — без `isTyping` |
| `message:read` → `{ chatId, messageId, userId }` | `{ chatId, userId, readAt }` — **`messageId` нет**: прочитывается весь чат целиком, не отдельное сообщение |
| `live:like` → `{ liveId, likesCount }` | `{ liveId, userId, likesCount }` — есть ещё `userId` |
| `live:join-request` → `JoinRequestDto` | `{ liveId, request: JoinRequestDto }` — DTO **вложен** в `request` |
| `live:comment` → `LiveCommentDto` | совпадает |
| `live:viewers` → `{ liveId, viewersCount }` | совпадает |
| «звонки не описаны» | реализованы полностью: `call:incoming` + `offer`/`answer`/`ice`/`end` |
