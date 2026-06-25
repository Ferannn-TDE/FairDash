-- Runner earnings: tracked-but-not-yet-paid per completed delivery (display only).
CREATE TABLE "RunnerEarning" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'tracked',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RunnerEarning_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunnerEarning_orderId_key" ON "RunnerEarning"("orderId");
CREATE INDEX "RunnerEarning_runnerId_idx" ON "RunnerEarning"("runnerId");
CREATE INDEX "RunnerEarning_eventId_idx" ON "RunnerEarning"("eventId");
ALTER TABLE "RunnerEarning" ADD CONSTRAINT "RunnerEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RunnerEarning" ADD CONSTRAINT "RunnerEarning_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "Runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
