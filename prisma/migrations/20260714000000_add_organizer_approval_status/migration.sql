-- Organizer admin-approval gate (#7).
--
-- The organizer is the HIGHEST-authority role — runs whole fairs, approves vendors, and sits
-- in the money-control flow (refunds, disputes, chargebacks) — and was the ONLY ungated one:
-- self-active on signup, while vendors and runners both wait for approval. This closes that.
--
-- Reuses the ApprovalStatus enum created by 20260712000000_add_runner_approval_status, which
-- named it generically for exactly this purpose.
--
-- Enforcement is one check in requireOrganizerAuth (lib/auth.ts): all 26 organizer routes
-- funnel through it, so a PENDING organizer is blocked server-side from fair creation, vendor
-- approval, refunds, disputes and chargebacks — not merely by hidden buttons.

-- AlterTable
ALTER TABLE "FairOrganizer" ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- ── GRANDFATHER (hand-added; prisma migrate does NOT infer this) ──────────────────────────
-- The ADD COLUMN above set EVERY existing FairOrganizer to the PENDING default. Without this
-- UPDATE, deploying the gate would INSTANTLY LOCK OUT every current organizer — including the
-- one running the live fair (verified before writing this: 2 organizers exist, and "Feran
-- Events" runs Italian Fest 2026, which is ACTIVE right now). Promote every pre-existing row
-- to APPROVED so the new gate applies ONLY to organizers created from here on. New rows keep
-- the PENDING default. Mirrors the runner migration's grandfather step verbatim.
UPDATE "FairOrganizer"
   SET "approvalStatus" = 'APPROVED',
       "approvedAt"     = NOW(),
       "approvedBy"     = 'system-grandfather'
 WHERE "approvalStatus" = 'PENDING';

-- CreateIndex
CREATE INDEX "FairOrganizer_approvalStatus_idx" ON "FairOrganizer"("approvalStatus");
