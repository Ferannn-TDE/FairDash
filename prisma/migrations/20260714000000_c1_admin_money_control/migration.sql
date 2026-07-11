-- AlterTable
ALTER TABLE "FairOrganizer" ADD COLUMN     "payoutsFrozenAt" TIMESTAMP(3),
ADD COLUMN     "payoutsFrozenBy" TEXT,
ADD COLUMN     "payoutsFrozenReason" TEXT;

-- AlterTable
ALTER TABLE "Runner" ADD COLUMN     "payoutsFrozenAt" TIMESTAMP(3),
ADD COLUMN     "payoutsFrozenBy" TEXT,
ADD COLUMN     "payoutsFrozenReason" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "payoutsFrozenAt" TIMESTAMP(3),
ADD COLUMN     "payoutsFrozenBy" TEXT,
ADD COLUMN     "payoutsFrozenReason" TEXT;

-- CreateTable
CREATE TABLE "VendorEarning" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accrued',
    "feeShareCents" INTEGER,
    "netCents" INTEGER,
    "stripeTransferId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMoneyAction" (
    "id" TEXT NOT NULL,
    "adminClerkId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payeeType" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT,
    "earningId" TEXT,
    "amountCents" INTEGER,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMoneyAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorEarning_stripeTransferId_key" ON "VendorEarning"("stripeTransferId");

-- CreateIndex
CREATE INDEX "VendorEarning_eventId_idx" ON "VendorEarning"("eventId");

-- CreateIndex
CREATE INDEX "VendorEarning_vendorId_status_idx" ON "VendorEarning"("vendorId", "status");

-- CreateIndex
CREATE INDEX "VendorEarning_status_idx" ON "VendorEarning"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendorearning_order_vendor" ON "VendorEarning"("orderId", "vendorId");

-- CreateIndex
CREATE INDEX "AdminMoneyAction_eventId_createdAt_idx" ON "AdminMoneyAction"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminMoneyAction_payeeType_payeeId_idx" ON "AdminMoneyAction"("payeeType", "payeeId");

-- CreateIndex
CREATE INDEX "AdminMoneyAction_adminClerkId_idx" ON "AdminMoneyAction"("adminClerkId");

-- CreateIndex
CREATE INDEX "AdminMoneyAction_action_idx" ON "AdminMoneyAction"("action");

-- CreateIndex
CREATE INDEX "FairOrganizer_payoutsFrozenAt_idx" ON "FairOrganizer"("payoutsFrozenAt");

-- CreateIndex
CREATE INDEX "Runner_payoutsFrozenAt_idx" ON "Runner"("payoutsFrozenAt");

-- AddForeignKey
ALTER TABLE "VendorEarning" ADD CONSTRAINT "VendorEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEarning" ADD CONSTRAINT "VendorEarning_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

