ALTER TABLE "Vendor" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "Vendor_slug_key" ON "Vendor"("slug");
