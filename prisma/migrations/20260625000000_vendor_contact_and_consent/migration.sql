-- Persist become-vendor's contact + legal consent (previously collected-but-discarded).
-- Contact lives on Vendor (the application's contact, may differ from the applicant's
-- Clerk identity on User). Consent is an auditable record (who/which terms/when/where),
-- NOT a bare boolean — so a dispute can show "signed v<version> on <date> from <ip>".

ALTER TABLE "Vendor"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "termsAcceptedName" TEXT,
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsAcceptedIp" TEXT;
