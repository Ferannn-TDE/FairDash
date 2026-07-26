# FairSynq — Project Invariants

> **Durable architecture and invariants.** Does NOT contain current state — see a fresh
> `CURRENT_STATE.md` handoff for that. Every claim here should be true months from now; if one
> goes false, fix it in the same commit as the code change that falsified it.
>
> Citations are `file:line` as of the reading that produced this file. No commit hashes and no
> "currently" live here by design — those rot. If you find a claim without a citation, distrust it.

---

## What FairSynq is

A multi-sided event-commerce marketplace: **organizers** run fairs, **vendors** sell food at them,
**runners** deliver/curbside orders, **customers** buy. One codebase serves four portals plus an
admin console. Stack (verified in `package.json`): **Next.js `^16.2.6`** (App Router) + React `^18`,
**Prisma `^5.22` / PostgreSQL** on Supabase, **Stripe `^22` Connect** (per-org connected accounts) for
all money movement, **BullMQ `^5` + ioredis `^5` on RAILWAY Redis** for delayed jobs and the
reconcile sweep, **Firebase RTDB `^12`** for live order-status push, **Clerk** auth (`@clerk/nextjs ^7.3.3`
server, `@clerk/clerk-react ^5.60` SPA — two different context instances, kept separate). The web app
deploys to **Vercel**; the **worker** (`npm run worker` → `workers/index.ts`) deploys to **Railway**.

> ⚠️ **Upstash is NOT the queue.** It was, and the line above said so until 2026-07-25 — it is
> abandoned and quota-dead (`500000/500000`), where a bare `PING` answers while real commands fail,
> so it looks alive. It survives in exactly one place: `lib/ratelimit.ts:2,55` opens a **separate
> `@upstash/redis` REST connection** over `UPSTASH_REDIS_REST_URL`/`_TOKEN` — never `REDIS_URL`.
> Rate limiting and the queue have never shared a client. Named here because this is precisely the
> kind of stack line a reviewer repeats as fact without checking.

---

## The through-line — the codebase's central bug class

**Every place two copies of one derivation exist, one eventually lies.** This is not a tendency, it is
_the_ recurring defect here: a value computed in two places drifts, and the copy that isn't the money
source is the one that goes wrong. The fix shape is always the same — **collapse to a single source +
add a guard that fails if a second copy reappears.** Confirmed instances, each now single-sourced:

| Derivation | Single source (durable) | Guard |
|---|---|---|
| "orders incoming/active for a vendor" | `lib/vendor-order-history.ts:37` (`statusWhere`) + `:65` (`vendorOrderScope`) | `scripts/incoming-divergence-guard.ts` |
| the /active response shape | `lib/vendor-active-order.ts:52` (`VendorActiveOrder`) + `:74` (`toVendorActiveOrder`) | `scripts/active-shape-guard.ts` + `scripts/typecheck-gate.ts` |
| "is this order runner-fulfilled" | `lib/order-status.ts:90` (`isRunnerFulfilled`) | `scripts/vendor-vos-advance-guard.ts` |
| delivery-state wording (bar/line/timeline) | `lib/delivery-progress.ts:40` (`deriveDeliveryProgress`) | `scripts/delivery-progress-guard.ts` |
| runner earnings decomposition (share + tip) | `lib/runner-earnings.ts` (`summarizeRunnerEarnings`) | `scripts/runner-earnings-guard.ts` |
| terminal-failed status set (cancel-button, tabs) | `lib/order-status.ts` (`FAILED_STATUSES`) | `scripts/cancel-label-guard.ts` |
| admin money-audit writer | `lib/admin-money.ts:84` (`writeMoneyAudit`, "two-writers-one-truth trap") | `scripts/c1-admin-money-control-test.ts` |
| cross-fair resolution | `lib/admin-fair-context.ts` (`requireAdminFairContext`) | `scripts/p6-admin-fair-chokepoint-proof.ts` |
| plausible-but-wrong value flashed before load | (skeletons; no defaulted initial state) | `scripts/flicker-class-guard.ts` |
| order identity (cuid vs short code) | `lib/resolve-order.ts` | `scripts/resolve-order-guard.ts` |
| "which orders are in-model" (ghost/void filter) | `lib/order-scope.ts` | `scripts/organizer-ghost-guard.ts` |
| delivery address validation + formatting | `lib/delivery-address.ts` | `scripts/delivery-address-guard.ts` |
| fair CALENDAR dates + live/upcoming/ended state | `lib/event-date.ts:82` (`deriveEventLiveState`) | `scripts/fair-open-gate-guard.ts` |
| the six money-move sites (the set itself) | `scripts/money-move-sites-guard.ts` (`MONEY_MOVE_SITES`) | `scripts/money-move-sites-guard.ts` |
| comment-stripping before a guard scans | `_strip-comments.ts` (`stripComments`) | <!-- guard: none — the one definition exists and new guards import it, but FIVE legacy copies remain by design until the conversion job runs. A no-second-implementation assertion would fail today, so declaring this guarded would itself be the optimistic-doc drift this file exists to prevent. See the note below the table. --> **unguarded — declared, see below** |
| BullMQ queue namespace (producer + consumer) | `lib/queues.ts:58` (`getQueuePrefix`) | <!-- guard: none — the single source is real, but its INPUT is an env var spanning two deployments (Vercel producer, Railway consumer). A repo scanner cannot see config divergence. Operational check only: scripts/step-b-inspect.ts. --> **unguarded — declared, see below** |

