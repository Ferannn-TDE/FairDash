-- Persist become-driver's application (previously collected-then-discarded — POST
-- /api/drivers only logged it). NOT a Runner row: Runner is event-scoped
-- (Runner.eventId required, userId unique), created by an admin when assigning a
-- driver to a fair. This is the platform-level pending-review application that
-- precedes that — the runner analog of a PENDING Vendor application. Consent is an
-- auditable record (which affirmations / which terms / when / where), not bare
-- booleans, so a dispute can show "agreed v<version> on <date> from <ip>".

-- CreateEnum
CREATE TYPE "RunnerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RunnerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "city" TEXT,
    "vehicleType" TEXT NOT NULL,
    "vehicleMake" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "vehicleYear" TEXT NOT NULL,
    "vehicleColor" TEXT,
    "vehiclePlate" TEXT,
    "termsAgreed" BOOLEAN NOT NULL,
    "backgroundCheckConsent" BOOLEAN NOT NULL,
    "termsVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsAcceptedIp" TEXT,
    "status" "RunnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunnerApplication_status_idx" ON "RunnerApplication"("status");

-- CreateIndex
CREATE INDEX "RunnerApplication_email_idx" ON "RunnerApplication"("email");

-- AddForeignKey
ALTER TABLE "RunnerApplication" ADD CONSTRAINT "RunnerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
