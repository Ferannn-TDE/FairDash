-- Soft-delete for fairs. null = live; a set timestamp hides the fair from all
-- customer + organizer views while preserving the row and every attached
-- financial record. Money/audit/integrity paths deliberately ignore this flag.
ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Supports the "live, non-archived" filter on public + organizer list surfaces.
CREATE INDEX "Event_status_archivedAt_idx" ON "Event"("status", "archivedAt");