**⚠️ `stripComments` is single-sourced in INTENT, not yet in FACT — declared unguarded above,
because the assertion is not landable today.** The idiom had drifted to **six copies in two
semantic variants**: `scripts/status-write-guard.ts`, `scripts/test-isolation-guard.ts` (regex form),
`scripts/live-badge-guard.ts`, `scripts/preview-bypass-guard.ts`, `scripts/fair-open-gate-guard.ts`
(line-filter form), plus an unnamed inline copy in `scripts/organizer-ghost-guard.ts`. That is this
codebase's central bug class occurring **inside the guards that exist to catch it** — and the two
variants are not equivalent: the line-filter form DELETES comment lines, shifting every offset and
line number after them, so a guard reporting `@ char N` would print coordinates that do not exist
in the real file. The regex form blanks the comment and preserves position, which is why it won.

`scripts/_strip-comments.ts` is now that one definition, and new guards import it
(`organizer-ghost-guard`, `sweep-summary-guard`, `money-move-sites-guard`, `x2-referral-ack-guard`).
**Five copies still exist by design** until the conversion job runs, so a
`no-second-implementation` assertion would fail today and **must not be added yet** — declaring it
guarded now would be exactly the drift-by-optimistic-doc this file exists to prevent. The entry is
listed as partial rather than omitted so the debt is visible and countable.

**The one derivation whose "single source" spans a boundary a guard cannot reach.**
`getQueuePrefix()` (`lib/queues.ts:58`) is genuinely single-sourced — all three construction sites
read it (`lib/queues.ts:157`, `workers/order-worker.ts:810`, `:854`) and none hardcodes a prefix. But
its **input is an environment variable**, and producer (Vercel) and consumer (Railway) are separate
deployments. `TEST_REDIS_PREFIX` set in one and not the other splits the namespace with **no error on
either side**: the producer enqueues happily, the worker listens elsewhere. **Three payout-breaking
bugs have come from this.** A repo-scanning guard cannot catch it — the divergence lives in config,
not code. The check is operational: after any Redis or deployment change, confirm
`<prefix>:<queue>:id` exists under the expected prefix (`scripts/step-b-inspect.ts`).

A companion class: **prose has no drift-guard.** UI copy, code comments, and docs describe behavior
the code no longer has, and a reviewer who reads the stale prose repeats it as fact (see _How we
work → prose_). Every _derivation_ here is guarded; _prose_ is not, so it is the residual leak.
**Landed again this session** on `lib/preview-access.ts`, whose header claimed the bypass was "a UI
unlock, not an authorization change" — on the very module you read to answer whether it gates order
placement. It does gate it (`app/api/orders/route.ts:190`). Fixed in the same commit as this note.

