-- CreateIndex
CREATE INDEX "Post_userId_isArchived_status_createdAt_idx" ON "Post"("userId", "isArchived", "status", "createdAt");
