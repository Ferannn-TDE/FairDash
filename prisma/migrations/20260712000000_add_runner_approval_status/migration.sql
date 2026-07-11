-- Runner admin-approval gate. A runner cannot go online OR claim a delivery until
-- an admin approves them (enforced server-side in /api/runners/me and
-- /api/orders/[id]/status). ApprovalStatus is generically named because organizer
-- approval (#7) reuses the exact same enum + audit-field shape.

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Runner" ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Runner" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Runner" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "Runner" ADD COLUMN "rejectionReason" TEXT;

-- GRANDFATHER (hand-added; prisma migrate does NOT infer this). The ADD COLUMN
-- above set EVERY existing Runner to the PENDING default, which would instantly
-- lock out all current runners. Promote every pre-existing row to APPROVED so the
-- new gate applies only to runners created from here on. New rows keep PENDING.
UPDATE "Runner"
   SET "approvalStatus" = 'APPROVED',
       "approvedAt"     = NOW(),
       "approvedBy"     = 'system-grandfather'
 WHERE "approvalStatus" = 'PENDING';

-- CreateIndex
CREATE INDEX "Runner_approvalStatus_idx" ON "Runner"("approvalStatus");
