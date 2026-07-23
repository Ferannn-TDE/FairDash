# FairSynq — Current State

> **Volatile. Regenerate before trusting** — run `git log --oneline main -8` and `git branch -v`
> first and reconcile. Do NOT copy anything from this file into `PROJECT_INVARIANTS.md`. This file
> is throwaway: paste it into a working session, never into persistent project knowledge.
>
> Snapshot taken: `main @ 216e8ba` (deployed: `8180b69`), 2026-07-23 after the order-id / live-badge
> / order-log batch. Numbers below were measured against the live DB on the session that wrote them
> unless marked otherwise.

---

## Git / deploy reality

- **`main` head: `b694b1e`** — "Merge: walkthrough batch 2 — address, Ready-lane, delivered timeline,
  runner stats (4a–4d)".
- **Deployed: `8180b69`** — fingerprint-confirmed 2026-07-23 (`/api/health` → `"commit":
  "8180b699…"`). The human pushed the CURRENT_STATE regeneration + the whole admin runner-stats
  batch since the last snapshot; **prod now has custody-derived runner stats, the floor, and the
  ghost fix.** Note the local `origin/main` ref still reads `b694b1e` — this shell cannot fetch
  (no SSH key), so the served fingerprint is the authority, not the ref.
- **Unpushed: 22 local commits** — walkthrough batch 3, the checkout address fix, the
  dates/admin-surfaces batch, and this order-id/live-badge/order-log batch (`3d7d2be` resolveOrder,
  `8ff5deb` order-log server search, `e04074b` live-badge from dates, `0548fc2` health flag,
  `216e8ba` vendor-portal live-state, + docs). **The checkout fix (`7f6ea31`) is still the urgent
  one: home-delivery checkout is broken in the deployed build** until these ship. 13 days to the
  fair (Aug 5). Prod `/api/health` shows no `flags` field, confirming none of these 22 are live.
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

### Shipped 2026-07-23 — order-id / live-badge / order-log batch

- **The cancel 404 — one `resolveOrder()`** (`3d7d2be`). `GET /orders/[id]` tolerated the 8-char
  short code; cancel/status/the four custody libs did `findUnique` by primary key, so the order
  page (loaded via the tolerant GET) PATCHed the short code to cancel → 404. `lib/resolve-order.ts`
  is the single tolerant+**unambiguous** resolver (`take: 2` + throw on a short-code collision,
  never picks one; DB measured: 377 orders, 377 distinct tails, zero collisions). All 8 sites
  routed through it; cancel now keys its refunds/upserts/reconcile on the canonical `order.id`.
  Every named refusal preserved (ghost-guard 22/22). `resolve-order-guard` (40). **ONLY the 404
  is fixed — see the still-open 409 below.** Same-class-but-untouched (no short code reaches them):
  organizer/admin refund routes + `runner-payout`/`tip-refund` (canonical ids).
- **Order log searches the whole fair** (`8ff5deb`). Search/filter were client-side over the
  capped 100 rows, so a code read aloud from two days ago returned empty and rendered "no order
  found". Now server-side in `lib/fair-orders`: search matches id (short code = lowercased tail),
  customer, phone, vendor — verified `26685PS7` → `total 1` of 377. Real `total` via `count()`
  ("Showing 100 of 377"), "Load older" via `nextCursor`, server-side vendor/type/sort, and an empty
  state that says "No order matches '…'" (whole-event answer) vs "No orders yet". **Removed the
  dead "Refunded" tab** — REFUNDED is not a master `OrderStatus`, so it was always empty; replaced
  with "Issues". `order-log-search-guard` (19).
- **"Live Now" derives from dates** (`e04074b`, `216e8ba`). `StatusBadge` mapped
  `status === 'ACTIVE'` → "Live Now" and the fair hero hardcoded it, so the landing page announced
  an Aug-5 fair live on Jul 23. `deriveEventLiveState` (in `lib/event-date`, calendar-date /
  zone-fixed like item 2) is the one derivation: before→upcoming, within→live (inclusive),
  after→ended; enablement gates (a paused fair is never live). Brought onto it: StatusBadge, fair
  card, fair-info, the fair detail hero, AND the vendor portal's Live/Upcoming split
  (`normalizeFairStatus` retired). Proven today→upcoming, Aug 8→live, Aug 13→ended.
  `live-badge-guard` (16).
