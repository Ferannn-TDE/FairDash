-- Order fee snapshot (item 10 / B1.13 stage 2, BATCH-1 §5 + §19 S2-Q6). Expand only.
-- Four NULLABLE columns, no default, no backfill: null means "today's 10% rules", which is how
-- stage 4 knows a legacy order pays exactly what today's code pays. Nothing reads or writes them
-- until stage 3.

-- CreateEnum
CREATE TYPE "CardFeesPaidBy" AS ENUM ('VENDOR', 'PLATFORM');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cardFeesPaidBy" "CardFeesPaidBy",
ADD COLUMN     "feeModel" INTEGER,
ADD COLUMN     "serviceFeeBps" INTEGER,
ADD COLUMN     "serviceFeeFlatCents" INTEGER;
