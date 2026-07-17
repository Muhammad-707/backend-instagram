#!/bin/sh
# Миграцияҳо бояд пеш аз старти API гузаранд.
#
# Пештар ин корро танҳо «Start Command»-и дастӣ дар панели Render мекард
# (`npx prisma migrate deploy && node dist/main.js`). Агар он майдон холӣ монад,
# Render `CMD`-и Dockerfile-ро мегирад — яъне API бе миграция бармехезад.
# Натиҷа: пайваст ба БД ҳаст (`/api/health` → database: up, чунки `SELECT 1`
# ҷадвал талаб намекунад), вале ҳар дархост ба ҷадвал P2021 медиҳад ва
# ба клиент ҳамон «Database error»-и норавшан мерасад.
#
# Акнун миграция дар худи образ аст — ба конфиги панел вобаста нест.
set -e

echo "[entrypoint] prisma migrate deploy…"
npx prisma migrate deploy
echo "[entrypoint] migrations OK → starting API"

exec node dist/main.js
