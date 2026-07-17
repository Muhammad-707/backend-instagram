-- AlterEnum
ALTER TYPE "MsgType" ADD VALUE 'MUSIC_SHARE';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "musicId" INTEGER;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_musicId_fkey" FOREIGN KEY ("musicId") REFERENCES "Music"("id") ON DELETE SET NULL ON UPDATE CASCADE;
