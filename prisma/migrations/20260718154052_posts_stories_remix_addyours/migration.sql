-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "remixOfId" INTEGER;

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "addYoursPromptId" TEXT;

-- CreateTable
CREATE TABLE "AddYoursPrompt" (
    "id" TEXT NOT NULL,
    "text" VARCHAR(80) NOT NULL,
    "emoji" TEXT,
    "creatorId" TEXT NOT NULL,
    "originStoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddYoursPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AddYoursPrompt_originStoryId_key" ON "AddYoursPrompt"("originStoryId");

-- CreateIndex
CREATE INDEX "AddYoursPrompt_creatorId_idx" ON "AddYoursPrompt"("creatorId");

-- CreateIndex
CREATE INDEX "Post_remixOfId_idx" ON "Post"("remixOfId");

-- CreateIndex
CREATE INDEX "Story_addYoursPromptId_idx" ON "Story"("addYoursPromptId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_remixOfId_fkey" FOREIGN KEY ("remixOfId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_addYoursPromptId_fkey" FOREIGN KEY ("addYoursPromptId") REFERENCES "AddYoursPrompt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddYoursPrompt" ADD CONSTRAINT "AddYoursPrompt_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddYoursPrompt" ADD CONSTRAINT "AddYoursPrompt_originStoryId_fkey" FOREIGN KEY ("originStoryId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
