# Instagram Backend — Дастур барои Claude Code

## Стек (тағйир надеҳ)
NestJS 11 · TypeScript · Prisma · PostgreSQL 16 · Redis · Socket.IO ·
MinIO/S3 · sharp + ffmpeg · JWT (access+refresh) · bcrypt · Nodemailer ·
BullMQ · class-validator · @nestjs/swagger · Docker Compose

## Ҳуҷҷатҳо — пеш аз кор бихон
- ТЗ: `docs/TZ.md` (схемаи БД, ҳамаи ~137 endpoint, амният, cron)
- Роадмап: `docs/ROADMAP.md` — **қатъиян аз боло ба поён, ҳар қадами тайёрро `[x]` кун**

## Принсипи асосӣ — ТАХМИН МАНЪ
Ҳар endpoint бояд бо дархости ВОҚЕӢ (curl/Postman) санҷида шавад, на «бояд кор кунад».
Баъд аз ҳар фаза ҳисобот: чӣ сохта шуд, чӣ санҷида шуд, чӣ нотамом монд.

## Мо багҳои softclub-APIро ТАКРОР НАМЕКУНЕМ (ТЗ §2 — 21 боғ)
- `errors` танҳо ҳангоми ХАТО (ҳеҷ гоҳ `["success"]`)
- Пагинатсия дар ҳама ҷо кор мекунад (cursor-based)
- `delete-message` моликиятро тафтиш мекунад (OwnerGuard)
- Нест кардани аватар логинро НАМЕШИКАНАД
- `gender` — enum симметрӣ
- Лента < 300 мс (на 21 сония)
- Swagger аз DTO худкор — ҳеҷ гоҳ дурӯғ намегӯяд

## Қоидаҳои код
- TypeScript strict, `any` манъ
- Ҳар модул: controller + service + dto + entity
- Конверти ҷавоб: `{ data, errors, statusCode }` (ResponseInterceptor)
- Валидатсия: class-validator, `whitelist: true, forbidNonWhitelisted: true`
- Guards: JwtAuth · Owner · Roles · Block · Privacy
- Ҳеҷ business-logic дар controller — танҳо дар service

## Тартиби кор
- Дар як сессия — ЯК фаза
- Пеш аз оғоз нақшаро нишон деҳ
- Дар охир: `npm run build` + e2e-санҷиш + ROADMAP `[x]`