-- Add vendorId to OrderItem, backfilling from the parent Order's vendorId for existing rows.

-- Step 1: add as nullable so existing rows don't violate NOT NULL
ALTER TABLE "OrderItem" ADD COLUMN "vendorId" TEXT;

-- Step 2: backfill from parent Order
UPDATE "OrderItem" oi
SET "vendorId" = o."vendorId"
FROM "Order" o
WHERE oi."orderId" = o."id";

-- Step 3: enforce NOT NULL now that all rows are populated
ALTER TABLE "OrderItem" ALTER COLUMN "vendorId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "OrderItem_vendorId_idx" ON "OrderItem"("vendorId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
