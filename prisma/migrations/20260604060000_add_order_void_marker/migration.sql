-- Out-of-model exclusion marker for orders (e.g. pre-fee-model test data).
-- Additive, nullable columns only. No data change, no Stripe impact.
ALTER TABLE "Order" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "voidReason" TEXT;