- **Health surfaces `enforceVendorReadiness`** (`0548fc2`) — the effective flag is now in
  `/api/health` (`flags.enforceVendorReadiness`), so local/prod drift on a customer-facing filter
  is one `curl` away. Local shows `true`; prod shows the field absent until deployed.
- Gate: **ALL 60 SUITES PASS** (57 → 60). Verified with a real `next build` (dynamic routes).

### Shipped 2026-07-23 — dates + admin surfaces batch

- **Fair dates rendered one day early, everywhere** (`d6fccfd`). `Event.startDate` is a
  UTC-midnight instant CARRYING a calendar date; eight surfaces hand-formatted it with
  `toLocaleDateString` in the viewer's zone, so America/Chicago showed Aug 4–11 for a fair stored
  Aug 5–12. **Stored data is correct — nothing migrated** (the admin round-trip already writes
  `new Date('2026-08-05')` and reads back `toISOString().slice(0,10)`). `lib/event-date.ts` is now
  the one zone-fixed formatter; eight per-surface copies deleted. The distinction it holds: a fair
  date is a CALENDAR DATE (same for every viewer), an order's `placedAt` is an INSTANT (renders in
  the viewer's clock) — `event-date-guard` (14 checks) asserts both directions, so over-applying
  the fix is caught too. Suite count 56 → **57**.
- **"Pendingamounts"** (`97ffe05`) — **I was wrong to close this as a stale bundle.** The source
  line does contain a space, but Next builds with SWC, which strips the leading whitespace of a
  JSXText node spanning a newline; the built chunk emitted `"Pending"` then `"amounts transfer…"`.
  My previous "verification" compiled a hand-made snippet with `tsc`, which keeps that space — a
  reconstruction, not the artifact. Fixed with explicit `{' '}` on both spans and re-verified
  against the rebuilt chunk. **Rule worth keeping: for rendered output, the built artifact is the
  evidence.**
- **Admin vendors page** (`bc4a9ad`) — reorganised around "can this vendor take money on day one":
  readiness cluster primary (Stripe · Live · Permit · Insurance, all four always listed), revenue
  secondary and dimmed at $0, approval last. Missing vs present no longer relies on colour (filled
  dot vs hollow ring + title text). Summary line uses the server's shared `ready` predicate.
- **Admin order log** (`827a700`) — day grouping with sticky headers, age badge on active rows
  (threshold read from `STRAND_THRESHOLDS_MS.claimedNotCollected`, colour only — never acts),
  vendor + fulfillment filters, and filter/search/sort state in the URL. Header no longer implies
  a total (see open item 6). Verified with a real `next build`.

### Shipped 2026-07-23 — browser-walkthrough batch 3 (admin UI)

- **The slug flash (flicker class, 7th instance).** `AdminShell.tsx` rendered
  `fair?.name ?? slug` in the sidebar's per-fair header, so every admin load flashed the slug —
  `springfield-state-fair-2026`, uppercased by the button's own CSS — before settling to the real
  name, "Italian Fest 2026" (the two diverged long ago; slugs are frozen at creation by design).
  Now: `event.name` or nothing — skeleton while `/api/admin/fairs` is in flight, explicit
  "Unknown fair" once loaded without a match (a `fairsLoaded` flag keeps those two states
  distinct). Two diagnosis corrections: **nothing title-cases a slug anywhere in the repo**, and
  **no mock data reaches the admin console** — the only "Springfield State Fair" literals are in
  `lib/mock/{organizer,runner}.ts`, which admin does not import. Worth noting the rule was already
  written down at `app/admin/[eventSlug]/dashboard/page.tsx:348-350` and simply not followed by
  the sidebar. `flicker-class-guard [E]` now scans for a display name assigned from a slug, with
  the positive control asserted first (17/17).
