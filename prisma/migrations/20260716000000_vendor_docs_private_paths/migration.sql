-- Vendor compliance documents: public URLs → private object PATHS.
--
-- The *Url columns held `…/storage/v1/object/public/vendor-documents/<path>` links in a
-- PUBLIC bucket. Renaming to *Path is the structural half of the fix (a public URL can no
-- longer be persisted here unnoticed); the bucket flip is the other half.
--
-- ORDER MATTERS: add the new columns, BACKFILL from the old ones, and only then drop the
-- old ones. The objects themselves are NOT moved — only the DB value changes, so every
-- existing document remains resolvable through the new signed-URL read path.

-- 1. New PATH columns.
ALTER TABLE "Vendor" ADD COLUMN "foodHandlerPermitPath" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "insurancePath"         TEXT;
ALTER TABLE "Vendor" ADD COLUMN "businessLicensePath"   TEXT;

-- 2. Backfill: strip everything up to and including the public-object marker, leaving the
--    object path. split_part on the marker returns '' when absent, so NULLIF maps
--    non-matching/legacy junk to NULL rather than an empty string.
UPDATE "Vendor"
SET "foodHandlerPermitPath" =
      NULLIF(split_part("foodHandlerPermitUrl", '/object/public/vendor-documents/', 2), ''),
    "insurancePath" =
      NULLIF(split_part("insuranceUrl",         '/object/public/vendor-documents/', 2), ''),
    "businessLicensePath" =
      NULLIF(split_part("businessLicenseUrl",   '/object/public/vendor-documents/', 2), '')
WHERE "foodHandlerPermitUrl" IS NOT NULL
   OR "insuranceUrl"         IS NOT NULL
   OR "businessLicenseUrl"   IS NOT NULL;

-- 3. Drop the URL columns. A *Url column is now structurally impossible to repopulate.
ALTER TABLE "Vendor" DROP COLUMN "foodHandlerPermitUrl";
ALTER TABLE "Vendor" DROP COLUMN "insuranceUrl";
ALTER TABLE "Vendor" DROP COLUMN "businessLicenseUrl";
