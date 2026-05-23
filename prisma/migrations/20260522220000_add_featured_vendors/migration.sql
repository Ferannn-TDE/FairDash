-- Add featured vendor customization fields to Event
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "featuredVendorIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "featuredLabel" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "featuredEnabled" BOOLEAN NOT NULL DEFAULT true;
