-- ─────────────────────────────────────────────────────────────────────────────
-- CATCH-UP MIGRATION — reconcile prisma/migrations with prisma/schema.prisma
--
-- WHY THIS EXISTS. Several schema changes were applied to production with
-- `prisma db push` and never captured as migrations. The consequence is a
-- DISASTER-RECOVERY GAP, not merely a test inconvenience: a database rebuilt from
-- prisma/migrations alone produces a schema the application cannot run against.
--
-- ⚠️ HAND-REVIEWED. The generated diff was NOT safe to apply as written:
--   1. It added OrderItem.totalPrice as NOT NULL with no default, which FAILS
--      outright on a table containing rows. Split into nullable → backfill → NOT NULL.
--   2. It emitted ten DROP INDEX statements. ALL are deliberately commented out —
--      see the block at the bottom. A redundant index costs write throughput; a
--      missing one costs a sequential scan under load. That trade is one-directional
--      during a live event.
--
-- SAFE TO RE-RUN: every statement is guarded (IF NOT EXISTS / conditional DO block),
-- so an interrupted apply can simply be re-applied.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PayoutStatus enum ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayoutStatus') THEN
    CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
  END IF;
END $$;

-- ── 2. Order.payoutStatus — nullable, so no backfill is needed ───────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "payoutStatus" "PayoutStatus";

-- ── 3. OrderItem.itemName ────────────────────────────────────────────────────
-- Denormalised snapshot of the menu item name at order time. The generated diff
-- used DEFAULT '' — correct for the column, but it would leave every existing row
-- with an empty name. DERIVED from MenuItem instead; '' remains the default for
-- rows whose menu item has since been deleted.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "itemName" TEXT NOT NULL DEFAULT '';

UPDATE "OrderItem" oi
   SET "itemName" = mi."name"
  FROM "MenuItem" mi
 WHERE mi."id" = oi."menuItemId"
   AND oi."itemName" = '';

-- ── 4. OrderItem.totalPrice — THE DANGEROUS ONE ──────────────────────────────
-- schema.prisma documents this column as "unitPrice * quantity, stored at creation
-- time", so the value is DERIVABLE from columns that already exist. It is computed,
-- never defaulted to 0 — a silent 0 here would corrupt every downstream money
-- reader (payout slices, refund arithmetic, the Pattern C identity check).
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "totalPrice" DOUBLE PRECISION;

UPDATE "OrderItem"
   SET "totalPrice" = "unitPrice" * "quantity"
 WHERE "totalPrice" IS NULL;

-- Only enforce NOT NULL once every row is populated. If any row is still NULL the
-- statement fails loudly rather than inventing a value.
ALTER TABLE "OrderItem" ALTER COLUMN "totalPrice" SET NOT NULL;


-- ── 5. NAMED COMPOSITE INDEXES — also absent from the history ────────────────
-- These are declared in schema.prisma via @@index(map: …) and exist in production
-- (db push created them), but no migration creates them. A migrations-built database
-- would therefore have NO composite index at all — every hot query a sequential scan.
-- IF NOT EXISTS so this is a no-op wherever they already exist, including production.
CREATE INDEX IF NOT EXISTS "idx_order_customer_placed"        ON "Order"("customerId", "placedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_order_event_status"           ON "Order"("eventId", "status");
CREATE INDEX IF NOT EXISTS "idx_order_event_placed"           ON "Order"("eventId", "placedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_order_vendor_placed"          ON "Order"("vendorId", "placedAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_order_vendor_status_placed"   ON "Order"("vendorId", "status", "placedAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_order_placed_id"        ON "Order"("placedAt", "id");
CREATE INDEX IF NOT EXISTS "idx_orderitem_vendor_order"       ON "OrderItem"("vendorId", "orderId");
CREATE INDEX IF NOT EXISTS "idx_orderitem_menuitem"           ON "OrderItem"("menuItemId");
CREATE INDEX IF NOT EXISTS "idx_orderitem_vendor_created"     ON "OrderItem"("vendorId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_orderitem_vendor_menu_created" ON "OrderItem"("vendorId", "menuItemId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_vendor_event_status"          ON "Vendor"("eventId", "status");
CREATE INDEX IF NOT EXISTS "idx_vendor_event_active"          ON "Vendor"("eventId", "isOffline");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vendormember_user_vendor" ON "VendorMember"("userId", "vendorId");
CREATE INDEX IF NOT EXISTS "idx_vos_status"                   ON "VendorOrderStatus"("status");
CREATE INDEX IF NOT EXISTS "idx_vos_vendor_status"            ON "VendorOrderStatus"("vendorId", "status");

-- ── 6. INDEXES — DELIBERATELY NOT DROPPED ────────────────────────────────────
-- The generated diff wanted these ten gone, because schema.prisma declares named
-- COMPOSITE indexes covering the same leading columns. Keeping them is a decision,
-- not an oversight:
--
--   Order_eventId_idx / _vendorId_idx / _placedAt_idx / _customerId_idx
--       The composites are (eventId, placedAt DESC) and similar; a bare equality
--       scan can still prefer the single-column index. Patterns C/M/N/O scan Order
--       every 60 seconds.
--   OrderItem_vendorId_idx
--       accrueVendorEarnings and the payout split both group items by vendorId.
--   VendorOrderStatus_orderId_idx / _vendorId_idx
--       The unique (orderId, vendorId) covers orderId-leading lookups but NOT
--       vendorId-only, which the vendor board queries constantly.
--   Vendor_eventId_idx
--       Every fair page lists vendors by eventId.
--   VendorMember_userId_idx / _vendorId_idx
--       getVendorAuth resolves membership by userId on EVERY vendor request —
--       this one is on the auth path.
--
-- POST-FAIR: reconcile by ADDING these to schema.prisma as @@index so the schema
-- matches the database. Do NOT drop from the database to match the schema.
--
-- DROP INDEX "Order_customerId_idx";
-- DROP INDEX "Order_eventId_idx";
-- DROP INDEX "Order_placedAt_idx";
-- DROP INDEX "Order_vendorId_idx";
-- DROP INDEX "OrderItem_vendorId_idx";
-- DROP INDEX "Vendor_eventId_idx";
-- DROP INDEX "VendorMember_userId_idx";
-- DROP INDEX "VendorMember_vendorId_idx";
-- DROP INDEX "VendorOrderStatus_orderId_idx";
-- DROP INDEX "VendorOrderStatus_vendorId_idx";
