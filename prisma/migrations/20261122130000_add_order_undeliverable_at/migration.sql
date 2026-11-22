-- Payout gap fix (expand only): the time an order was marked UNDELIVERABLE (its end time for the vendor payout).
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "undeliverableAt" TIMESTAMP(3);

