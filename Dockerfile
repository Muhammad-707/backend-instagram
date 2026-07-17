# Продовый образ API.
#
# Две причины, по которым сборка раньше «зависала» на десятки минут:
#
# 1. Не было `.dockerignore` — `COPY . .` отправлял демону весь каталог: 1.4 ГБ
#    (node_modules 1.2 ГБ + 175 МБ mp3 из assets/ + .git). Теперь контекст ~1.3 МБ.
# 2. `npm ci` выполнялся ДВАЖДЫ — в builder и снова в runner. Второй прогон один
#    занимал ~10 минут: sharp и ffmpeg-static заново качают бинари. Теперь ставим
#    один раз, срезаем dev-зависимости и переносим готовый node_modules в runner.

FROM node:22-alpine AS builder
WORKDIR /app

# Сначала только манифесты: слой с зависимостями переиспользуется, пока
# package*.json не менялись — правка кода не вызывает переустановку.
COPY package*.json ./
RUN npm ci

# Схема отдельным слоем: клиент Prisma перегенерируется только при её изменении.
COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Дев-зависимости срезаем здесь, вместо повторной установки в runner: бинари
# sharp и ffmpeg-static уже скачаны и подходят этому же базовому образу.
#
# `prisma` намеренно лежит в dependencies, а не в dev: рантайм запускает
# `npx prisma migrate deploy` (README → Render Start command), поэтому после
# prune CLI обязан остаться — иначе прод полез бы качать его при каждом старте.
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg системой НЕ ставим. MediaService жёстко указывает пути на бинари
# ffmpeg-static / ffprobe-static (они статически слинкованы и работают на musl),
# так что `apk add ffmpeg` тянул ~80 МБ в оба слоя и не использовался никогда.

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000
CMD ["node", "dist/main.js"]
