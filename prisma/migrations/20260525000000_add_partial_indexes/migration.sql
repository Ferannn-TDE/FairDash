-- Partial indexes for active orders — much smaller index size than full-table composites.
-- Postgres supports WHERE clauses on indexes; Prisma schema does not, so applied via raw SQL.

CREATE INDEX IF NOT EXISTS idx_order_active_vendor
  ON "Order" ("vendorId", "placedAt" DESC)
  WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');

CREATE INDEX IF NOT EXISTS idx_order_active_event
  ON "Order" ("eventId", "placedAt" DESC)
  WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY');
