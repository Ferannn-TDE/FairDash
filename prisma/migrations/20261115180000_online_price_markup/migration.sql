-- Online price markup (H5 step 2h). Expand only: four new columns that are empty or 0 by default, one new table.
-- No existing column changes. Every event starts at 0%, so no price changes until someone sets a markup.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "onlineMarkupBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "onlineMarkupBps" INTEGER,
ADD COLUMN     "serviceFeeBase" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "inPersonUnitPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "EventMarkupChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorClerkId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "oldBps" INTEGER NOT NULL,
    "newBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMarkupChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventMarkupChange_eventId_createdAt_idx" ON "EventMarkupChange"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventMarkupChange" ADD CONSTRAINT "EventMarkupChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
