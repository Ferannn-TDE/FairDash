-- Part A — Event Economics: fee split config, curbside fee, tips, organizer ledger.
-- Records-only (no payouts). Tip is collected in the charge, held in platform
-- balance, recorded as the runner's earning (paid in Part B).

-- FulfillmentConfig: runner/organizer fee split + curbside fee
ALTER TABLE "FulfillmentConfig"
  ADD COLUMN "curbsideFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "runnerFeePercent" INTEGER NOT NULL DEFAULT 0;

-- Order: customer tip (runner-fulfilled orders only; 100% the runner's)
ALTER TABLE "Order" ADD COLUMN "tip" DOUBLE PRECISION;

-- OrganizerEarning: organizer's accrued share of the fee (recorded, not paid)
CREATE TABLE "OrganizerEarning" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organizerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accrued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerEarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizerEarning_orderId_key" ON "OrganizerEarning"("orderId");
CREATE INDEX "OrganizerEarning_eventId_idx" ON "OrganizerEarning"("eventId");
CREATE INDEX "OrganizerEarning_organizerId_idx" ON "OrganizerEarning"("organizerId");

ALTER TABLE "OrganizerEarning"
  ADD CONSTRAINT "OrganizerEarning_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
