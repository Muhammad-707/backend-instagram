-- AlterEnum
ALTER TYPE "MsgType" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "ChatParticipant" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;
