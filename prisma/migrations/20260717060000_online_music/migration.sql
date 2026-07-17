-- Каталог треков больше не «только Spotify»: его /search требует Premium у
-- владельца приложения (403), поэтому источник стал сменным — provider+externalId.
--
-- Данные переносим, а не теряем: сгенерированный Prisma diff делал
-- DROP COLUMN "spotifyId" сразу, что стёрло бы связь уже импортированных
-- треков с их каталогом (и следующий импорт создал бы дубликаты).

-- CreateEnum
CREATE TYPE "MusicProvider" AS ENUM ('SPOTIFY', 'DEEZER');

-- AlterTable: сначала новые колонки
ALTER TABLE "Music" ADD COLUMN "externalId" TEXT,
                    ADD COLUMN "provider" "MusicProvider";

-- Перенос: всё, что было spotifyId, — это трек из Spotify
UPDATE "Music"
   SET "provider" = 'SPOTIFY', "externalId" = "spotifyId"
 WHERE "spotifyId" IS NOT NULL;

-- И только теперь убираем старую колонку
DROP INDEX IF EXISTS "Music_spotifyId_key";
ALTER TABLE "Music" DROP COLUMN "spotifyId";

-- CreateIndex
CREATE UNIQUE INDEX "Music_provider_externalId_key" ON "Music"("provider", "externalId");