- **Admin runners row restyle** — one stats block (count primary, rate secondary, mirroring the
  floor decision), pending rows subordinated (they already appear in the approval queue above),
  status badge last with a state dot. The two "— unnamed —" rows are genuinely null `User.name`
  (verified against the DB; the route does select it), so the email is now the identity line with
  an explicit "no name on file". No derivation, floor constant, or banner predicate touched.
- **Two reported items were NOT bugs** (repo wins, nothing changed): the runners table renders
  exactly **one** ratio app-wide (`runners/page.tsx`, grep-confirmed) — the "duplicate count" was
  the cramped two-block layout, fixed by the restyle; and the runner earnings banner's
  `Pending amounts` space is **present in source and preserved through JSX compilation** (checked
  by compiling the snippet), identical in the deployed commit, with zero `</span>[A-Za-z]`
  occurrences anywhere in `app/`. If the missing space is still visible in a browser, it is a
  stale bundle, not the source.

## Open items

0. **🟡 HOME_DELIVERY checkout — FIXED locally (`7f6ea31`), still broken in the deployed build.**
   Ships on the next push; until then every manual-entry home-delivery checkout 400s in prod.
   - **What it was:** `app/api/orders/route.ts` required a truthy `deliveryCity`; the #2 fix
     stopped fabricating one (`checkout/page.tsx`, `|| null`); the form had **no city input**
     and client `validate()` checked only the street — an unclearable dead end. The Places
     parser was never the problem: it exists, is correct, requests `address_components`, and had
     simply **never run** (billing off → no suggestion to select → `parsed_ok = 0` across all 10
     home-delivery rows).
   - **What shipped (decision (a)):** `lib/delivery-address.ts` is now the ONE definition —
     `validateDeliveryAddress` (required street/city/zip, field-named errors, zip format) called
     by **both** the form and the route, so the form cannot build a payload the route rejects;
     `formatDeliveryAddress` replacing **five** hand-joined address renders. Real city/state/zip
     inputs that autocomplete fills and the customer can correct, plus an **apartment/suite/room**
     line (new `Order.deliveryUnit` column — `address_components` has no unit type, so a dorm
     delivery was a building with no door). `deliveryZip || '00000'` is **gone** — the same
     fabrication class as the street→city copy, one field over. Additive migration
     `20260723000000_delivery_address_state_unit`, applied via `npm run migrate`; nothing
     backfilled (the `completedAt` precedent).
   - **Found while plumbing:** `lib/vendor-order-history`'s select never carried the address,
     while the vendor orders page rendered `{deliveryStreet}, {deliveryCity}` — every
     HOME_DELIVERY row printed "undefined, undefined". Pre-existing partial-rows bug, fixed.
   - **Guard:** `delivery-address-guard` 3 → **32** checks (positive controls first; no
     fabricated default; both callers on one rule; an input for every required field; no
     hand-joined address on any of the five surfaces).
   - **⚠️ BROWSER VERIFICATION NOT DONE — it is the only real test and it is outstanding.** No
     browser automation was available this session, and the Places key is (correctly)
     HTTP-referrer restricted, so it cannot be queried server-side either. **Unanswered and
     load-bearing: does Places return "417 Cougar Village" at all?** If it does not, manual entry
     is the PRIMARY path for this venue, not a fallback, and that form deserves more polish before
     the gates open. Manual test script is in the session notes; run it on localhost (the fix is
     not deployed yet).
0a. **🟠 CANCEL 409 — STILL UNEXPLAINED (only the 404 is fixed).** `3d7d2be` fixed the 404
   (short-code resolution). The reported 409 remains open: cancel's only 409 is the voided refusal
   (`CANCEL_NOT_ALLOWED`), and order `26685PS7` (`cmrxn8bhq0002go5826685ps7`) is **PLACED, not
   voided** — so that path can't produce it. New: the ambiguous-short-code path now also returns a
   409 (`AMBIGUOUS_ORDER_CODE`), but there are zero collisions in the DB, so that isn't it either.
   Needs the Network evidence (method + URL + response body of the 409 request) before any theory.
   Do not build for it until captured.

