-- Vendor.slug: global-unique → per-fair-unique.
--
-- The schema has declared @@unique([eventId, slug]) since the slug was added, but
-- the live DB still carried the original GLOBAL unique index (Vendor_slug_key),
-- created by 20260522200000_add_vendor_slug and never dropped. This reconciles the
-- DB to the schema so the same vendor name can exist at more than one fair.
--
-- SAFE: global-unique ⟹ per-fair-unique (strictly weaker), so no existing row can
-- violate the new constraint. Verified against live data: 0 duplicate (eventId, slug)
-- pairs across 18 vendors before applying.

-- DropIndex
DROP INDEX "Vendor_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendor_event_slug" ON "Vendor"("eventId", "slug");
