-- Menu request BATCHING — group N rows of one submission under a shared correlation id.
--
-- A vendor stages several items and sends them together; every row of that submission carries
-- the same server-minted cuid. The organizer still approves or rejects PER ITEM — grouping is
-- presentational, and the row remains the unit of action.
--
-- ⚠️ NULL MEANS STANDALONE, NEVER "THE NULL BATCH". Every existing row is NULL after this
-- migration and every one of them is a standalone request — which is already correct, so there
-- is nothing to backfill. The danger is not in the data, it is in the READER: a naive
-- `groupBy(batchId)` would collapse every legacy request in a fair into one giant group. The
-- grouping helper keys null rows individually (`solo:<id>`) so that collapse is unexpressible,
-- and scripts/menu-request-batch-compat-guard.ts proves a legacy row still renders and approves
-- exactly as before.
--
-- CONTRAST with 20260804000000_add_vendor_member_approval_status, the last migration to add a
-- column to a gated table: that one needed a hand-written grandfather UPDATE, because it added
-- NOT NULL DEFAULT 'PENDING' and a later gate would have read it and locked every existing
-- operator out. This column has NO default and NO NOT NULL, and nothing gates on it — so the
-- absence of a backfill here is a property of the design, not an omission.
--
-- 🔌 INERT ON ARRIVAL. Nothing writes batchId after this migration and nothing reads it. The
-- column lands alone so the schema is in place before any code depends on it; the read-route
-- projection, the grouping helper, the write path and the UI ship in later, separate commits.
--
-- NON-DESTRUCTIVE: ADD COLUMN + CREATE INDEX only. scripts/safe-migrate.ts passes this without
-- CONFIRM_DEPLOY_ORDERING — deployed code that has never heard of batchId keeps working, since
-- a nullable added column is invisible to every existing SELECT and INSERT.

-- AlterTable
ALTER TABLE "MenuRequest" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
-- Grouping reads filter by batch ("the rest of this submission"), and the organizer list is
-- already indexed on vendorId/status; this is the third access path.
CREATE INDEX "MenuRequest_batchId_idx" ON "MenuRequest"("batchId");
