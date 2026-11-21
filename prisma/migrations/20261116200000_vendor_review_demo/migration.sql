-- Vendor approval: reviewer name + demo flag (Nov 16). Expand only: two new columns, no existing column changes.
-- Every existing vendor starts as not demo; existing approval records keep an empty reviewer name.

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ApprovalAction" ADD COLUMN     "actorName" TEXT;
