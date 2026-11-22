-- Item 10 stage 5 (expand only): the service-fee part of an owed-back refund, and the refund that carried it.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "serviceFeeRefundCents" INTEGER,
ADD COLUMN     "serviceFeeRefundId" TEXT;

