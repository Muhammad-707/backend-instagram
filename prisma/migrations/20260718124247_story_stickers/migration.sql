-- CreateEnum
CREATE TYPE "StoryStickerType" AS ENUM ('POLL', 'QUIZ', 'QUESTION', 'SLIDER', 'COUNTDOWN', 'LINK');

-- AlterEnum
ALTER TYPE "NotifType" ADD VALUE 'STORY_STICKER_RESPONSE';

-- CreateTable
CREATE TABLE "StorySticker" (
    "id" TEXT NOT NULL,
    "storyId" INTEGER NOT NULL,
    "type" "StoryStickerType" NOT NULL,
    "config" JSONB NOT NULL,
    "geometry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorySticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryStickerResponse" (
    "id" TEXT NOT NULL,
    "stickerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionIndex" INTEGER,
    "text" VARCHAR(500),
    "sliderValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryStickerResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorySticker_storyId_idx" ON "StorySticker"("storyId");

-- CreateIndex
CREATE INDEX "StoryStickerResponse_stickerId_idx" ON "StoryStickerResponse"("stickerId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryStickerResponse_stickerId_userId_key" ON "StoryStickerResponse"("stickerId", "userId");

-- AddForeignKey
ALTER TABLE "StorySticker" ADD CONSTRAINT "StorySticker_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStickerResponse" ADD CONSTRAINT "StoryStickerResponse_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "StorySticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryStickerResponse" ADD CONSTRAINT "StoryStickerResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
