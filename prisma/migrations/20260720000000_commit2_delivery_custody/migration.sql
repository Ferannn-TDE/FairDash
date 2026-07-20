-- Commit 2 (U0) — possession-split escape path: the ONE additive migration.
--
-- All changes are ADDITIVE (CREATE TYPE / ADD COLUMN nullable / CREATE TABLE) — no RENAME,
-- no DROP. STALE-CLIENT WINDOW IS ZERO: the currently-deployed build (71cb331) never selects
-- these columns or this table, so applying this against the shared prod DB is invisible to it.
-- The code that reads/writes these lands in later units (U1..U5) and deploys after. Ordering
-- is therefore safe in either direction; unlike the 07-17 rename, there is nothing to break.
--
-- One migration (not one-per-unit) on purpose: apply the whole surface once, then build the
-- logic against a stable schema — avoids repeating the apply/regenerate/deploy dance and the
-- backed-out-WIP hazard (a regenerated client demanding columns the DB doesn't have yet).

-- CreateEnum
CREATE TYPE "StrandedReason" AS ENUM ('CLAIMED_NOT_COLLECTED', 'RUNNER_UNREACHABLE_WITH_FOOD', 'AWAITING_VENDOR_CONFIRMATION');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "returnRequestedAt" TIMESTAMP(3),
ADD COLUMN     "strandedAt" TIMESTAMP(3),
ADD COLUMN     "strandedReason" "StrandedReason";

-- CreateTable
CREATE TABLE "DeliveryCustodyEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "runnerId" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryCustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryCustodyEvent_orderId_idx" ON "DeliveryCustodyEvent"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryCustodyEvent_timestamp_idx" ON "DeliveryCustodyEvent"("timestamp");

-- CreateIndex
CREATE INDEX "DeliveryCustodyEvent_eventType_idx" ON "DeliveryCustodyEvent"("eventType");

-- AddForeignKey
ALTER TABLE "DeliveryCustodyEvent" ADD CONSTRAINT "DeliveryCustodyEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
