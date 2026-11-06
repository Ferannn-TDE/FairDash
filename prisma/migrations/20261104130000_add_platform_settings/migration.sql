-- Platform settings (Batch 1 item 5). Expand only: two new tables, no seed rows. A missing row
-- means the code default (lib/settings.ts), so nothing changes for anyone until a value is saved.

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedByType" TEXT NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformSettingChange" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "actorId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettingChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformSettingChange_key_createdAt_idx" ON "PlatformSettingChange"("key", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformSettingChange_createdAt_idx" ON "PlatformSettingChange"("createdAt");

