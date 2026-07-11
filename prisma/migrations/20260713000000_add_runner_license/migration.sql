-- Driver's licence (SENSITIVE PII).
--
-- licensePath holds the object PATH inside the PRIVATE `runner-documents` Supabase
-- bucket — NOT a public URL. Reads are brokered by API routes that mint short-lived
-- signed URLs and authorise the caller (runner-self or admin). This deliberately
-- diverges from the vendor-document columns (foodHandlerPermitUrl / insuranceUrl /
-- businessLicenseUrl), which persist public URLs and remain a known privacy follow-up.
ALTER TABLE "Runner" ADD COLUMN "licensePath" TEXT;
ALTER TABLE "Runner" ADD COLUMN "licenseUploadedAt" TIMESTAMP(3);
