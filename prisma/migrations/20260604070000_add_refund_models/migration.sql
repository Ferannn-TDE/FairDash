-- Per-vendor refund money-truth + reversal convergence + clawback ledger.

-- Payout: reversal convergence fields (authoritative post-reversal truth)
ALTER TABLE "Payout" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN "stripeReversalId" TEXT;

-- Refund: per (order,vendor) customer refund of the subtotal slice (never the fee)
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "stripeReversalId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_refund_order_vendor" ON "Refund"("orderId", "vendorId");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");
CREATE INDEX "Refund_vendorId_idx" ON "Refund"("vendorId");
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");
CREATE INDEX "Refund_eventId_idx" ON "Refund"("eventId");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RefundRequest: customer post-acceptance refund request (admin/organizer approves)
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_refundrequest_order_vendor" ON "RefundRequest"("orderId", "vendorId");
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");
CREATE INDEX "RefundRequest_eventId_status_idx" ON "RefundRequest"("eventId", "status");
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NegativeBalanceEvent: FairSynq clawback-debt ledger (relation-free, survives order deletion)
CREATE TABLE "NegativeBalanceEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reversalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "NegativeBalanceEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NegativeBalanceEvent_status_idx" ON "NegativeBalanceEvent"("status");
CREATE INDEX "NegativeBalanceEvent_vendorId_status_idx" ON "NegativeBalanceEvent"("vendorId", "status");
CREATE INDEX "NegativeBalanceEvent_eventId_idx" ON "NegativeBalanceEvent"("eventId");