0b. **🔴 VENDOR STRIPE ONBOARDING — the longest-lead pre-fair item, measured 2026-07-23.**
   Of **20 vendors on Italian Fest 2026: 3 have any Stripe Connect account** (`stripeAccountId`),
   and the same **3 are `stripeVerified`** — ALL PRO TEES, Feran Eats, RANDY'S HOUSE OF BBQ.
   **17 are approved (ACTIVE); 14 of those cannot receive a payout.** 17 have menu items, so
   Stripe is the blocker, not the menu. **What a Stripe-less order does (traced in code):** with
   enforcement OFF (prod), the order backstop (`app/api/orders/route.ts:232`) is skipped, so
   checkout COMPLETES — the customer pays the platform account and the `VendorEarning` accrues at
   COMPLETED/DELIVERED (accrual is Stripe-independent). At payout, `classifyVendorSlice`
   (`lib/process-payout.ts:74`) sees `connected=false` → outcome **`hold`** (reason `unconnected`):
   the slice enters a "waiting room", not lost. **Pattern D** (`lib/reconciler.ts:518-521`,
   `vendor: { stripeVerified: true, stripeAccountId: not null, payoutsFrozenAt: null }`) drains it
   when the vendor connects later — so a vendor who connects AFTER accruing DOES get paid **by
   design**. **⚠️ Has this ever been exercised? NO.** The worker is OFF (Redis quota), so no
   sweep runs in prod — Pattern D has never fired, and no vendor has connected-after-accruing to
   test it. Right now NO vendor payout happens at all (even the 3 connected), because the worker is
   down. This is the assumption the current prod setting rests on, unverified end-to-end.
   **Other people's onboarding + the worker — 13 days.**

0c. **🟠 READINESS ENFORCEMENT DIVERGES BETWEEN LOCAL AND PROD — now VISIBLE.** `.env.local` sets
   `ENFORCE_VENDOR_READINESS=true`; **prod does not** — `GET /api/fairs` returns `vendorCount=17`
   while the same query locally returns **2** (`readyVendorWhere` = ACTIVE + stripeVerified + ≥1
   available menu item). So the public site lists 17 vendors, 15 of whom cannot take an order
   end-to-end. **Which number should a customer see: 2.** The flag is read at
   `lib/vendor-readiness.ts:49` and spread into the marketplace list, the fairs vendorCount badge,
   vendor detail + menu, event/menu queries, and the order backstop. `0548fc2` surfaced the
   effective value at `/api/health` → `flags.enforceVendorReadiness`, so the drift is no longer
   invisible (local=true, prod=absent until the batch ships). **NOT flipped** — that is a business
   decision (the public list drops to 2 until vendors connect); the visibility was the fix.

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
5. **The 10 legacy address rows — classified 2026-07-23, do NOT backfill.** All 10 carry
   `street === city` AND `zip = '00000'`. Provenance: **9 of 10 belong to
   `feranodedairo@gmail.com` and 1 to `feranmidyro@gmail.com`** — both the operator's own
   accounts, all on Italian Fest 2026. **There is no third-party customer address in the DB, so
   nothing undeliverable belongs to a real customer.** 2 are voided; by status: 2 PLACED,
   2 DELIVERED, 3 CANCELLED, 1 RUNNER_COLLECTED, 1 READY, 1 UNDELIVERABLE. Left as-is on the
   `completedAt` precedent — an invented city/zip is worse than an honest wrong one, and these
   rows are the evidence of what the write path used to do. (Superseded the old wording of this
   item, which only counted them.)

6. ~~Admin order log truncates at 100~~ — **BUILT (`8ff5deb`).** Server-side search over the whole
   event, real `count()` total ("Showing 100 of 377"), "Load older" via `nextCursor`, server-side
   vendor/type/sort, and an empty state that distinguishes no-results from not-loaded. The dead
   "Refunded" tab (REFUNDED is not a master status) became "Issues". `order-log-search-guard`.

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
