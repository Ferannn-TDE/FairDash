-- MENU ITEM REMOVAL — a THIRD state, not a second meaning for an existing column.
--
-- WHAT WAS WRONG. The vendor's trash button and the sold-out toggle wrote the SAME field:
-- approving a DELETE request did `isAvailable = false`, and so did the availability toggle. So
-- "removed" was an alias for "sold out", the two were indistinguishable on every surface, and
-- the trash button could not express removal at all. This column is the missing state, not a
-- repaired delete.
--
--     available   isAvailable = true,  "removedAt" IS NULL
--     sold out    isAvailable = false, "removedAt" IS NULL    -- temporary, still on the menu
--     removed     "removedAt" IS NOT NULL                     -- off the menu; isAvailable moot
--
-- ⚠️ SOFT FOR EVERY ITEM, ordered or not — and the database already insists. OrderItem's FK to
-- MenuItem declares no ON DELETE, so it is RESTRICT: Postgres REFUSES to delete an item any
-- order references. A hard delete would additionally SET NULL on MenuRequest.menuItemId,
-- severing the audit trail from the request that minted the item. There is deliberately NO
-- hard-delete carve-out for never-ordered items: one path, not two, on a destructive operation.
--
-- 🔌 INERT ON ARRIVAL, and correct without a backfill. Every existing row is NULL after this
-- migration, and NULL is exactly right — nothing has been removed yet. Contrast
-- 20260804000000_add_vendor_member_approval_status, which needed a hand-written grandfather
-- UPDATE because it added NOT NULL DEFAULT 'PENDING' behind a future gate. This column has no
-- default, no NOT NULL, and nothing reads it yet: the absence of a backfill is a property of
-- the design, not an omission. The write flip, the read filters, the cart check and the
-- readiness count all ship in a later, separate commit.
--
-- REVERSIBLE: restore is `"removedAt" = NULL`. The state supports undo whether or not a restore
-- button ships.
--
-- NON-DESTRUCTIVE: ADD COLUMN + CREATE INDEX only, so scripts/safe-migrate.ts applies it without
-- CONFIRM_DEPLOY_ORDERING — deployed code that has never heard of removedAt keeps working,
-- because a nullable added column is invisible to every existing SELECT and INSERT.

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- CreateIndex
-- Every customer read will filter on this (the getGroupedMenuItems chokepoint), alongside the
-- existing vendorId and isAvailable indexes.
CREATE INDEX "MenuItem_removedAt_idx" ON "MenuItem"("removedAt");
