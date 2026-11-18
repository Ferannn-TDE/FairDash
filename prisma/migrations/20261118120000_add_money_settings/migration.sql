-- Money settings (item 10 / B1.13 stage 2, BATCH-1 §19 S2-Q5). Rows only, no schema change.
-- Seeds the four fee terms. ON CONFLICT DO NOTHING: a key already present keeps its value, and a
-- second run inserts nothing. One change-log entry per row ACTUALLY inserted (tied to the insert by
-- RETURNING), so the log can never claim a seed that didn't happen.
-- Nothing reads these yet: checkout keeps charging the 10% in lib/constants.ts until stage 3.
WITH seed ("key", "value") AS (
  VALUES
    ('fees.serviceFee.percentBps',   '1500'::jsonb),
    ('fees.serviceFee.flatCents',    '0'::jsonb),
    ('fees.curbsideRunnerFeeCents',  '399'::jsonb),
    ('fees.cardFeesPaidBy',          '"VENDOR"'::jsonb)
),
inserted AS (
  INSERT INTO "PlatformSetting" ("key", "value", "updatedAt", "updatedById", "updatedByType")
  SELECT "key", "value", CURRENT_TIMESTAMP, 'migration:20261118120000_add_money_settings', 'system'
  FROM seed
  ON CONFLICT ("key") DO NOTHING
  RETURNING "key", "value"
)
INSERT INTO "PlatformSettingChange" ("id", "key", "oldValue", "newValue", "actorId", "actorType", "reason", "createdAt")
SELECT 'mseed_' || replace(gen_random_uuid()::text, '-', ''), "key", NULL, "value",
       'migration:20261118120000_add_money_settings', 'system', 'Starting value (item 10, stage 2)', CURRENT_TIMESTAMP
FROM inserted;
