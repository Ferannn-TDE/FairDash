-- AlterTable
ALTER TABLE "VendorOrderStatus" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "preparingAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3);
