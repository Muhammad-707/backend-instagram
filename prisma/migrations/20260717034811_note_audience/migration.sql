-- CreateEnum
CREATE TYPE "NoteAudience" AS ENUM ('FOLLOWERS', 'CLOSE_FRIENDS');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "audience" "NoteAudience" NOT NULL DEFAULT 'FOLLOWERS';
