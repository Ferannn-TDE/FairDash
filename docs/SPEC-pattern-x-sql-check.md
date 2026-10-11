# Spec: Pattern X consistency check in SQL (option B)

Status: not started. Option A (Pattern X on its own interval, `WORKER_PATTERN_X_INTERVAL_MS`) is the
stopgap; this is the lasting fix.

## Problem

Pattern X (`lib/reconciler.ts`, `patternX`) loads **every** unreversed `Payout` with an `orderId`,
then every `VendorEarning`, COMPLETED `Refund` and `Order` for those orders, and decides in
JavaScript. Measured 2026-10-11: ~68 KB of a ~70 KB sweep, about 730 bytes per payout ever made.
It is unwindowed on purpose (a crash that ages out of Pattern C's 24h window must still be caught),
so the cost grows with every payout: ~1,000 payouts ≈ 0.7 MB per run.

## Goal

Return only the payouts that need attention, so the cost tracks the number of anomalies, not the
number of payouts. The healthy case (earning `paid`, no unreversed completed refund) never leaves
the database.

## Current decision, per settled payout (order of checks matters)

Keyed by `(orderId, vendorId)`:

1. Transfer id is in `POLLUTED_TRANSFER_IDS` → **suppressed** (fabricated, nothing to heal).
2. A COMPLETED refund for the key has no `stripeReversalId` → **X1 alert** (checked before "paid").
3. Earning `status = 'paid'` → **healthy, skip**.
4. No earning row → **X2 alert**, or **suppressed** if in `ACKNOWLEDGED_X2` (order + vendor + amount).
5. Earning `netCents` set and ≠ `round(netAmount × 100)` → **X2 amount-mismatch alert**.
6. Otherwise → **X2 heal** (ledger set to `paid`, audit row, no money moves).

## Proposed query

One raw SQL query (Prisma relation filters can't express the join on `(orderId, vendorId)`):

```sql
SELECT p.id, p."orderId", p."vendorId", p."eventId", p."netAmount", p."stripeTransferId",
       e.id AS "earningId", e.status AS "earningStatus", e."netCents",
       r."stripeRefundId", r."amountCents" AS "refundCents", r."stripeReversalId",
       o.status AS "orderStatus", o."completedAt", o."voidedAt"
FROM "Payout" p
LEFT JOIN "VendorEarning" e ON e."orderId" = p."orderId" AND e."vendorId" = p."vendorId"
LEFT JOIN LATERAL (
  SELECT "stripeRefundId", "amountCents", "stripeReversalId" FROM "Refund"
  WHERE "orderId" = p."orderId" AND "vendorId" = p."vendorId" AND status = 'COMPLETED'
  ORDER BY ("stripeReversalId" IS NULL) DESC, "createdAt" DESC LIMIT 1
) r ON true
JOIN "Order" o ON o.id = p."orderId"
WHERE p."reversedAt" IS NULL AND p."orderId" IS NOT NULL
  AND ( (r."amountCents" IS NOT NULL AND r."stripeReversalId" IS NULL)  -- X1: a completed refund, not reversed
        OR e.id IS NULL                                                -- X2: no earning row
        OR e.status <> 'paid' )                                        -- X2: ledger lag
ORDER BY p."createdAt", p.id
LIMIT $scanCeiling
```

The JavaScript decision stays exactly as it is (steps 1–6), run over these rows only. Polluted and
acknowledged rows still come back if they are anomalous, so `suppressed` stays honest. If they
dominate the result, move them to a separate `COUNT(*)` so the suppressed total survives without
the rows.

## Known equivalence traps

- **Multiple refunds per key.** Today `refundBy` is a `Map`, so the last COMPLETED refund returned
  wins and X1 depends on database row order. The lateral join above picks an unreversed refund
  first, which can raise an X1 that today's code misses. Decide which is correct (an unreversed
  completed refund should alert) and record it; the equivalence test must name this case.
- **Scan ceiling.** Today the ceiling counts all payouts; after the change it counts anomalies only.
  The "SCAN CEILING HIT" alert keeps its meaning (rows not examined), but fires far later.
- **`netAmount` is a float.** Keep `Math.round(netAmount * 100)` in JavaScript, not in SQL.
- **Archived fairs.** No event or date filter. Money paths must see archived and ended fairs.

## Equivalence test (must pass before switching)

`scripts/pattern-x-sql-equivalence.ts`, registered in the gate, against the test DB:

1. Seed fixtures covering every branch: healthy paid, X1 (one refund, unreversed), X1 with two refunds
   (one reversed, one not, in both insert orders), X2 no row, X2 acknowledged, X2 amount mismatch,
   X2 healable lag, polluted transfer, reversed payout (excluded), payout without `orderId` (excluded),
   voided order, archived fair.
2. Run the current `patternX` and the SQL version in `dryRun` on the same data. Assert identical
   `repaired.X`, `details.X`, `alerted` and `suppressed` (sorted), except the documented
   multiple-refund case, which must match the decision made above.
3. Positive control: a fixture that only the old code fetches (a healthy paid row) is absent from the
   SQL result, so the filter is shown to cut rows rather than pass vacuously.
4. Read-only replay against a production snapshot with the sealed dry-run harness: both versions
   produce the same summary, and the SQL version's result bytes are reported.

## Rollout

Behind `RECONCILER_PATTERN_X_SQL=true` for one fair day with both versions running and their results
diffed in the log. Then make it the default and delete the old fetch. Keep
`WORKER_PATTERN_X_INTERVAL_MS` as an independent knob.
