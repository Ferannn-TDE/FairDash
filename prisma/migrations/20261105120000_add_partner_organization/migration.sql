-- Partner organization applications (Batch 1 item 7, B1.11). Expand only: one new table.

-- CreateTable
CREATE TABLE "PartnerOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupType" TEXT NOT NULL,
    "groupTypeOther" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "interests" TEXT,
    "staffHours" TEXT,
    "note" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerOrganization_approvalStatus_idx" ON "PartnerOrganization"("approvalStatus");

-- CreateIndex
CREATE INDEX "PartnerOrganization_contactEmail_idx" ON "PartnerOrganization"("contactEmail");

