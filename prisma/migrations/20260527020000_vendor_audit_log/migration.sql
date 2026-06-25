-- CreateTable
CREATE TABLE "VendorAuditLog" (
    "id"        TEXT NOT NULL,
    "vendorId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VendorAuditLog" ADD CONSTRAINT "VendorAuditLog_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAuditLog" ADD CONSTRAINT "VendorAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "VendorAuditLog_vendorId_createdAt_idx" ON "VendorAuditLog"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorAuditLog_userId_idx" ON "VendorAuditLog"("userId");
