-- Fair venue + details captured by the organizer create-fair wizard.
ALTER TABLE "Event" ADD COLUMN "venueAddress"  TEXT;
ALTER TABLE "Event" ADD COLUMN "venueCity"     TEXT;
ALTER TABLE "Event" ADD COLUMN "venueState"    TEXT;
ALTER TABLE "Event" ADD COLUMN "venueZip"      TEXT;
ALTER TABLE "Event" ADD COLUMN "openTime"      TEXT;
ALTER TABLE "Event" ADD COLUMN "closeTime"     TEXT;
ALTER TABLE "Event" ADD COLUMN "maxVendors"    INTEGER;
ALTER TABLE "Event" ADD COLUMN "admissionFree" BOOLEAN NOT NULL DEFAULT true;
