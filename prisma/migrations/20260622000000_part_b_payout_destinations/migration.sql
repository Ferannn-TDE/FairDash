-- Part B — Payout Destinations: Stripe Connect accounts for the two payee types
-- that lacked them. RUNNER gets the field net-new (mirrors Vendor's Connect
-- columns); FAIRORGANIZER gets it at the organizer level (one account reused
-- across an organizer's fairs — NOT per-event). DESTINATIONS ONLY: no transfers,
-- no payout logic. This phase only builds somewhere to pay.

-- Runner: net-new Stripe Connect destination
ALTER TABLE "Runner"
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "stripeVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeConnectedAt" TIMESTAMP(3);

CREATE INDEX "Runner_stripeVerified_idx" ON "Runner"("stripeVerified");
CREATE INDEX "Runner_stripeAccountId_idx" ON "Runner"("stripeAccountId");

-- FairOrganizer: Stripe Connect destination at the organizer level
ALTER TABLE "FairOrganizer"
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "stripeVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeConnectedAt" TIMESTAMP(3);

CREATE INDEX "FairOrganizer_stripeVerified_idx" ON "FairOrganizer"("stripeVerified");
CREATE INDEX "FairOrganizer_stripeAccountId_idx" ON "FairOrganizer"("stripeAccountId");
