-- AlterTable
ALTER TABLE "CallSession" ADD COLUMN     "answeredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "callId" TEXT;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_callId_fkey" FOREIGN KEY ("callId") REFERENCES "CallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
