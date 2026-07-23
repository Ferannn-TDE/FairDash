# FairSynq — Current State

> **Volatile. Regenerate before trusting** — run `git log --oneline main -8` and `git branch -v`
> first and reconcile. Do NOT copy anything from this file into `PROJECT_INVARIANTS.md`. This file
> is throwaway: paste it into a working session, never into persistent project knowledge.
>
> Snapshot taken: reading of `main @ b694b1e`, amended 2026-07-23 after the admin runner-stats
> batch (5 local commits, see Git section). Numbers below were measured against the live DB on the
> session that wrote them unless marked otherwise.

---

## Git / deploy reality

- **`main` head: `b694b1e`** — "Merge: walkthrough batch 2 — address, Ready-lane, delivered timeline,
  runner stats (4a–4d)".
- **Unpushed: 7 local commits** (2026-07-23): the CURRENT_STATE regeneration (`3b1d0ad`) + the
  admin runner-stats batch (`831e182` ghost fix, `ade9c73` custody-for-counts, `e0ef587` admin
  wiring + floor, `0121c44` guard suite + possession amendment, `f2bb60f` docs, + the
  comment-rewording commit at HEAD, which can't name its own hash). `origin/main`
  is at `b694b1e` — **what's deployed is the walkthrough batch, fingerprint-confirmed**
  (`/api/health` served `"commit":"b694b1e…"` on 2026-07-22); this batch deploys on the next human
  push.
- **Caveat (unchanged): this shell has no SSH key** — `git ls-remote` fails with `Permission denied
  (publickey)`, so branch-level origin state is inferred from local remote-tracking refs. The head
  claim above does not rest on that inference: the served `/api/health` fingerprint is direct
  evidence.
- **Branches:** ~36 local branches, nearly all historical and already merged. The batch's branch
  `fix/walkthrough-batch-2` (`e44eb3b`) is merged via `b694b1e`; `feat/vehicle-snapshot-profile-log`,
  `feat/runner-customer-ui-batch`, `fix/walkthrough-batch` likewise. **No unmerged branch holds
  pending work.** Working tree is clean apart from this file and `PROJECT_INVARIANTS.md` (both
  untracked).

## Infra status

Re-verified this session — **nothing changed**:

- **Worker: OFF.** `/api/health` reports `redis: "unreachable"`, `worker: { status: "unknown",
  lastSweepAt: null }`, HTTP **503 degraded**. Upstash quota still exhausted.
- **Consequently untestable right now:** the vendor accept-timeout (2-min auto-cancel), delivery
  strand clocks, all delayed payout jobs (vendor/runner/organizer), the reconcile sweep and every
  Pattern (including the dormant **Pattern W** retention purge), and anything BullMQ-delayed.
- The 503 + `unreachable` is **the endpoint working**, not a regression (see
  `PROJECT_INVARIANTS.md` → _Things that look like bugs but aren't_).
- **The fix is the Railway-Redis migration (pending).** Until then, do not test or assume any
  worker-dependent behavior. No worker-dependent suite was run this session.

## The current arc — the delivery / customer-UI walkthrough loop

**The six-item walkthrough batch is CLOSED.** Five commits + a merge landed it (`d2c8e76`,
`6ec3c25`, `51e8ef9`, `e21fa7f`, `e44eb3b` → `b694b1e`); item #1 needed no code (see Open items).

Shipped, merged, and deployed this arc:

- Delivery custody escape path U0–U5 (claim/collect/release/return/vendor-confirm), strand clocks.
- The ghost/void class — voided orders are dead to all runner/custody surfaces.
- The `/active` partial-rows contract (`VendorActiveOrder`) + the typecheck gate.
- Runner earnings correctness (share + tip, per-delivery breakdown, paid/pending); flicker skeletons;
  vendor kitchen-card detail; 7-segment tracking bar; vehicle snapshot (D) + profile-change log +
  Pattern W deleter; runner-fee activation gate.
- **#2 Duplicated address — FIXED at the write path.** `checkout/page.tsx:399` now sends
  `deliveryCity: form.deliveryCity.trim() || null`; the `|| deliveryStreet` fallback is gone and the
  reason is in the comment at `:394-398`. Guard: `scripts/delivery-address-guard.ts` (3/3 green,
  re-run this session).
- **#3 Collected order leaves the vendor Ready lane.** Server: `/active` adds `collectedAt: null` to
  the where-clause (`app/api/vendors/[id]/orders/active/route.ts:48`, with the "LIVE lane only —
  history must still show collected orders" note at `:43-47`); the contract carries the field
  (`lib/vendor-active-order.ts:40`, `:67`, `:94`). Client: the Ready memo gates on `!o.collectedAt`
  (`app/vendor/[fairSlug]/dashboard/page.tsx:457`) and the refetch now **RECONCILES** — active-lane
  orders absent from a fresh `/active` are evicted, non-active and in-flight optimistic rows are
  preserved (`:537-551`). Guard: `scripts/ready-lane-eviction-guard.ts` (seeds a throwaway event;
  not re-run this session — it writes to the DB).
- **#5 Delivered milestone reaches the timeline.** `components/order/OrderComponents.tsx:539` keys on
  `order.status === 'DELIVERED'` (same signal as the bar) and renders
  `order.runnerEarning.createdAt` (`:540-541`); the route exposes it at
  `app/api/orders/[id]/route.ts:50` with the rationale at `:46-49`; the type is documented at
  `components/order/types.ts:63-65`. Guard: `scripts/delivered-timeline-guard.ts` (6/6 green, re-run
  this session).
- **#4a–4d Runner stats.** `totalDeliveries` now comes from the RunnerEarning ledger
  (`lib/runner-earnings.ts:50-53` `deliveriesTotal`, wired at
  `app/api/runners/me/earnings/route.ts:49-53`) — curbside included, cancelled payouts excluded — and
  a Today / All-time toggle scopes the earned + deliveries cards
  (`app/runner/[fairSlug]/earnings/page.tsx:56`, `:87-98`, `:100-112`). Completion rate is computed
  in `lib/runner-completion.ts:30-40`. Guards: `scripts/runner-earnings-guard.ts` (extended),
  `scripts/runner-completion-guard.ts`.

**Two decisions were made and are now settled — do not re-litigate:**

- **(a) #5 — `completedAt` on DELIVERED was deliberately NOT backfilled.** The null is load-bearing:
  `COMPLETE_STATES = [COMPLETED, DELIVERED]` and Pattern C (payout backstop) / Pattern S (earning
  restore) scan `status IN COMPLETE_STATES AND completedAt >= windowStart`, so the null is what keeps
  the 44 legacy DELIVERED orders out of those money windows. Backfilling would pull them in. The
  timeline reads the accrual timestamp instead. Pinned by `scripts/delivered-timeline-guard.ts` step
  [3]: "reconcile sets `completedAt` for COMPLETED only" — verified against
  `lib/reconcile-order-status.ts:426`, the file's only `completedAt` write.
- **(b) #4c — completion rate = delivered ÷ collected, from the custody events.** The denominator is
  orders with a `'collected'` custody event for that runner; the numerator is those now `DELIVERED`
  and still assigned to them (a confirmed return nulls `runnerId`, so a returned order can never be
  miscounted as a delivery). **A pre-collect release never creates a `'collected'` event, so it is
  NOT in the denominator** — releasing early costs the runner nothing, which is the point of the
  release path. No collected events → rate 1.0. Two v1 caveats are **flagged, not solved**
  (`lib/runner-completion.ts:13-17`): a post-collect return for spoiled/wrong food is scored the same
  as flaking, and a second runner completing the order does not un-damn the first.

**Open findings from the walkthrough: none.**

### Shipped 2026-07-23 — the admin runner-stats batch (closes what was open item 4)

The dead-counter residual found during the regeneration sweep is FIXED, four commits, all local:

- **The durable rule (both surfaces): CUSTODY IS THE SPINE FOR COUNTS; THE LEDGER IS THE SPINE FOR
  MONEY.** Delivery counts, delivered/collected, completion denominators derive from
  `DeliveryCustodyEvent` (`lib/runner-completion.ts`); dollars, paid/pending, per-delivery
  breakdown derive from `RunnerEarning` (`lib/runner-earnings.ts`). The ledger only ever knew about
  deliveries that generated money — a DELIVERED zero-fee no-tip order (real: `cmrwote7k…`) was
  invisible to the #4a ledger count, so the runner saw "2 deliveries" for 3 made. The summary's
  `deliveriesTotal`/`deliveriesToday` fields were REMOVED, not paralleled. Runner surface before →
  after: deliveries 2 → 3. *Promotion-ready for PROJECT_INVARIANTS' through-line table next
  session: the guard that holds it now exists (`scripts/runner-stats-source-guard.ts`).*
- **Ghost fix (`831e182`):** the completion module was the ONLY custody aggregate without
  `voidedAt: null` (audited; reconciler strand patterns and all money aggregates filter it). A
  voided order was scoring the active runner: rate 0.60 → **0.75** (4 collected / 3 delivered).
- **Delivery proves possession (`0121c44`, caught by the runner-boundary positive control):** the
  status route permits `RUNNER_COLLECTED → DELIVERED` on proofPath alone — no `collectedAt`
  precondition — so a tap-skipped delivery is legal and a tap-only count erased it. The denominator
  is now the union of tap-collected and delivered-assigned orders; the today-bucket falls back to
  `dispatchedAt`. Live numbers unchanged (every live delivery had a tap).
- **Decision A (settled): admin stats are THIS event only**, explicitly scoped — the scoping
  (`order.eventId`) lives inside the shared module so a future runner-facing per-fair caller reuses
  it; batch form `computeRunnerCompletionRates(ids, { eventId })`, one roster query (no N+1 at
  take=500).
- **Decision B (settled): floor = 5** (`RUNNER_COMPLETION_MIN_DENOMINATOR`, `lib/constants.ts`,
  beside the strand thresholds). Raw `delivered/collected` renders unconditionally; below the floor
  no percentage, no bar, no `<90%` banner — the cell reads "not enough deliveries". Reasoning: over
  N=1–4 one bad order is a 25–100-point swing on the screen where an admin decides who stays on the
  roster; 5 is where the banner becomes actionable during a real fair day. The route computes
  `scored` once (the one copy of the predicate). Today's real runner is 3/4 → unscored → honest.
- **The dead columns** (`Runner.totalCompleted`/`totalDispatched`/`completionRate`) are unread by
  all of `app/` + `lib/` (guard-enforced with a planted-fixture positive control), marked
  DEPRECATED in `schema.prisma` naming the real sources; the **drop migration is deferred** as a
  separate reviewed change. `scripts/screens-data-check.ts` keeps its select until the drop.
- Gate: **ALL 56 SUITES PASS** (55 → 56; new: `runner-stats-source`; new `runner` area in
  `AREA_SUITES`).

## Open items

1. ~~Human push~~ — **done** (pushed + deployed, fingerprint above). Nothing is waiting on a push.
2. **#1 Checkout Places autocomplete — Google Cloud console side ONLY.** The code path is complete
   and proven (`handlePlaceSelect` fills `deliveryCity` from the parsed `locality`; asserted by
   `scripts/delivery-address-guard.ts`). What remains is console work: Places API enablement, the
   key's HTTP-referrer + API restrictions, and billing. **No deploy is needed once the console is
   fixed** — and until it is, manual typing leaves `deliveryCity` null and the card renders just the
   street, which is now the intended degradation, not a bug.
3. **Railway-Redis migration** — unchanged and still the largest blocker: it gates the worker, and
   the worker gates every item on the pre-fair critical path.
4. ~~Dead runner counters on the admin surface~~ — **SHIPPED 2026-07-23** (see the batch block in
   the arc section: custody-derived stats, floor, deprecated columns, 56-suite gate). Two corrections
   to the original finding: there are **4** Runner rows, not 3 (one ACTIVE/APPROVED, two PENDING,
   one APPROVED/OFFLINE), and "the banner can never fire" was true of the column but not the derived
   rate — the active runner's real rate was 0.60 (0.75 after the ghost fix), so wiring without the
   floor would have fired it on day one. What remains of this item is only the **drop migration**
   for the three deprecated columns — a separate, separately-reviewed change (grep
   `DEPRECATED, write-dead` in `schema.prisma`).
5. **10 legacy orders still have `deliveryStreet === deliveryCity`** (re-measured this session — the
   same 10, so the write-path fix is holding and no new ones appeared). The historical rows were not
   backfilled; they will keep rendering the duplicated address on vendor cards. Decide: backfill
   `deliveryCity = NULL` for those 10, or leave them.

## Pre-fair critical path (ranked)

1. **Payout legs never exercised end-to-end** — still true, and the ledger says so plainly (measured
   this session): **RunnerEarning = 2 rows, both `tracked`, $23.00** — never `paid`;
   **OrganizerEarning = 2 rows, both `accrued`, with 0 `OrganizerPayout` rows** — no batch has ever
   been created. Only the vendor leg has real history (79 `paid` / $3,109.15, 8 `accrued`, 157
   `cancelled`). Needs runner + organizer Connect onboarding and one watched real checkout → accrual
   → payout. _Not started._
2. **Live Stripe verification** (webhooks, real transfers in test-then-live mode). _Not started._
3. **The books** (re-measured this session against the DB):
   - `refund_reversal` NegativeBalanceEvents: **46 events, $975.40** open. _Not classified._
   - `dispute_clawback` (Pattern K): **3 events, $101.96** open. _Alerting; chase, no auto-deduct._
   - `payoutStatus = FAILED`: **0** — confirmed still clear, so this is an obligation question, not a
     flag question.
   - Legacy never-paid obligation **~$135.78 (4 May-era orders)** — _(prior session, not
     re-measured)._
   - Context for triage: **56 orders sit at PLACED** and **44 at DELIVERED** (all 44 with
     `completedAt = null`, by design — see decision (a)).
4. **Sweep duration / admin-504 slow-creep** — the sweep is O(orders) and `verify-all` is a growing
   fixed cost: the registry is now **56 suites** (51 before the walkthrough batch, +4 there, +1 —
   `runner-stats-source` — in the admin runner-stats batch). The admin runners route stayed
   O(1 query) at take=500 via the batched completion form. _Watch-list, not now._
5. **Railway-Redis migration** — unblocks the worker, which gates items 1–3's live testing.
   _Pending._

## Deferred features and parked items

Carried forward; no evidence this session changed any of them.

- **Live map (5b)** — deferred, with locked constraints: Postgres server-relay (not Firebase RTDB for
  client reads), per-order-authorized polling, Wake Lock for phone-sleep, accuracy-radius/ETA (not a
  false-precise pin), go/no-go = a real phone walking around.
- **Test-Supabase / Redis split** — deferred; three accumulated reasons (suite flake,
  dev-as-money-actor against the prod DB, dev orders enqueuing into the shared prod worker queue).
  Note that `scripts/ready-lane-eviction-guard.ts` joins the set of suites that seed and clean up
  against prod.
- **Pattern W (profile-change retention purge)** — shipped but DORMANT: no event has ended 180 days
  ago, so it purges nothing yet.
- **PII phone-exposure decision** — recorded in `docs/PII_DECISIONS.md`: runner phone on the driver
  card is accepted for the known-runner small-fair context; relay/masking is the documented future
  path at scale.
- **Completion-rate v1 caveats** — spoiled-food return vs flaking, and second-runner credit (decision
  (b) above). Flagged in code, deliberately unsolved.
