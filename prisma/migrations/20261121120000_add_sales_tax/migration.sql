-- B1.19 sales tax (expand only): event rates, order snapshot + tax, per-vendor tax rows, refund / payout / earning tax
-- parts, rate change log.
-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "localTaxRateMilli" INTEGER,
ADD COLUMN     "salesTaxRateMilli" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "localTaxRateMilli" INTEGER,
ADD COLUMN     "salesTaxRateMilli" INTEGER,
ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "localTaxCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "salesTaxCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VendorEarning" ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderVendorTax" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "foodCents" INTEGER NOT NULL,
    "salesTaxCents" INTEGER NOT NULL DEFAULT 0,
    "localTaxCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderVendorTax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTaxRateChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "oldValue" INTEGER,
    "newValue" INTEGER,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTaxRateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderVendorTax_vendorId_idx" ON "OrderVendorTax"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderVendorTax_orderId_vendorId_key" ON "OrderVendorTax"("orderId", "vendorId");

-- CreateIndex
CREATE INDEX "EventTaxRateChange_eventId_createdAt_idx" ON "EventTaxRateChange"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderVendorTax" ADD CONSTRAINT "OrderVendorTax_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTaxRateChange" ADD CONSTRAINT "EventTaxRateChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

