-- CreateEnum
CREATE TYPE "InteractionPolicy" AS ENUM ('EVERYONE', 'FOLLOWING', 'NOBODY');

-- CreateEnum
CREATE TYPE "CommentPolicy" AS ENUM ('EVERYONE', 'FOLLOWERS', 'MUTUAL', 'OFF');

-- AlterTable
ALTER TABLE "Mention" ADD COLUMN     "storyId" INTEGER;

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whoCanTag" "InteractionPolicy" NOT NULL DEFAULT 'EVERYONE',
    "whoCanMention" "InteractionPolicy" NOT NULL DEFAULT 'EVERYONE',
    "whoCanMessage" "InteractionPolicy" NOT NULL DEFAULT 'EVERYONE',
    "whoCanComment" "CommentPolicy" NOT NULL DEFAULT 'EVERYONE',
    "allowGifComments" BOOLEAN NOT NULL DEFAULT true,
    "allowStoryReshare" BOOLEAN NOT NULL DEFAULT true,
    "hiddenWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT NOT NULL DEFAULT 'ru',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RestrictedAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restrictedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestrictedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RestrictedAccount_userId_idx" ON "RestrictedAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RestrictedAccount_userId_restrictedId_key" ON "RestrictedAccount"("userId", "restrictedId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedAccount" ADD CONSTRAINT "RestrictedAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestrictedAccount" ADD CONSTRAINT "RestrictedAccount_restrictedId_fkey" FOREIGN KEY ("restrictedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
