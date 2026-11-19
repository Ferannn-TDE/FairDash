-- Item 10 / B1.13 stage 4 (BATCH-1 §19 S4-Q1, S4-Q4). Expand only: three new tables, nothing existing changes.
-- OrderFeeSplit (+ vendor lines): the Exhibit A split of the real Stripe fee, written once per feeModel 2
-- order at its first payout run. PartnerEarning: a feeModel 2 curbside order's curbside fee + tip, held as
-- owed to the partner (C-6) until Batch 4. Legacy orders never get rows.

-- CreateTable
CREATE TABLE "OrderFeeSplit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "realStripeFeeCents" INTEGER NOT NULL,
    "fairsynqShareCents" INTEGER NOT NULL,
    "fairsynqNetCents" INTEGER NOT NULL,
    "partnerShareCents" INTEGER NOT NULL,
    "partnerNetCents" INTEGER NOT NULL,
    "cardFeesPaidBy" "CardFeesPaidBy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFeeSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFeeSplitVendor" (
    "id" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "foodCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "feeShareCents" INTEGER NOT NULL,
    "payCents" INTEGER NOT NULL,

    CONSTRAINT "OrderFeeSplitVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerEarning" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "partnerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderFeeSplit_orderId_key" ON "OrderFeeSplit"("orderId");

-- CreateIndex
CREATE INDEX "OrderFeeSplit_eventId_idx" ON "OrderFeeSplit"("eventId");

-- CreateIndex
CREATE INDEX "OrderFeeSplitVendor_splitId_idx" ON "OrderFeeSplitVendor"("splitId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFeeSplitVendor_orderId_vendorId_key" ON "OrderFeeSplitVendor"("orderId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerEarning_orderId_key" ON "PartnerEarning"("orderId");

-- CreateIndex
CREATE INDEX "PartnerEarning_eventId_idx" ON "PartnerEarning"("eventId");

-- CreateIndex
CREATE INDEX "PartnerEarning_status_idx" ON "PartnerEarning"("status");

-- AddForeignKey
ALTER TABLE "OrderFeeSplit" ADD CONSTRAINT "OrderFeeSplit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFeeSplitVendor" ADD CONSTRAINT "OrderFeeSplitVendor_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "OrderFeeSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerEarning" ADD CONSTRAINT "PartnerEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

