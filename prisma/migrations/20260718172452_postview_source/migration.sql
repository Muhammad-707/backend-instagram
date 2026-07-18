-- AlterTable
ALTER TABLE "PostView" ADD COLUMN     "source" TEXT;

-- CreateIndex
CREATE INDEX "PostView_postId_source_idx" ON "PostView"("postId", "source");
