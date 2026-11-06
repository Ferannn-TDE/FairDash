-- Event.listing (Batch 1 item 5b). Expand only: every existing event becomes PUBLIC, which is
-- exactly today's behaviour. The value is added on top of the status filters, never instead.

-- CreateEnum
CREATE TYPE "EventListing" AS ENUM ('PUBLIC', 'UNLISTED', 'SIGNUP_ONLY');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "listing" "EventListing" NOT NULL DEFAULT 'PUBLIC';

