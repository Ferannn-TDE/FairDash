-- A6 kill-switch: org-wide organizer suspension (DB state, immediate-effect).
ALTER TABLE "FairOrganizer" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "FairOrganizer" ADD COLUMN "suspendedReason" TEXT;

-- CreateIndex
CREATE INDEX "FairOrganizer_suspendedAt_idx" ON "FairOrganizer"("suspendedAt");
