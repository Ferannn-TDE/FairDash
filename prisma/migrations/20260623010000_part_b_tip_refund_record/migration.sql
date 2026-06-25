-- Part B B4 — tip-refund record on the order. A CANCELLED runner-fulfilled order
-- whose tip no runner ever earned has its tip owed BACK to the customer; this
-- marks that refund (1:1 with the order, so the order row carries it). The unique
-- constraint + idempotency key tip_refund_${id} prevent a double refund.

ALTER TABLE "Order"
  ADD COLUMN "tipRefundId" TEXT,
  ADD COLUMN "tipRefundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_tipRefundId_key" ON "Order"("tipRefundId");
