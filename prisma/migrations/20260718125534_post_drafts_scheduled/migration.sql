-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "status" "PostStatus" NOT NULL DEFAULT 'PUBLISHED';
