-- Part B B2 — runner payout record on the ledger row itself. The RunnerEarning
-- row doubles as the payout record (as the unpaid row doubles as the hold): on a
-- successful transfer the executor sets status='paid' + the transfer id + paidAt.
-- No separate RunnerPayout table.

ALTER TABLE "RunnerEarning"
  ADD COLUMN "stripeTransferId" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "RunnerEarning_stripeTransferId_key" ON "RunnerEarning"("stripeTransferId");
CREATE INDEX "RunnerEarning_status_idx" ON "RunnerEarning"("status");
