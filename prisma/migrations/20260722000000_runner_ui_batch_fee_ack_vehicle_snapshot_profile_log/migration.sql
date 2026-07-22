-- Runner/customer UI batch (2026-07-22) — the ONE additive migration provisioning the whole
-- batch, so the three feature commits build against a stable schema (same rationale as the
-- Commit 2 custody migration: avoid the apply/regenerate/deploy dance per commit).
--
-- ALL ADDITIVE (ADD COLUMN nullable / ADD COLUMN with DEFAULT / CREATE TABLE) — no RENAME,
-- no DROP. STALE-CLIENT WINDOW IS ZERO: the currently-deployed build never selects these
-- columns or this table, so applying against the shared prod DB is invisible to it; the code
-- that reads/writes them deploys after. Ordering is safe in either direction.
--
-- Provisions:
--   1. FulfillmentConfig.runnerTipsOnlyAck  — the fee-activation acknowledgment (0-by-intent)
--   2. Order.runnerVehicle{Make,Color,Plate} — claim-time vehicle snapshot (driver card)
--   3. RunnerProfileChange                   — append-only profile-edit audit (PII, Pattern-W purged)

-- AlterTable (fee-activation ack)
ALTER TABLE "FulfillmentConfig" ADD COLUMN     "runnerTipsOnlyAck" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (claim-time vehicle snapshot)
ALTER TABLE "Order" ADD COLUMN     "runnerVehicleMake" TEXT,
ADD COLUMN     "runnerVehicleColor" TEXT,
ADD COLUMN     "runnerVehiclePlate" TEXT;

-- CreateTable (runner profile-change log)
CREATE TABLE "RunnerProfileChange" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerProfileChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunnerProfileChange_runnerId_changedAt_idx" ON "RunnerProfileChange"("runnerId", "changedAt");

-- CreateIndex
CREATE INDEX "RunnerProfileChange_changedAt_idx" ON "RunnerProfileChange"("changedAt");

-- AddForeignKey
ALTER TABLE "RunnerProfileChange" ADD CONSTRAINT "RunnerProfileChange_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
