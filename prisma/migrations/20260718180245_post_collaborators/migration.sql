-- CreateTable
CREATE TABLE "PostCollaborator" (
    "id" TEXT NOT NULL,
    "postId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostCollaborator_userId_status_idx" ON "PostCollaborator"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PostCollaborator_postId_userId_key" ON "PostCollaborator"("postId", "userId");

-- AddForeignKey
ALTER TABLE "PostCollaborator" ADD CONSTRAINT "PostCollaborator_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCollaborator" ADD CONSTRAINT "PostCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
