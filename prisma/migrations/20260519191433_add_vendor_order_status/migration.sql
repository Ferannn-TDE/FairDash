-- CreateTable
CREATE TABLE "VendorOrderStatus" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLACED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorOrderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorOrderStatus_orderId_idx" ON "VendorOrderStatus"("orderId");

-- CreateIndex
CREATE INDEX "VendorOrderStatus_vendorId_idx" ON "VendorOrderStatus"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorOrderStatus_orderId_vendorId_key" ON "VendorOrderStatus"("orderId", "vendorId");

-- AddForeignKey
ALTER TABLE "VendorOrderStatus" ADD CONSTRAINT "VendorOrderStatus_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrderStatus" ADD CONSTRAINT "VendorOrderStatus_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
