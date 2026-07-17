-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- DropIndex
DROP INDEX "PostTag_userId_idx";

-- AlterTable
ALTER TABLE "PostTag" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "TagStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "PostTag_userId_status_idx" ON "PostTag"("userId", "status");
