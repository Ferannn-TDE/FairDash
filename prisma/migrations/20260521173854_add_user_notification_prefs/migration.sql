-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifDailySummary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifMenuRequests" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifNewOrder" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifVendorOffline" BOOLEAN NOT NULL DEFAULT true;
