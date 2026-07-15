# Instagram Backend

A production-shaped **Instagram clone backend** built with **NestJS 11 + Prisma + PostgreSQL**.
**167 REST endpoints** across 19 modules, real-time chat & notifications over Socket.IO, live
streaming via LiveKit, cursor pagination everywhere, and a single response envelope
`{ data, errors, statusCode }`.

Built as a from-scratch replacement for a legacy `softclub-API` that shipped 57 endpoints with
**21 known bugs** — every one of which is fixed here (see [table below](#why-its-better-than-the-legacy-softclub-api)).

---

## Tech stack

| Area | Choice |
|---|---|
| Framework | NestJS 11 · TypeScript (strict, `any` banned) |
| Database | PostgreSQL 16 · Prisma ORM (56 models, 17 enums) |
| Cache / presence / queues | Redis 7 · BullMQ |
| Realtime | Socket.IO (`/rt` chat & presence, `/live` streaming rooms) |
| Live video | LiveKit (SFU) — publisher/subscriber tokens |
| Media | MinIO / S3 · `sharp` (image resize + EXIF strip) · `ffmpeg` (video poster, duration) |
| Auth | JWT access (15 m) + refresh (30 d, rotated, SHA-256 at rest) · bcrypt |
| Mail | Nodemailer (MailHog in dev, any SMTP in prod) |
| Docs | `@nestjs/swagger` — generated from DTOs, always accurate |
| Validation | `class-validator` (`whitelist` + `forbidNonWhitelisted`) |
| Rate limiting | `@nestjs/throttler` (100/min global, 5/min on auth) |
| Security | Helmet, CORS, global JWT guard (deny-by-default) |

---

## Architecture

### Modules (19)
`auth · users · profile · follow · close-friends · music · posts · stories · highlights · notes ·
chats · notifications · search · locations · verification · admin · live · upload · health`

Every module is **controller + service + dto**. Business logic lives **only** in services;
controllers wire HTTP to services and declare Swagger metadata.

### Guards (deny-by-default)
- **`JwtAuthGuard`** — registered as a global `APP_GUARD`: **every** route is closed unless
  explicitly opened with `@Public()`. This is why adding a new endpoint can never accidentally
  leave it unauthenticated.
- **`ThrottlerGuard`** — global rate limit; auth routes tightened to 5/min via `@Throttle`.
- **`RolesGuard`** (`@Roles(Role.ADMIN)`) — admin endpoints.
- **`BlockGuard`** — a blocked user cannot see the profile, write, or appear in search.
- **`PrivacyGuard`** — private accounts expose their profile but hide content
  (posts/reels/tagged/followers/following) from non-approved followers.
- **`OwnerGuard`** semantics — you can only edit/delete your own messages/posts/comments.

`AccessService` is the single source of truth for block/privacy decisions; the guards are thin
wrappers over it, so runtime behaviour and guards can never drift apart.

### Response envelope
A global `ResponseInterceptor` wraps every success as `{ data, errors: null, statusCode }`;
`AllExceptionsFilter` maps errors (including Prisma codes) to
`{ data: null, errors: [...], statusCode, code }`. `errors` is **never** populated on success.

### Realtime
- **`/rt`** namespace — chat delivery (`message:new|edited|deleted`, reactions, read receipts),
  `typing:*`, `presence:update`, and WebRTC call signalling (`call:offer/answer/ice/end`).
  Presence lives in Redis (60 s TTL + heartbeat) with `lastSeenAt` mirrored to Postgres.
- **`/live`** namespace — live-stream rooms (`live:started/viewers/comment/like/reaction/
  join-request/join-accepted/guest-joined/camera/ended`). LiveKit issues publisher tokens to the
  host and accepted guests (split-screen), subscriber tokens to viewers.
- `RealtimeService` / `LiveRealtimeService` are REST↔socket bridges so services emit events
  without a circular dependency on the gateways.

---

## Getting started

### Prerequisites
Docker + Docker Compose. (Node 22 only needed if you want to run the API outside Docker.)

### 1. Configure
```bash
cp .env.example .env      # defaults work out of the box for local dev
```

### 2. Bring up infrastructure + API
```bash
docker compose up -d      # postgres, redis, minio, livekit, mailhog, api
```

> **Note on Postgres port:** the container publishes on host port **5433** (5432 is often taken by
> a local Postgres install). Inside the Docker network the service is still `postgres:5432`.

### 3. Migrate + seed
```bash
npx prisma migrate deploy         # apply migrations
npm run seed                      # 20 users, 100 posts, stories, notes, chats, 30 locations…
```

### 4. Explore
- API base: `http://localhost:3000/api`
- **Swagger UI: `http://localhost:3000/api/docs`** (167 endpoints, 🔒 on protected routes)
- Health: `http://localhost:3000/api/health`
- MailHog (dev email): `http://localhost:8025`
- MinIO console: `http://localhost:9001`

### From a clean slate
```bash
docker compose down -v            # wipe volumes
docker compose up -d
npx prisma migrate deploy
npm run seed
```

---

## API overview

| Module | Endpoints | Highlights |
|---|--:|---|
| **auth** | 11 | register/login (by userName·email·phone)/refresh/logout, password reset via email code, 9 public + 2 protected |
| **users** | 12 | search (userName **and** fullName substring), search history with `createdAt`, suggestions, soft-delete, report |
| **profile** | 14 | me / other, edit, privacy toggle, avatar up/down (delete never breaks login), tabs (posts/reels/tagged/favorites/saved-music), activity |
| **follow** | 11 | follow/unfollow, follow requests (private accounts), block/unblock/list, remove follower |
| **close-friends** | 3 | get / add / remove |
| **music** | 6 | search, trending, save, **mp3 streaming with HTTP Range (206)** |
| **posts** | 22 | create (≤10 photo/video), **feed < 300 ms**, explore, reels, like/view/favorite/share/report, comments + replies, hashtags + mentions |
| **stories** | 12 | multi-upload → N stories, music + overlays, view/like/**reaction/reply → chat**, viewers list (author only) |
| **highlights** | 5 | create/list/get/update/delete — survive the 24 h expiry |
| **notes** | 8 | CRUD (24 h TTL), like + likers, reply → direct chat with a note snapshot |
| **chats** | 20 | realtime messaging, edit (≤15 m), owner-only delete, reactions, voice, message requests, mute/theme/nickname, calls |
| **notifications** | 5 | 17 types, grouping ("user1 and 5 others…"), profile-views, unread-count / read / read-all |
| **search** | 4 | accounts + hashtags + locations, explore grid, hashtag feed, trends |
| **locations** | 5 | CRUD (PUT actually works — legacy bug #10) |
| **verification** | 4 | status, 7-day trial (once), mock subscription, cancel |
| **admin** | 4 | users, delete user, reports, resolve (`RolesGuard`) |
| **live** | 18 | start/end/feed/join/leave/viewers, comment/like/reaction, guest join-requests (split-screen), camera/audio, kick, stats |
| **upload** | 2 | multipart upload (magic-byte validation), delete |
| **health** | 1 | db/redis/storage status |
| **Total** | **167** | 157 JWT-protected · 10 public |

Full request/response schemas: **`/api/docs`** or [`docs/swagger.json`](docs/swagger.json).

---

## Why it's better than the legacy softclub-API

The frontend team logged 21 bugs in the old API. None are reproduced here:

| # | softclub bug | This backend |
|---|---|---|
| 1 | `errors: ["success"]` on success | `errors` is `null` on success, populated only on error |
| 2 | delete avatar → `image = null` → login 500 | avatar `null` is fine, login unaffected |
| 3 | feed without `UserId` → empty | `userId` taken from JWT |
| 4 | feed ignores pagination | cursor pagination everywhere |
| 5 | feed responds in 21 s | **< 300 ms** (indexes + `select` + no N+1); measured ~12 ms |
| 6 | `comments[].userName` always `null` | comment always includes its author |
| 7 | `get-my-posts` a bare array | single envelope on every endpoint |
| 8 | `gender` read as string, written as number | symmetric enum `MALE/FEMALE/OTHER/HIDDEN` |
| 9 | `delete-user` → 403 for everyone | user deletes own account (soft-delete, 30-day window) |
| 10 | `update-Location` → 400 AutoMapper | works |
| 11 | `delete-message` ignores ownership | guard checks `senderId === user.id` |
| 12 | typos `massageId`, `sendMassageDate` | correct `messageId`, `sentAt` |
| 13 | `get-chats` lacks last message / unread | returns lastMessage, lastMessageAt, unreadCount, peer, isOnline |
| 14 | no realtime | Socket.IO |
| 15 | `LikeStory` returns `"Liked"` | `{ liked: boolean, likesCount: number }` |
| 16 | viewer DTO is counts only | full viewers list with likes & reactions |
| 17 | API can't tell if **I** viewed a story | `isViewed` computed server-side from `StoryView` |
| 18 | empty message accepted | validation: text **or** media required |
| 19 | no `createdAt` on search history | `createdAt` everywhere |
| 20 | empty Swagger | Swagger generated from DTOs |
| 21 | only `PageNumber/PageSize` pagination | cursor-based pagination |

| | Legacy softclub | This backend |
|---|---|---|
| Endpoints | 57 | **167** |
| Known bugs | 21 (6 critical) | 0 |
| Realtime | none | Socket.IO (chat + notifications + live) |
| Notifications | no endpoints | 17 types, grouped, pushed live |
| Stories | image + 2 counters | video, music, text/effects, close friends, reactions, replies, highlights, viewer list |
| Chat | text + file, polling | realtime, reactions, edit, voice, calls, themes, requests, read receipts, presence |
| Privacy | none | private accounts, block, close friends, requests |
| Pagination | broken | cursor everywhere |

---

## Feature highlights

- **Stories & Highlights** — 24 h TTL enforced by a BullMQ delayed job + hourly cron safety net;
  reactions/replies become chat messages; highlights survive expiry.
- **Music** — real mp3 streaming with HTTP `Range` (206 Partial Content), ID3 import script.
- **Live streaming** — LiveKit rooms, viewer/guest roles, split-screen guests, live comments &
  floating reactions, host camera/audio controls, end-of-stream stats.
- **Chat** — realtime delivery (~25 ms), editing, owner-only delete, voice notes, message
  requests from non-followers, reactions, read receipts, presence, WebRTC call signalling.
- **Notifications** — 17 types via `EventEmitter2`, grouped, pushed over Socket.IO (~167 ms).
- **Privacy & safety** — private accounts, follow requests, blocking (severs follows both ways),
  close friends, reporting, admin moderation.
- **Verification** — 7-day free trial (once), mock paid subscription, cron sweeps expiry.
- **Auth hardening** — refresh rotation with reuse detection (revokes all sessions),
  one-time reset tokens (Redis `jti`), no user enumeration on password reset.

---

## Database schema (56 models)

```mermaid
erDiagram
  User ||--o{ Profile : has
  Location |o--o{ Profile : has
  User ||--o{ RefreshToken : has
  User ||--o{ EmailCode : has
  User ||--o{ Presence : has
  User ||--o{ Verification : has
  User ||--o{ Payment : has
  User ||--o{ Follow : follower
  User ||--o{ Follow : following
  User ||--o{ Block : blocker
  User ||--o{ Block : blocked
  User ||--o{ CloseFriend : owner
  User ||--o{ CloseFriend : friend
  User ||--o{ Post : has
  Location |o--o{ Post : has
  Music |o--o{ Post : has
  Post ||--o{ PostMedia : has
  User ||--o{ SavedMusic : has
  Music ||--o{ SavedMusic : has
  Post ||--o{ PostLike : has
  User ||--o{ PostLike : has
  Post ||--o{ PostView : has
  User ||--o{ PostView : has
  User ||--o{ Collection : has
  Post ||--o{ Favorite : has
  User ||--o{ Favorite : has
  Collection |o--o{ Favorite : has
  Post ||--o{ Share : has
  User ||--o{ Share : sender
  User |o--o{ Share : receiver
  Post ||--o{ PostTag : has
  User ||--o{ PostTag : has
  Post ||--o{ Comment : has
  User ||--o{ Comment : has
  Comment |o--o{ Comment : parent
  Comment ||--o{ CommentLike : has
  User ||--o{ CommentLike : has
  Post ||--o{ PostHashtag : has
  Hashtag ||--o{ PostHashtag : has
  Post |o--o{ Mention : has
  Comment |o--o{ Mention : has
  User ||--o{ Mention : has
  User ||--o{ Story : has
  Music |o--o{ Story : has
  Post |o--o{ Story : has
  Story ||--o{ StoryView : has
  User ||--o{ StoryView : has
  Story ||--o{ StoryLike : has
  User ||--o{ StoryLike : has
  Story ||--o{ StoryReaction : has
  User ||--o{ StoryReaction : has
  Story ||--o{ StoryReply : has
  User ||--o{ StoryReply : has
  User ||--o{ Highlight : has
  Highlight ||--o{ HighlightStory : has
  Story ||--o{ HighlightStory : has
  User ||--o{ Note : has
  Music |o--o{ Note : has
  Note ||--o{ NoteLike : has
  User ||--o{ NoteLike : has
  Note ||--o{ NoteReply : has
  User ||--o{ NoteReply : has
  Chat ||--o{ ChatParticipant : has
  User ||--o{ ChatParticipant : has
  Chat ||--o{ Message : has
  User ||--o{ Message : has
  Message |o--o{ Message : replyTo
  Post |o--o{ Message : shared
  Story |o--o{ Message : has
  Note |o--o{ Message : has
  Message ||--o{ MessageReaction : has
  User ||--o{ MessageReaction : has
  Message ||--o{ MessageRead : has
  User ||--o{ MessageRead : has
  User ||--o{ MessageRequest : from
  User ||--o{ MessageRequest : to
  Chat ||--o{ MessageRequest : has
  Chat ||--o{ CallSession : has
  User ||--o{ CallSession : has
  User ||--o{ Notification : recipient
  User ||--o{ Notification : actor
  User ||--o{ ProfileView : viewer
  User ||--o{ ProfileView : viewed
  User ||--o{ ActivityLog : has
  User ||--o{ SearchHistory : has
  User ||--o{ UserSearchHistory : owner
  User ||--o{ UserSearchHistory : target
  User ||--o{ Report : has
  User ||--o{ Live : has
  Live ||--o{ LiveViewer : has
  User ||--o{ LiveViewer : has
  Live ||--o{ LiveComment : has
  User ||--o{ LiveComment : has
  Live ||--o{ LiveLike : has
  User ||--o{ LiveLike : has
  Live ||--o{ LiveReaction : has
  User ||--o{ LiveReaction : has
  Live ||--o{ LiveJoinRequest : has
  User ||--o{ LiveJoinRequest : has
  Live ||--o{ LiveGuest : has
  User ||--o{ LiveGuest : has
```

> Regenerate from the schema at any time: `npm run er:diagram` (writes `docs/ER.mmd`).

---

## Testing

```bash
npm run test:e2e        # Jest + Supertest end-to-end (boots the full app)
```

The e2e suite (16 tests) exercises real HTTP flows against the running infrastructure:
auth (register→login→refresh→logout, reuse detection), feed, like, story view, chat, private
account (pending → 403 → accept → 200), block (403 both ways), and live (start→feed→join→
comment→end). Uploads use real generated JPEGs so magic-byte validation and image processing run
for real.

```bash
npm run swagger:export     # write docs/swagger.json from the app
npm run endpoints:report   # module → endpoint count → protected count table
```

---

## Deployment

The app is a standard 12-factor Node service: everything is configured through environment
variables (see `.env.example`). It needs **PostgreSQL**, **Redis**, an **S3-compatible bucket**,
and (for live) a **LiveKit** server.

### Any VPS (Docker Compose)
```bash
git clone <repo> && cd backend-instagram
cp .env.example .env        # set real secrets: JWT_*, POSTGRES_PASSWORD, S3_*, SMTP_*, LIVEKIT_*
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run seed     # optional demo data
```
Put Nginx/Caddy in front for TLS and to proxy `/api` + the Socket.IO upgrade to port 3000.

### Railway / Render
1. Add managed **PostgreSQL** and **Redis** plugins → they inject `DATABASE_URL` / `REDIS_URL`.
2. Point S3 vars at a real bucket (AWS S3, Cloudflare R2, or a hosted MinIO).
3. Set `SMTP_*` to a real provider (e.g. Gmail App Password — no code change) and `LIVEKIT_*`
   to a LiveKit Cloud project (or drop live features).
4. Build: `npm ci && npm run build` · Start: `npx prisma migrate deploy && node dist/main.js`.
5. Set `FRONTEND_URL` to your frontend origin(s) (comma-separated) for CORS.

**Production checklist:** rotate `JWT_SECRET` / `JWT_REFRESH_SECRET`, set strong DB/S3
credentials, restrict `FRONTEND_URL`, and (optionally) make the S3 bucket private and serve media
through the built-in presigned-URL path.

---

## Project layout

```
src/
  common/        interceptors, filters, guards, decorators, pagination, access & chat utils
  modules/       auth, users, profile, follow, close-friends, music, posts, stories, notes,
                 chat, notifications, search, locations, verification, admin, live, upload
  prisma/ redis/ storage/ mail/ jobs/ health/
prisma/          schema.prisma (56 models), migrations, seed.ts
scripts/         music-import, export-swagger, endpoints-report, er-diagram
test/            jest-e2e.json, *.e2e-spec.ts
docs/            TZ.md, ROADMAP.md, BACKEND_BUGS.md, swagger.json, ER.mmd
```

---

## License
UNLICENSED — private project.
