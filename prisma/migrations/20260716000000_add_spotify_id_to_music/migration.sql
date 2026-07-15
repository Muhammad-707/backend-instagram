-- AlterTable: связь трека с Spotify (null → локальный mp3 из assets/)
ALTER TABLE "Music" ADD COLUMN "spotifyId" TEXT;

-- CreateIndex: один трек Spotify — одна строка в Music (дедупликация при импорте)
CREATE UNIQUE INDEX "Music_spotifyId_key" ON "Music"("spotifyId");
