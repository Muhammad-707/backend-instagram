# Баги, найденные в НАШЕМ backend'е

> Про 21 баг старого softclub-API — см. `docs/TZ.md §2`. Здесь только **свои** баги и проблемы окружения.
> Формат: дата · где · что · как починили.

---

## Фаза 0

### #1 — API падал при старте, если БД недоступна
- **Дата:** 2026-07-14
- **Где:** `src/prisma/prisma.service.ts` → `onModuleInit()`
- **Симптом:** `PrismaClientInitializationError: P1000 Can't reach database server` → процесс Node падал целиком, `/api/health` не отвечал вообще (curl → пусто, exit 7).
- **Причина:** `await this.$connect()` без обработки ошибки. Nest не мог инициализировать модуль → bootstrap падал.
- **Починка:** `$connect()` обёрнут в `try/catch` с логированием. API поднимается, а `/api/health` честно отвечает `{"status":"degraded","database":"down"}`.
- **Почему так, а не «пусть падает»:** health-check обязан **сообщать** о проблеме, а не молчать. Плюс без этого нельзя было проверить Swagger до готовности Docker.
- **Статус:** ✅ закрыт, проверен curl'ом.

### #2 — `npm run lint` не работал (ESLint не был установлен)
- **Дата:** 2026-07-14
- **Где:** `package.json`
- **Симптом:** `"eslint" не является внутренней или внешней командой`.
- **Причина:** скрипт `lint` был прописан, а сам `eslint` и конфиг — нет.
- **Починка:** установлены `eslint@10`, `typescript-eslint`, `eslint-config-prettier`, `eslint-plugin-prettier`, `globals`; добавлен `eslint.config.mjs` (flat config, `recommendedTypeChecked`, `no-explicit-any: error`).
- **Статус:** ✅ закрыт, `npm run lint` → 0 ошибок.

### #3 — 2 ошибки типизации, вскрытые ESLint'ом
- **Дата:** 2026-07-14
- **Где:** `src/common/filters/all-exceptions.filter.ts:48`, `src/redis/redis.service.ts:29`
- **Симптом:**
  - `no-unsafe-enum-comparison` — `status` был типа `HttpStatus`, сравнивался с числом `500`.
  - `require-await` — `onModuleDestroy` объявлен `async`, но `disconnect()` синхронный.
- **Починка:** `let status: number = HttpStatus.INTERNAL_SERVER_ERROR;` · `onModuleDestroy(): void`.
- **Статус:** ✅ закрыт.

---

## Фаза 1

### #4 — Неверный подсчёт моделей в отчёте (не баг кода, баг процесса)
- **Дата:** 2026-07-14
- **Симптом:** в ROADMAP было записано «48 моделей, 18 enum'ов» — цифра взята на глаз, не посчитана.
- **Факт:** **56 моделей, 17 enum'ов**.
- **Вывод:** правило «тахмин манъ» распространяется и на цифры в отчётах — считать, а не прикидывать.
- **Статус:** ✅ ROADMAP исправлен.

---

## Открытые / отложенные

| # | Что | Когда чинить |
|---|---|---|
| — | `prisma migrate dev`, `seed`, `/api/health → ok` не проверены | как только будет готов Docker |
| — | `package.json#prisma` (`"seed"`) — deprecated в Prisma 7, просит `prisma.config.ts` | не срочно, warning; мигрируем при апгрейде на Prisma 7 |
| — | URL музыки в seed — заглушки, не настоящие mp3 | Фаза 5 (стриминг с Range-заголовками) |
