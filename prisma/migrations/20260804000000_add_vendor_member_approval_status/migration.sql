-- Vendor OPERATOR admittance — "may this HUMAN operate this booth".
--
-- ⚠️ NOT the booth. Vendor.status ("may this BOOTH trade") is UNTOUCHED by this migration and
-- keeps gating order creation, public visibility and readiness exactly as before. This is a
-- SECOND, INDEPENDENT axis on VendorMember, which until now carried no approval state at all —
-- membership existence alone admitted a human to the vendor portal. The hole it exists to close:
-- an ACTIVE booth operated by a human nobody vetted (or one who was rejected).
--
-- Reuses the ApprovalStatus enum created by 20260712000000_add_runner_approval_status, which was
-- named generically for exactly this reuse. Third subject, same lifecycle.
--
-- 🔌 INERT ON ARRIVAL. Nothing reads approvalStatus after this migration — no gate, no route, no
-- UI. Enforcement ships in later, separate commits. The backfill lands FIRST and ALONE on purpose:
-- the grandfather must be in the database BEFORE any code can lock anyone out, not alongside it.

-- AlterTable
ALTER TABLE "VendorMember" ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- ── GRANDFATHER (hand-added; prisma migrate does NOT infer this) ──────────────────────────
-- The ADD COLUMN above set EVERY existing VendorMember to the PENDING default. Without this
-- UPDATE, the day the gate ships every current operator is locked out of the vendor portal.
-- Verified against the live database before writing this: 4 VendorMember rows exist, all on
-- Italian Fest 2026 (urlSlug springfield-state-fair-2026), which opens 2026-08-05 — including
-- the operator of RANDY'S HOUSE OF BBQ, an ACTIVE Stripe-verified booth.
--
-- ALL FOUR are promoted, including the two clerk_test operators. Their BOOTHS are
-- Vendor.status = PENDING, so order creation still refuses them (app/api/orders/route.ts) —
-- operator admittance is not trading permission, and the two axes stay independent. Selective
-- grandfathering is where the forward-only property would bend, so it isn't done.
--
-- Promote every pre-existing row to APPROVED so the gate applies ONLY to operators created from
-- here on. New rows keep the PENDING default. Mirrors the runner and organizer migrations
-- verbatim. The WHERE clause is also the safety: it can only touch rows that just took the
-- default (nothing else backstops this table — VendorMember has no eventId, so the prod-write
-- guard cannot see it, and raw SQL bypasses guardedPrisma regardless).
UPDATE "VendorMember"
   SET "approvalStatus" = 'APPROVED',
       "approvedAt"     = NOW(),
       "approvedBy"     = 'system-grandfather'
 WHERE "approvalStatus" = 'PENDING';

-- CreateIndex
CREATE INDEX "VendorMember_approvalStatus_idx" ON "VendorMember"("approvalStatus");
