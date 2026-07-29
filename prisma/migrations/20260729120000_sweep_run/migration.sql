-- SweepRun — durable reconciler history. One row per COMPLETED sweep.
--
-- ADDITIVE ONLY: CREATE TABLE + two CREATE INDEX. No column is renamed, dropped or retyped,
-- so deployed code that predates this migration is unaffected and the ordering rule in
-- scripts/safe-migrate.ts does not bite (it blocks pending RENAME/DROP, not new tables).
--
-- ⚠️ HAND-SCOPED, DELIBERATELY. `prisma migrate diff --from-migrations` also emitted TEN
-- unrelated `DROP INDEX` statements (Order_customerId_idx, Order_eventId_idx,
-- Order_placedAt_idx, Order_vendorId_idx, OrderItem_vendorId_idx, Vendor_eventId_idx,
-- VendorMember_userId_idx, VendorMember_vendorId_idx, VendorOrderStatus_orderId_idx,
-- VendorOrderStatus_vendorId_idx) — PRE-EXISTING drift between the migration history and
-- schema.prisma, not part of this change. Shipping them here would drop live indexes as a
-- side effect of adding a table. They are excluded and reported instead.
CREATE TABLE "SweepRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "commit" TEXT,
    "repaired" JSONB NOT NULL,
    "repairedTotal" INTEGER NOT NULL,
    "alertedCount" INTEGER NOT NULL,
    "suppressedCount" INTEGER NOT NULL,
    "ambiguousSkipped" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SweepRun_startedAt_idx" ON "SweepRun"("startedAt");

CREATE INDEX "SweepRun_dryRun_startedAt_idx" ON "SweepRun"("dryRun", "startedAt");
