-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "vanishMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "vanishing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "viewOnce" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "viewOnceOpenedAt" TIMESTAMP(3);
