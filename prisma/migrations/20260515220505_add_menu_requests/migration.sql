-- CreateEnum
CREATE TYPE "MenuRequestType" AS ENUM ('ADD', 'EDIT', 'DELETE');

-- CreateEnum
CREATE TYPE "MenuRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "MenuRequest" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "type" "MenuRequestType" NOT NULL,
    "status" "MenuRequestStatus" NOT NULL DEFAULT 'PENDING',
    "name" TEXT,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "category" TEXT,
    "prepTime" INTEGER,
    "imageUrl" TEXT,
    "menuItemId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MenuRequest_vendorId_idx" ON "MenuRequest"("vendorId");

-- CreateIndex
CREATE INDEX "MenuRequest_status_idx" ON "MenuRequest"("status");

-- AddForeignKey
ALTER TABLE "MenuRequest" ADD CONSTRAINT "MenuRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuRequest" ADD CONSTRAINT "MenuRequest_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
