-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "allowGuestBrowse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxVendorsPerOrder" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "orderAcceptanceWindowSec" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "showVendorWaitTimes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "vendorOfflineHideSec" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "welcomeMessage" TEXT;
