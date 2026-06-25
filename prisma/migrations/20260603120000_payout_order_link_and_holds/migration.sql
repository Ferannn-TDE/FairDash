-- Payout ↔ Order link (enables completed-vs-paid reconciliation) + held-payout persistence.

-- AlterTable: link payouts to their order
ALTER TABLE "Payout" ADD COLUMN "orderId" TEXT;

-- CreateTable: PayoutHold — a vendor's slice that could not be transferred yet
CREATE TABLE "PayoutHold" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutHold_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Payout_orderId_idx" ON "Payout"("orderId");
CREATE UNIQUE INDEX "uq_payout_order_vendor" ON "Payout"("orderId", "vendorId");
CREATE INDEX "PayoutHold_resolved_idx" ON "PayoutHold"("resolved");
CREATE INDEX "PayoutHold_vendorId_resolved_idx" ON "PayoutHold"("vendorId", "resolved");
CREATE UNIQUE INDEX "uq_payouthold_order_vendor" ON "PayoutHold"("orderId", "vendorId");

-- Foreign keys
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayoutHold" ADD CONSTRAINT "PayoutHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayoutHold" ADD CONSTRAINT "PayoutHold_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
