-- Add operating hours (JSON schedule) to Vendor
ALTER TABLE "Vendor" ADD COLUMN "operatingHours" JSONB;

-- Add business license URL (foodHandlerPermitUrl + insuranceUrl already exist)
ALTER TABLE "Vendor" ADD COLUMN "businessLicenseUrl" TEXT;

-- Add Stripe connected timestamp
ALTER TABLE "Vendor" ADD COLUMN "stripeConnectedAt" TIMESTAMP(3);
