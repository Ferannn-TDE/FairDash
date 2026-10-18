-- 1.2: the owed-back refund returns the delivery fee too. Additive only.
ALTER TABLE "Order" ADD COLUMN "deliveryFeeRefundCents" INTEGER;

CREATE TABLE "OwedBackHalt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "owedCents" INTEGER NOT NULL,
    "roomCents" INTEGER,
    "firstHaltedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHaltedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "OwedBackHalt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwedBackHalt_orderId_key" ON "OwedBackHalt"("orderId");
CREATE INDEX "OwedBackHalt_eventId_resolvedAt_idx" ON "OwedBackHalt"("eventId", "resolvedAt");

ALTER TABLE "OwedBackHalt" ADD CONSTRAINT "OwedBackHalt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