---

## Load-bearing invariants

Each is a rule that, if violated, silently loses money or leaks data.

- **Soft-delete money floor — money/audit INCLUDE archived fairs; customer-facing EXCLUDE them.**
  A fair can be archived (`Order`/`Event.archivedAt`, `schema.prisma:85`). The carve-out resolver
  gates on it: `lib/organizer-fair-context.ts:57` applies `archivedAt: null` by DEFAULT, and _only_
  the money-response paths pass `{ includeArchived: true }` (`:43`). **Protects:** refund/chargeback/
  payout routes staying reachable after a fair is archived — resolving a money path with
  `archivedAt: null` makes the record 404 exactly when money is at stake. Measured this session:
  4 files use `includeArchived` (INCLUDE side), 22 `archivedAt: null` occurrences (EXCLUDE side) —
  _the count drifts with routes; the PRINCIPLE is the invariant, not the number._ Proven by
  `scripts/p1-archived-money-safety-test.ts`.
  <!-- guard: scripts/p1-archived-money-safety-test.ts -->

- **Admin cross-fair chokepoint — exactly one unscoped Event resolve.** `requireAdminFairContext`
  (`lib/admin-fair-context.ts`) is the single place an admin resolves a fair without an ownership
  scope; every admin sub-route keys off the resolved `event.id`. **Protects:** an admin route
  inventing its own unscoped `event.findUnique` (a cross-tenant read hole). Enforced by
  `scripts/p6-admin-fair-chokepoint-proof.ts` (the grep invariant: the unscoped resolve exists in
  exactly one place).
  <!-- guard: scripts/p6-admin-fair-chokepoint-proof.ts -->

- **Money attribution — every admin money action writes an `AdminMoneyAction` in the same
  transaction, attributed to `adminClerkId`.** `lib/admin-money.ts:31` (audit in the same tx),
  `:84` (one shared `writeMoneyAudit`, not per-caller), `:108` (`adminAudit` always acts as the
  `ctx.adminClerkId` actor). **Protects:** untraceable money moves, and the organizer-refund route
  carrying admin authority — organizer money paths must attribute to the organizer, never borrow
  admin identity.
  <!-- guard: scripts/c1-admin-money-control-test.ts -->

- **Reconcile is a monotonic fixed-point.** `lib/reconcile-order-status.ts:46` (`MASTER_RANK`
  drives monotonicity — the aggregator only ADVANCES, rank must strictly increase); `:170` (a vendor
  terminal COMPLETED clamps to READY — the delivery arm decides the rest); `:194` (`canAdvance`);
  DELIVERED is set from the proof photo, not a vendor write. **`COMPLETED` and `DELIVERED` share
  rank 6 and are mutually exclusive by arm** (`:50`). **Protects:** a late/stale writer regressing a
  delivered order back to READY.
  <!-- guard: scripts/status-write-guard.ts -->

- **Accrual is VOS-independent.** Runner/organizer earnings accrue on the ORDER reaching DELIVERED
  with `runnerId` and a fee/tip — `lib/reconcile-order-status.ts:557` (the condition), `:575`
  (`runnerEarning.upsert`), `:581` (`organizerEarning.upsert`) — not on any VendorOrderStatus row.
  **Protects:** runner/organizer earnings being dropped because a vendor's VOS row is missing.
  <!-- guard: scripts/accrual-exclusion-guard.ts -->

  ⚠️ **VENDOR accrual is NOT VOS-independent — it is VOS-consulting but FAIL-OPEN.** *(Corrected
  2026-07-25; this bullet previously claimed all three legs ignored VOS, which would mislead
  anyone reasoning about a refunded portion.)* `accrueVendorEarnings` selects
  `vendorOrderStatuses` (`lib/process-payout.ts:147`) and filters through `payableVendorIds`
  (`:152`), so a `DECLINED`/`REFUNDED`/`CANCELLED` portion **deliberately accrues nothing** — the
  customer is getting that slice back, so no claim is owed. The exclusion is the point.
  What makes it safe is the *direction*: `payableVendorIds` (`:131-139`) builds an EXCLUSION set
  from the VOS rows that exist, so a **missing or lagging** row leaves the vendor **payable**.
  Absence never suppresses a claim; only an explicit non-payable status does.

