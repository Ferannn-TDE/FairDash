-- Part B B3 — organizer per-event batch payout. N earnings : 1 batch, so the
-- batch gets its OWN record (the idempotency anchor + the which-payout-covered-
-- which-earnings audit). OrganizerEarning FKs back to the batch that paid it.

-- The batch record
CREATE TABLE "OrganizerPayout" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizerId" TEXT,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripeTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "OrganizerPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizerPayout_stripeTransferId_key" ON "OrganizerPayout"("stripeTransferId");
CREATE INDEX "OrganizerPayout_eventId_idx" ON "OrganizerPayout"("eventId");
CREATE INDEX "OrganizerPayout_status_idx" ON "OrganizerPayout"("status");

ALTER TABLE "OrganizerPayout"
  ADD CONSTRAINT "OrganizerPayout_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OrganizerEarning gains the batch audit columns
ALTER TABLE "OrganizerEarning"
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "batchId" TEXT;

CREATE INDEX "OrganizerEarning_status_idx" ON "OrganizerEarning"("status");
CREATE INDEX "OrganizerEarning_batchId_idx" ON "OrganizerEarning"("batchId");

ALTER TABLE "OrganizerEarning"
  ADD CONSTRAINT "OrganizerEarning_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "OrganizerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
