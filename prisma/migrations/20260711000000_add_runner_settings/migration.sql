-- Runner-editable settings persisted from the Settings page (me-scoped writes via
-- PATCH /api/runners/me). Identity name/email stay Clerk-owned; only runner-specific
-- fields live here. All nullable / defaulted so existing Runner rows are unaffected.
ALTER TABLE "Runner" ADD COLUMN "phone" TEXT;
ALTER TABLE "Runner" ADD COLUMN "vehicleMake" TEXT;
ALTER TABLE "Runner" ADD COLUMN "vehicleModel" TEXT;
ALTER TABLE "Runner" ADD COLUMN "vehicleColor" TEXT;
ALTER TABLE "Runner" ADD COLUMN "vehiclePlate" TEXT;
ALTER TABLE "Runner" ADD COLUMN "notifyNewDelivery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Runner" ADD COLUMN "notifyOrderUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Runner" ADD COLUMN "notifyEarnings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Runner" ADD COLUMN "availableDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
