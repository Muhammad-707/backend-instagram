-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "commentsDisabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hideLikeCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Comment_postId_pinnedAt_idx" ON "Comment"("postId", "pinnedAt");

-- CreateIndex
CREATE INDEX "Post_userId_pinnedAt_idx" ON "Post"("userId", "pinnedAt");