- **Grandfather rule for status-gate migrations.** When a new approval gate ships, pre-existing rows
  are promoted so the gate applies only going forward:
  `prisma/migrations/20260712000000_add_runner_approval_status/migration.sql:17-22` (runners →
  `APPROVED`, `approvedBy = 'system-grandfather'`), mirrored for organizers at
  `20260714000000_add_organizer_approval_status/migration.sql:25-30`. **Protects:** a new gate
  locking out every existing user on deploy.
  <!-- guard: scripts/organizer-approval-gate-test.ts -->

- **Shared predicates are the single source (see the through-line table).** In addition to those:
  `payableVendorIds` (`lib/process-payout.ts:131`) + `NON_PAYABLE_VENDOR_STATUSES` (`:129`,
  `DECLINED/REFUNDED/CANCELLED`) is the one definition of who may be paid.
  <!-- guard: scripts/accrual-exclusion-guard.ts -->

---

## The money pipeline

**Accrual → three payout legs → refund/tip/clawback**, all keyed on lifecycle events and idempotent
by a durable DB flag (not by Stripe's expiring idempotency key alone).

- **Accrual** happens once, at DELIVERED (runner + organizer) and at COMPLETED/DELIVERED (vendor),
  idempotent via `@unique(orderId)` on the earning rows (`reconcile-order-status.ts:557`, `:463`).
  <!-- guard: scripts/accrual-exclusion-guard.ts -->
- **The three payout legs**, each a delayed transfer fired after the refund window, each with a
  **durable pre-check that refuses re-pay BEFORE Stripe** (the double-pay guard):
  - Vendor — `lib/process-payout.ts:59` (`classifyVendorSlice`, pure), `:68` (`paid → already_paid`).
  - Runner — `lib/runner-payout.ts:135` (`earning.status === 'paid' → already_paid`, before Stripe).
  - Organizer — `lib/organizer-payout.ts` batched per event; batch status guards (`:173`, `:183`) +
    `idempotencyKey = organizer_payout_${batch.id}` (`:137`).
  <!-- guard: scripts/test-double-pay-guard.ts -->
- **Refund / tip-refund / chargeback**, the other three money-move sites, each idempotent on a
  durable flag:
  - Refund — `lib/process-refund.ts:118` (already-fully-refunded check on `Refund` rows).
  - Tip-refund — `lib/tip-refund.ts:60` (`tipRefundId` set → `already_refunded`).
  - Chargeback — `lib/process-chargeback.ts` claws back every already-paid vendor proportionally via
    the shared `reverseVendorPayout` (`:20`), recording a `NegativeBalanceEvent(kind=dispute_clawback)`
    when balance is insufficient (`:9`).
  <!-- guard: scripts/b4-tip-refund-test.ts -->
- **The six money-move sites are exactly those six** (vendor/runner/organizer payout,
  refund/tip-refund/chargeback). **All six have a durable DB-state pre-check today** — the point of
  the double-pay fix was that the vendor slow-recovery path was relying on Stripe's idempotency key,
  which EXPIRES, so a late retry could double-pay; the fix moved the guard to the durable earning
  status (`classifyVendorSlice`, `process-payout.ts:52` documents this exact reasoning).
  The set is enumerated TWICE, independently, because neither enumeration is sufficient alone:
  by `stripe.transfers.create` (exactly three — the payout legs; blind to refunds, which move
  money without one) and by `logger.money` (catches a site of any shape; blind to a site that
  moves money and logs nothing, which [1] fails from the other side). The two are asserted to
  relate as `TRANSFER ⊂ MONEY_MOVE`, **not** as equals — and `|logger.money| ≥ |sites|`, since a
  REFUSAL to move money is also a money outcome (`runner-payout`'s `already_paid` logs before
  Stripe is called). Reversals (`lib/clawback.ts`) are a **parallel** named set, not a seventh
  site: clawback is a mechanism two of the six share, so counting it would double-count one
  movement of money.
  <!-- guard: scripts/money-move-sites-guard.ts -->
- **The reconciler is the backstop, never the primary.** `lib/reconciler.ts` runs lettered patterns
  each sweep; any repair means a real-time path leaked. Key money ones: Pattern C/D (unpaid-payout
  backstop, `:490`/`:537`), Pattern L (accrual-mismatch _alert_, `:836-846`), Pattern T
  (phantom-accrual reverser, `:81`), Pattern K (open dispute-debt alert, `:792`). Timer/alert
  patterns flag humans; they do not auto-move money.
  <!-- guard: none — a design principle about which path is PRIMARY, not a property of any one file. Not mechanisable as written; would need rewording into a checkable claim. -->

---

## The delivery / custody model

- **Claim ≠ collect.** A runner first CLAIMS (race-safe atomic flip setting `runnerId` +
  `dispatchedAt`, `app/api/orders/[id]/status/route.ts`), then physically COLLECTS
  (`collectedAt`, `lib/collect-order.ts`). The master enum name `RUNNER_COLLECTED`
  (`schema.prisma`, "Runner confirmed pickup from vendor booth") is a **misnomer — it is set at
  CLAIM, before collection.** The authoritative signal is the column, documented at
  `schema.prisma:499-500`: `collectedAt NULL` = claimed, food still on the vendor's counter;
  `collectedAt SET` = the runner physically has the bag. A deferred cleanup note lives at
  `reconcile-order-status.ts:542` (DELIVERED accrual is still a proxy for collection).
  <!-- guard: scripts/test-collect-guard.ts -->
- **The escape path (reversible custody).** Pre-collection, the runner RELEASES back to the pool
  (`lib/release-order.ts`, gated on `collectedAt IS NULL`); post-collection, the runner REQUESTS a
  return (`lib/request-return.ts`) and the VENDOR confirms it (`lib/confirm-return.ts`), which resets
  the order to a fresh READY. Each transition is one atomic conditional update + one custody event in
  one transaction.
  <!-- guard: scripts/test-release-guard.ts -->
- **Custody events are the audit spine.** `DeliveryCustodyEvent` records `claimed` / `collected` /
  `released` / `return_requested` / `return_confirmed` / `stranded` / `strand_cleared`, append-only,
  in the same transaction as the column write.
  <!-- guard: scripts/vehicle-snapshot-guard.ts -->
- **Vehicle snapshot — two truths, one transaction.** At claim, the runner's vehicle is snapshotted
  onto `Order.runnerVehicle{Make,Color,Plate}` (display, cleared on release/return) AND into the
  `'claimed'` custody-event metadata (append-only, never cleared), so a returned order never loses
  which car took it. (`app/api/orders/[id]/status/route.ts` claim transaction.)
  <!-- guard: scripts/vehicle-snapshot-guard.ts -->
- **Strand clocks are flag-only and action-named.** After a threshold
  (`lib/constants.ts:142`, e.g. `claimedNotCollected: 15min`), reconciler Pattern V FLAGS the order
  for a human (`constants.ts:131` — "flag only, never [acts]"); the reason is named for the human
  action to take (`STRAND_ACTION`, `reconciler.ts:1366`). **Clearing resets, it does not immunize:**
  a legitimate action clears the flag (+ a `strand_cleared` event, `reconciler.ts:1332`/`:1399`), and
  the next sweep re-evaluates from scratch — if the condition recurs, it re-flags.
  <!-- guard: scripts/test-strand-guard.ts -->

---

## How we work — disciplines (each caught a real bug)

- **Analyze-first: diagnose with evidence before touching code.** Reports cite `file:line`; a wrong
  "fact" is worse than none because it auto-loads into future reviews.
- **The browser is the only real test for UI/live behavior.** Guards prove _logic_; they do not prove
  a Google Places widget fires or a phone renders — those need a real device. (The live-map arc is
  explicitly gated on a real-phone walk, not a desktop tab.)
- **Positive controls + specific error codes.** A negative test needs a `[0]` baseline and a positive
  twin or it passes vacuously (e.g. `scripts/test-collect-guard.ts` `[0]`); a refusal asserts the
  NAMED outcome, not just "didn't succeed" (e.g. `ORDER_VOIDED` 409 across the custody routes,
  `scripts/test-ghost-guard.ts`).
- **A guard-on-a-predicate needs its inputs proven present.** The vacuous-gate class: a UI gate that
  reads a field the endpoint didn't return is silently off. Fixed by the typed contract
  (`lib/vendor-active-order.ts`) + `scripts/typecheck-gate.ts`.
- **Timers flag; humans decide.** No clock auto-moves money (strand clocks, Pattern K/L are alerts).
- **Fix the class, not the instance; prove the antecedent.** When a bug is the Nth of a kind, the fix
  is a single-source + a guard, and the guard asserts the _cause_ is structurally impossible.
- **Prose has no drift-guard.** When a surface explains a number, COMPUTE the explanation from the
  same math; when a fix lands, grep for stale prose (comments/copy/docs) in the same commit.
- **Verify deploys by content fingerprint, not logs.** `/api/health` returns a build `commit` field
  baked at build time and a worker heartbeat; a served response's shape is the fingerprint
  (`app/api/health/route.ts`, `lib/health.ts`).
- **fingerprint-over-git-ref.** The served `/api/health` `commit` is the authority on what is
  deployed — the local `origin/main` ref has been wrong **twice**. Reconcile against the served
  value, never the ref.
- **custody-for-counts / ledger-for-money.** Two spines answering different questions:
  `lib/runner-completion.ts` owns delivery counts and completion, `lib/runner-earnings.ts` owns
  money. They are never averaged into one number — the ledger-derived count under-reports (a
  DELIVERED zero-fee order accrues nothing), so count fields were **removed** from the earnings
  summary rather than paralleled. Guarded.
- **named-sets-over-counts.** `4 money routes found (5)` says something changed; a **named set**
  says *what*, and fails with the offending path. Applies to reports as much as to guards — a
  candidate count is not a finding until its members are enumerated.
- **guards-scan-code-not-prose.** Three guards failed on their own explanatory comments. Strip
  comments before scanning, or the reasoning gets deleted to keep the suite green — which is the
  guard destroying the thing it exists to protect.
- **guards-match-shape-not-names-or-locations.** A guard keyed on `startDate`/`endDate` missed an
  aliased copy; one keyed on a filename broke when the code improved. Shape-keyed scanners caught
  two queries that careful manual passes had missed.
- **test-the-artifact-not-a-reconstruction.** A hand-made snippet compiled with `tsc` "proved" a JSX
  space that SWC actually stripped. Read the built bundle, not a model of it.
- **"Newest" needs null handling, or it answers about the wrong rows.** Postgres sorts `DESC` as
  **NULLS FIRST**, so `orderBy: { completedAt: 'desc' }` returns a NULL row first. That produced a
  confident, wrong conclusion this session — that the Pattern C/S unpaid-payout backstop was
  *structurally dead* — when in fact 133 of 136 rows had the timestamp set. Same family as the
  vacuous zero: a query shape that returns something true-looking **about rows you did not mean to
  ask about**. When a max/min drives a conclusion, filter the null explicitly or state the ordering.
- **constructed-is-not-used: a side effect the constructor makes unconditionally is not evidence the
  thing was exercised.** BullMQ's `Queue` constructor `hmset`s `<prefix>:<queue>:meta` on
  instantiation and **swallows the error** (`bullmq/dist/cjs/classes/queue.js:45-53`), while
  `<prefix>:<queue>:id` increments only inside the add\* Lua on a successful `add()`
  (`bullmq/dist/cjs/scripts/addDelayedJob-6.js:541`). So `meta` proves **constructed**; `:id` proves
  **used**. Reading the first as the second points at a producer defect that does not exist. Holds
  for any external system: separate "we opened a handle" from "we did the thing".
- **Agents never push.** An automated session commits and merges locally; a human pushes (the deploy
  trigger).

---

## Things that look like bugs but aren't

- **Slugs are frozen on rename — fairs as well as vendors.** `Vendor.slug` is set at creation and
  intentionally NOT regenerated when the name changes (`schema.prisma:221`) — a live link stays
  stable. `Event.urlSlug` follows the same rule: assigned once by `uniqueEventSlug`
  (`app/api/organizer/fairs/route.ts:139`) and deliberately excluded from the settings PATCH
  (`app/api/admin/events/[id]/settings/route.ts:20` names the exclusion). So a fair renamed
  Springfield State Fair 2026 → **Italian Fest 2026** keeps `springfield-state-fair-2026` in its
  URL, and the admin money page shows the new name against the old slug. That is the design, not a
  resolution bug: `requireAdminFairContext` resolved correctly in both directions. Expect this to
  read as a mismatch on first sight — it has fooled at least one careful reader.
  <!-- guard: none — vendor-slug-per-fair-test proves per-fair UNIQUENESS, not FREEZING on rename. Nothing asserts that a rename leaves Vendor.slug / Event.urlSlug untouched. Guardable, not yet guarded. -->
- **An order drops off the vendor's board at DELIVERED.** On DELIVERED the vendor's VOS advances
  READY→COMPLETED (`reconcile-order-status.ts:523-531`) and the order leaves the active lanes — the
  vendor's work is done; it is not lost.
  <!-- guard: scripts/vendor-vos-advance-guard.ts -->
- **Curbside `CUSTOMER_WALKS` is vendor-completed, not runner-fulfilled.** `isRunnerFulfilled`
  (`lib/order-status.ts:90`) is true only for `HOME_DELIVERY` or `CURBSIDE + RUNNER_DELIVERS`; a
  customer-walks curbside order has no runner leg and no runner fee — that is correct.
  <!-- guard: scripts/vendor-vos-advance-guard.ts -->
- **`/api/health` reporting `redis: error` / `worker: stale` is the endpoint WORKING.** It returns
  200 healthy / 503 degraded (`app/api/health/route.ts:24`); when the worker is off it honestly
  reports a stale heartbeat (`lib/health.ts:19`, `WORKER_STALE_SEC = 180`). That is the design
  ("a dead worker looks like a calm day" — closed), not a new failure.
  <!-- guard: scripts/test-health-guard.ts -->

---

## The test / guard system

- **`scripts/verify-all.ts` is the gate.** The registry there is the count; this doc deliberately
  does not carry one (it said "~53" while the gate ran 72 — counts rot by design, and
  **named-sets-over-counts** applies to this file as much as to any guard). Judged by EXIT CODE,
  never by grepping output.
  Tiered: no args = full batch gate; `--for <area>` = the touched-area unit gate
  (`AREA_SUITES`, `:100`); `--group <g>` = one group.
- **A typecheck suite runs `tsc --noEmit` inside the gate** (`scripts/typecheck-gate.ts`, registered
  at `verify-all.ts:79`) — because the tsx runner strips types unchecked, so a broken compile-time
  contract would otherwise pass every suite and die at deploy.
- **The infra-flake retry retries a failed suite ONCE after a 2s pause** (`verify-all.ts:174`,
  `Atomics.wait ... 2000`). A pass-on-retry stays green but prints the first run's evidence and a
  persistent `⚠️ FLAKY` line (`:183`, `:204`) — it never silently greens; a twice-failure is "FAILED
  twice — not a flake."
- **Standing guard classes:** the flicker-class guard (`scripts/flicker-class-guard.ts`, no
  plausible-default initial state), the vacuity discipline (positive controls + named error codes),
  and per-area money/boundary/correctness suites. A false green in a boundary or money suite is the
  dangerous kind, so those assert the _cause_, not the symptom.
