# Деплой на Render — чеклист

> Список не выдуман: он снят с самой схемы валидации (`src/config/env.validation.ts`).
> При `NODE_ENV=production` API **не стартует**, пока чего-то не хватает, и в логе называет
> ровно недостающие переменные. Это не помеха, а защита: молча подняться с dev-настройками хуже.

## 1. Сервис

| Поле | Значение |
|---|---|
| Repository | `Muhammad-707/backend-instagram` · ветка `main` |
| Runtime | **Docker** (`Dockerfile` в корне — собирается ~8 мин с нуля, ~3с с кэшем) |
| Start Command | **оставить пустым** — миграции запускает сам образ (`docker-entrypoint.sh`) |
| Health Check Path | `/api/health` |

`prisma` лежит в `dependencies` именно ради `migrate deploy` на старте — не переносить в dev.

> **Почему Start Command больше не нужен.** Раньше здесь стояло
> `npx prisma migrate deploy && node dist/main.js`, и миграции держались на одном
> руками вписанном поле в панели. Поле оказалось пустым — Render взял `CMD` из
> Dockerfile, API поднялся на пустой БД, и **все** запросы к таблицам отдавали
> 500 `Database error`, пока `/api/health` показывал `database: up` (его `SELECT 1`
> таблиц не требует). Теперь `migrate deploy` внутри образа — от поля в панели
> не зависит. Вписывать его обратно не нужно.

## 2. Переменные окружения

### Обязательные (14) — без них старт не произойдёт

| Переменная | Пример / откуда взять |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Postgres на Render → Internal Database URL |
| `REDIS_URL` | Redis (Render Key Value / внешний), `rediss://…` |
| `APP_URL` | `https://<ваш-сервис>.onrender.com` |
| `JWT_SECRET` | ≥16 символов, случайная строка |
| `JWT_REFRESH_SECRET` | ≥16 символов, **другая** строка |
| `S3_ENDPOINT` | хост S3/MinIO (без схемы), напр. `s3.eu-central-1.amazonaws.com` |
| `S3_USE_SSL` | `true` |
| `S3_ACCESS_KEY` | ключ S3 |
| `S3_SECRET_KEY` | секрет S3 |
| `S3_PUBLIC_URL` | публичный URL бакета, напр. `https://cdn.example.com/instagram` |
| `SMTP_HOST` | SMTP-хост (Gmail: `smtp.gmail.com`) |
| `LIVEKIT_URL` | **`wss://…`** — в проде только wss, `ws://` схема отклонит |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | из LiveKit Cloud |

**Три ошибки, на которых деплой падает чаще всего** (проверено на живом контейнере):
- `APP_URL`, `S3_PUBLIC_URL` с `localhost` → внутри контейнера localhost это сам контейнер, не сервис.
- `LIVEKIT_URL=ws://…` → браузер по https разрешает только `wss://`.
- `JWT_*` короче 16 символов.

### Необязательные

| Переменная | Что будет, если не задать |
|---|---|
| `PORT` | `3000` |
| `FRONTEND_URL` | CORS на `http://localhost:3001`. **Задать URL фронта**, иначе браузер не пустит |
| `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | без `SMTP_USER` AUTH не отправляется (dev/MailHog). Для Gmail — App Password |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify-каталог выключен. **Не блокирует**: поиск музыки идёт через Deezer |
| `STUN_URLS` | `stun:stun.l.google.com:19302` |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_PASSWORD` / `TURN_EXTERNAL_IP` | `hasTurn: false` — звонок между мобильными сетями может не собраться (см. ниже) |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` / `MAX_AUDIO_MB` | 10 / 100 / 20 |

## 3. Что Render не умеет — и что с этим делать

- **TURN на Render не поднять: он не пробрасывает UDP.** Сервис `coturn` из `docker-compose.yml`
  переносится на VPS как есть, либо берётся внешний TURN. Потом задать `TURN_*` — код готов, менять
  нечего. Пока не задано: звонки работают по Wi-Fi, в мобильных сетях могут не соединиться.
- **S3 и Redis — внешние.** В compose они локальные; на Render нужны свои (Render Key Value,
  AWS S3/Cloudflare R2 и т.п.).
- **Free-план засыпает**: первый запрос после простоя ждёт ~50 секунд. Для разработки фронта быстрее
  поднимать backend локально.

## 4. Проверка после деплоя

```bash
curl https://<сервис>.onrender.com/api/health
# ожидается: {"data":{"status":"ok","database":"up","redis":"up","storage":"up",...},"errors":null,"statusCode":200}
```

- `database/redis/storage: up` — все три подключены.
- `404 Not Found` + заголовок `x-render-routing: no-server` — сервиса по этому имени нет вовсе
  (не путать с «спит»: спящий отвечает 502/503, а не 404).
- Не стартует — смотреть логи: валидатор печатает **список** недостающих переменных, а не одну.

Swagger живого сервиса: `https://<сервис>.onrender.com/api/docs`

## 5. Фронту

```
NEXT_PUBLIC_API_URL=https://<сервис>.onrender.com/api
```
И на бэкенде `FRONTEND_URL=https://<фронт>` — иначе CORS.
