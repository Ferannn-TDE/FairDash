-- Runner sign-up no longer asks for a vehicle (Driver Terms 2026-11-04). Expand only:
-- existing rows keep their values, and code that still writes the columns keeps working.
ALTER TABLE "RunnerApplication" ALTER COLUMN "vehicleType" DROP NOT NULL,
ALTER COLUMN "vehicleMake" DROP NOT NULL,
ALTER COLUMN "vehicleModel" DROP NOT NULL,
ALTER COLUMN "vehicleYear" DROP NOT NULL;
