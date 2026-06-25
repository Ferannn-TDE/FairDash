-- Chargebacks (bank disputes) + clawback-debt-ledger kind discriminator + charge index.
ALTER TABLE "NegativeBalanceEvent" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'refund_reversal';

CREATE INDEX "idx_order_stripe_charge" ON "Order"("stripeChargeId");

CREATE TABLE "Chargeback" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "atFaultVendorId" TEXT,
    "clawbackStatus" TEXT NOT NULL DEFAULT 'pending',
    "fundsReinstated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Chargeback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Chargeback_stripeDisputeId_key" ON "Chargeback"("stripeDisputeId");
CREATE INDEX "Chargeback_status_idx" ON "Chargeback"("status");
CREATE INDEX "Chargeback_orderId_idx" ON "Chargeback"("orderId");
CREATE INDEX "Chargeback_eventId_idx" ON "Chargeback"("eventId");
ALTER TABLE "Chargeback" ADD CONSTRAINT "Chargeback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
