-- CreateTable
CREATE TABLE "PayeeNotice" (
    "id" TEXT NOT NULL,
    "noticeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payeeType" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_email_platform',
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayeeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayeeNotice_noticeKey_key" ON "PayeeNotice"("noticeKey");

-- CreateIndex
CREATE INDEX "PayeeNotice_payeeType_payeeId_kind_idx" ON "PayeeNotice"("payeeType", "payeeId", "kind");

-- CreateIndex
CREATE INDEX "PayeeNotice_status_idx" ON "PayeeNotice"("status");
