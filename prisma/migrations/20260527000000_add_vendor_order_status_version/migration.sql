-- Add version column to VendorOrderStatus for optimistic concurrency control.
-- Existing rows start at 1 (matching the @default(1) in the schema).
ALTER TABLE "VendorOrderStatus" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
