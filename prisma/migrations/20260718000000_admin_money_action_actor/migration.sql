-- Generalize AdminMoneyAction.adminClerkId → actorId + actorType, so a money action's
-- audit can honestly record a NON-admin actor (organizer refund, reconciler sweep, system
-- webhook) — the money-attribution invariant. The refund-time accrual reverser and the
-- reconciler Pattern-T backstop both write non-admin rows and had nowhere honest to record
-- who acted.
--
-- GRANDFATHER: a plain RENAME preserves the value (actorId = the old adminClerkId), and
-- actorType defaults 'admin' — every row that existed before this change WAS an admin action,
-- so all existing rows are correctly labelled without a backfill statement.
--
-- DEPLOY NOTE: local DB == prod Supabase DB. The deployed /admin money route reads this
-- table all-scalars, so a rename breaks it until redeploy — apply this migration and deploy
-- the code that reads actorId/actorType BACK TO BACK (admin-only surface, no live users).
ALTER TABLE "AdminMoneyAction" RENAME COLUMN "adminClerkId" TO "actorId";
ALTER TABLE "AdminMoneyAction" ADD COLUMN "actorType" TEXT NOT NULL DEFAULT 'admin';

DROP INDEX IF EXISTS "AdminMoneyAction_adminClerkId_idx";
CREATE INDEX "AdminMoneyAction_actorId_idx" ON "AdminMoneyAction"("actorId");
CREATE INDEX "AdminMoneyAction_actorType_idx" ON "AdminMoneyAction"("actorType");
