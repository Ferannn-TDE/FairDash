# FAILED-marker taxonomy audit — Phase 1

**Date:** 2026-07-24 · **Head:** `33cad88` · **No code changed, no rows written.**

> **The premise is partially wrong, and the code wins.** The prompt states "no FAILED marker is
> written, so a payout that *cannot* succeed is indistinguishable from one that has not run yet."
> That is true only for the **retry window** and for the **ledger-drift halt path**. For the
> exhausted-retry path there **is** a durable marker for all three payee types
> (`workers/order-worker.ts:824-844`, `recordPayoutFailure` `:668-718`). The real reason
> `payoutStatus=FAILED 0` is vacuous is narrower and stated in §1.3.

---

## 1.1 Named set — every write site of a failed money state

| # | Site | Model / field | Condition that reaches it |
|---|------|---------------|---------------------------|
| A | `workers/order-worker.ts:838-840` | `Order.payoutStatus = 'FAILED'` | `worker.on('failed')`, `exhausted && job.name === JOB_VENDOR_PAYOUT` (`:828`, `:835`) |
| B | `workers/order-worker.ts:676` | `RunnerEarning.status = 'failed'` | inside `recordPayoutFailure`, `JOB_RUNNER_PAYOUT`, earning not already `paid`/`failed` |
| C | `workers/order-worker.ts:692` | `OrganizerPayout.status = 'failed'` | inside `recordPayoutFailure`, `JOB_ORGANIZER_PAYOUT`, latest non-paid batch |
| D | `lib/process-refund.ts:247` | `RefundRequest.status = 'FAILED'` (refund path, not a payout) | refund engine failure |
| E | `lib/process-refund.ts:274` | `Refund.status = 'FAILED', stripeRefundId` | Stripe refund returned a non-success status |

`recordPayoutFailure` (`:668-718`) is the **single funnel** for A/B/C and also writes a
`PAYOUT_FAILED` money-audit for all three (`:679`, `:696`, `:706`) attributed to a
`system` actor `worker:<job>:<id>` — the failed-since timestamp Pattern U reads (the enum/status
columns carry no `updatedAt`). There is **no `VendorEarning` failure state** — the vendor durable
marker lives on `Order.payoutStatus`, not on the earning row (A vs B/C is an asymmetry, see §1.3).

`PayoutStatus` enum = `PENDING | COMPLETED | FAILED` (`schema.prisma:640-644`). `FAILED` =
"All retry attempts exhausted — requires manual intervention."

---

## 1.2 Named set — which error classes reach each write site

### Throw sites
- **`PayoutReconciliationError`** (ledger drift / money-identity break): `process-payout.ts:258`,
  `:351`; `runner-payout.ts:225`; `organizer-payout.ts:231`. Class at `process-payout.ts:78`.
- **`PayoutNotSettledError`** (genuinely transient — no charge yet / balance-txn not settled):
  `process-payout.ts:227`, `:234`; `runner-payout.ts:240`. Class at `process-payout.ts:86`.
- **Raw Stripe / everything else** (network, rate-limit, **and `resource_missing` on
  `destination`**): thrown from `stripe.transfers.create` (`process-payout.ts:406`, and the runner
  / organizer equivalents) — **not caught at the call site.**

### The three payout handlers' catch branches (identical shape)
`handleVendorPayout` (`:546-554`), `handleRunnerPayout` (`:576-584`), `handleOrganizerPayout`
(`:611-616`):

```
catch (err) {
  if (err instanceof PayoutReconciliationError) → throw new UnrecoverableError(err.message)  // halt
  throw err                                                                                  // retry
}
```

### The six money-move sites, by error class

"Six money-move sites" per `PROJECT_INVARIANTS.md` = vendor / runner / organizer payout +
refund / tip-refund / chargeback. Payout-transfer failures land as:

| Error at a payout site | Branch | BullMQ effect | Ends at a marker? |
|---|---|---|---|
| **Unrecoverable Stripe** (`resource_missing` destination, revoked/ deauthorized account) | `throw err` (**not** a `PayoutReconciliationError`) | retried **3×** (exp backoff, `queue-safe.ts:50-51`), then failed | **Yes — but only after 3 wasted attempts** → `exhausted` true → A/B/C |
| **Transient** (network, rate-limit, `PayoutNotSettledError`) | `throw err` | retried 3×, then failed | Yes, same path |
| **Ledger drift** (`PayoutReconciliationError`) | `UnrecoverableError` | job fails **immediately**, no retry | **⚠️ see the gap below** |

**They land in the same branch.** Unrecoverable-Stripe and transient are **indistinguishable** to
this code: both hit `throw err`, both burn all 3 retries. There is **no fast-fail** that says
"this destination will never resolve, stop retrying" — a dangling-account transfer (the live-key
scenario) costs 3 attempts + backoff before it is marked, exactly as a flaky network blip would.

### ⚠️ Potential gap in the `exhausted` gate (flagged, needs runtime verification)

`worker.on('failed')` gates the marker on `exhausted = job.attemptsMade >= (job.opts.attempts ??
3)` (`:828`). A `PayoutReconciliationError` becomes an `UnrecoverableError`, which makes BullMQ
fail the job **without exhausting `attempts`**. If `attemptsMade < 3` at that moment, `exhausted`
is **false** and both the vendor `payoutStatus='FAILED'` write (`:835-840`) **and**
`recordPayoutFailure` (`:843`) are **skipped** — so the **loudest, most-serious failure class
(ledger drift) would produce NO durable marker**, only a log line that scrolls away.

~~I **cannot confirm** this from the code alone~~ — **CONFIRMED REAL, 2026-07-25.** Resolved by
reading the installed BullMQ (`5.76.8`) rather than by running the worker, so it needed no live
job:

- `job.js:483 shouldRetryJob()` — returns `[false, 0]` immediately when
  `err instanceof UnrecoverableError`, **without touching `attemptsMade`**.
- `job.js:549` — `this.attemptsMade += 1` runs once on the non-retry branch.

So a `PayoutReconciliationError` on the first attempt reaches `worker.on('failed')` with
`attemptsMade = 1` against `opts.attempts = 3` (`lib/queue-safe.ts:50`). The gate at
`workers/order-worker.ts:869` computes `exhausted = 1 >= 3` → **false**, and `:872` returns early:
**both the vendor `payoutStatus='FAILED'` write and `recordPayoutFailure` are skipped.**

**The inversion is real, and it is the wrong way round.** Transient blips and dead Stripe accounts
get durable markers (after burning 3 attempts); the deterministic money-correctness halt — ledger
drift, the loudest failure this system can produce — gets a log line that scrolls away and no row
anywhere. Pattern U reads the `PAYOUT_FAILED` audit for its failed-since timestamp, so a
ledger-drift halt is invisible to the stuck-money reader too.

**This has never fired in prod** — not because it is safe, but because the runner/organizer legs
had never executed when this was written. The worker is now LIVE (`CURRENT_STATE §2`, heartbeat
green), so the path is reachable for the first time. **Fix before the fair.**

The fix is still one line, and the fix is the gate, not the throw site: `recordPayoutFailure` must
run for any payout job whose failure is final — `exhausted || err instanceof UnrecoverableError` —
rather than on attempt-count alone, which silently assumes every terminal failure exhausts retries.

---

## 1.3 The verdict

**`payoutStatus = FAILED 0` is a vacuous zero — but not for the reason the premise gives.**

- The premise ("no marker is ever written") is **false**: the exhausted-retry path writes durable
  markers for all three payee types (§1.1 A/B/C).
- The **actual** reason the zero means nothing: **the worker is OFF and the runner/organizer
  payout legs have never executed once** (`CURRENT_STATE §3`: RunnerEarning 2×`tracked` never
  paid, OrganizerPayout **0 rows**). No payout job has ever reached the failed handler, so no
  marker has ever been written **by any path**. `FAILED 0` is "the marking machinery has never
  run", not "no payout failed."
- **How many of the six sites can write a failure marker at all:**
  - **Vendor payout** — yes (`Order.payoutStatus='FAILED'`, A).
  - **Runner payout** — yes (`RunnerEarning.status='failed'`, B).
  - **Organizer payout** — yes (`OrganizerPayout.status='failed'`, C).
  - **Refund** — yes, but a *different* state (`Refund.status='FAILED'`, `RefundRequest.status=
    'FAILED'`, D/E), on the refund models, not the payout enum.
  - **Tip-refund** — **NO durable failure marker.** Confirmed 2026-07-27 and now **FIXED**:
    `reconcileTipRefunds`'s catch writes a `TIP_REFUND_FAILED` audit row
    (`payeeType: 'customer'`). ⚠️ **Write half only** — nothing reads it; see the comment at the
    write site in `lib/tip-refund.ts`.
  - **Chargeback** — ~~NO durable failure marker~~ **❌ THIS WAS WRONG. Corrected 2026-07-27.**
    `Chargeback.clawbackStatus` (`schema.prisma:938` — `pending | done | partial`) **is** a
    durable marker, written on failure at `process-chargeback.ts:118-121` and again on the retry
    path (`:178`), and it **is read**: Pattern I (`reconciler.ts:783`) scans
    `clawbackStatus in ('pending','partial')` and retries every sweep. The alert is *in addition
    to* the marker, not instead of it. The loop is closed.

    **WHY THE ERROR IS WORTH NAMING, because the reading pattern will recur.** The original
    claim was written from what was *visible* — the `logger.error` line in the catch — and not
    from the code three lines below it, where `db.chargeback.update({ clawbackStatus: anyFailed
    ? 'partial' : 'done' })` sits *outside* the loop. An audit that stops at the catch block
    sees an alert and concludes "alert-only". The cost was nearly real: acting on this item as
    written would have built a second, redundant marker alongside a better one that was already
    read by a live retry pattern — introducing exactly the two-sources-of-one-truth class the
    audit exists to find. **Read to the end of the enclosing function, not to the end of the
    catch.**
- **Also note:** the vendor marker is on `Order.payoutStatus`, the runner/organizer markers are on
  the earning/batch `status`. There is **no `VendorEarning` failed state**, so a per-vendor-slice
  failure on a multi-vendor order is recorded only at order granularity.

---

## 1.4 Named set — money paths gating on the cached boolean

Every money-move readiness gate reads the DB booleans `stripeVerified` + `stripeAccountId`, never
a live check:

| Site | Gate |
|---|---|
| `lib/process-payout.ts:298` | `connected = !!(v?.stripeAccountId && v.stripeVerified)` |
| `lib/runner-payout.ts:119` | `connected = !!(runner?.stripeAccountId && runner.stripeVerified)` |
| `lib/runner-payout.ts:267` | `if (!(runner?.stripeAccountId && runner.stripeVerified)) …` |
| `lib/organizer-payout.ts:85` | `connected = !!(destinationAccountId && event.organizer?.stripeVerified)` |
| `lib/organizer-payout.ts:158` | `connected = !!(destination && event.organizer?.stripeVerified)` |

**Does any handler flip the boolean to `false` when Stripe reports the destination does not
exist?** **No.** Grep for `stripeVerified: false` across `app/ lib/ workers/` returns **zero
sites**. `stripeVerified` is only ever *written* by the display/status routes and the connect
webhook — `vendors/[id]/stripe/status/route.ts:61`, `organizer/stripe/status/route.ts:52`,
`runners/me/stripe/status/route.ts:56`, `stripe/connect-webhook/route.ts:75` — each setting it to
`status.readyToReceivePayments` (a *success* value; on a thrown `accounts.retrieve` the update is
skipped, so a stale `true` is never corrected).

**The `stripe-connect.ts:110` invariant is violated by the executors — confirmed.** The comment
reads *"This is the source of truth — never a DB flag."* `getConnectStatus` (`:113`) is the honest
live read, but it is called **only** by the four status/webhook routes above; **no money-move site
calls it.** The executors read the DB flag, which is a ~60s-cached mirror of that call
(`unstable_cache`, `vendors/[id]/stripe/status/route.ts:~50`). So the money path uses the copy the
invariant says never to trust — the through-line class, arriving via the cache. Under a live-key
flip, the 3 `stripeVerified=true` rows become values the executor trusts and cannot honor:
`transfers.create` → `resource_missing` → §1.2's retry-then-marker path (3 wasted attempts each),
and **nothing ever flips the boolean back to false**, so every subsequent Pattern C/D sweep
re-enqueues and re-fails.

---

## 1.5 Named set — consumers of runner completion rate, and the floor

The floor is `RUNNER_COMPLETION_MIN_DENOMINATOR = 5` (`lib/constants.ts:158`). Below it a rate is
noise (an empty runner reads 1.0 → "100%").

| Consumer | Applies the floor? |
|---|---|
| **Admin runners** — API `app/api/admin/events/[id]/runners/route.ts:57` computes `scored = s.collected >= RUNNER_COMPLETION_MIN_DENOMINATOR`; page `app/admin/[eventSlug]/runners/page.tsx:114` (banner requires `r.scored`), `:177-178` (bar only when `scored`) | ✅ **Yes** |
| **Runner's own earnings API** — `app/api/runners/me/earnings/route.ts:53` returns `completionRate: custody.rate` **raw**, no `scored` field | ❌ **No** |
| **Runner earnings page** — `app/runner/[fairSlug]/earnings/page.tsx:119` renders `(data?.completionRate ?? 1) * 100`% | ❌ **No** — and the `?? 1` fallback renders **100%** even while the value is missing/loading-failed |
| **Runner dashboard page** — `app/runner/[fairSlug]/dashboard/page.tsx:115` renders `stats.completionRate * 100`% | ❌ **No** |

**The consumer that misses the floor: the runner-facing surfaces (own earnings page + dashboard).**
A runner who has collected 0 orders sees **"Completion 100%"** — a fabricated measurement over an
empty denominator, the vacuous-gate class. Lower operational stakes than the admin roster view
(which *is* floored, so no keep/cut decision is made on noise), but it is the same class, and the
`?? 1` at `earnings/page.tsx:119` is a second instance — a 100% shown before any data loads.
(Note: `flicker-class-guard [D]` asserts `!/completionRate ?? 1/` on the **dashboard**
(`runnerDash`) only; the **earnings page's** `?? 1` is **not** covered by that guard.)

---

## Summary of what to carry into a fix pass (not fixed here)

1. **Unrecoverable-vs-transient share one retry branch** (§1.2) — a dangling-account transfer
   burns 3 retries before being marked; no fast-fail for permanently-unrecoverable Stripe errors.
2. **🔴 Ledger-drift halts write NO marker — CONFIRMED 2026-07-25, no longer "verify"** (§1.2 gap).
   BullMQ 5.76.8 fails an `UnrecoverableError` job at `attemptsMade = 1`, so the
   `exhausted >= 3` gate at `order-worker.ts:869` skips the marker AND the `PAYOUT_FAILED` audit
   Pattern U reads. The worst failure class is the one that goes unrecorded. Reachable for the
   first time now that the worker is live. **Highest-priority item in this list.**
3. ~~**Tip-refund and chargeback have no durable failure marker** — alert-only.~~
   **SPLIT AND PARTLY WRONG. Resolved 2026-07-27.**
   - **Tip-refund — ✅ DONE.** Was genuinely markerless: a failure wrote nothing, `tipRefundId`
     stayed null, so the order stayed in the candidate set and "never attempted" was
     indistinguishable from "failed 400 times over three days". Now writes a
     `TIP_REFUND_FAILED` audit row (`payeeType: 'customer'`, its own action string so it cannot
     contend with Pattern U's `take: 2000` window). No schema change. **Closes the WRITE half
     only** — nothing reads it, and that limit is stated at the write site.
   - **Chargeback — ❌ NOT A GAP.** `Chargeback.clawbackStatus` already exists and is already
     read by Pattern I every sweep (§1.3). Nothing to build.
   - **↪ POST-FAIR: chargeback clawback granularity.** The real, narrower gap:
     `clawbackStatus` is **per-chargeback**, so on a multi-vendor order `'partial'` cannot say
     *which* vendor's clawback failed — a human has to diff `Payout.reversedAt` by hand. Fixing
     it needs schema (a per-vendor clawback row, or a column on `Payout`), so it is deferred
     past Aug 12 per the migration-drift reasoning: the fresh-DB rebuild path is currently
     proven against 49 migrations and every new one is a chance to un-prove it.
   - **↪ KNOWN, NOT BUILT: the `no_charge` outcome.** A tip refund with no resolvable charge
     *returns* an outcome rather than throwing, so it never reaches the catch and gets no
     marker. It alerts every sweep, forever. Lower stakes (nothing was attempted, so nothing is
     half-done) but it is the same "indistinguishable states" shape and is deliberately left.
4. **No site flips `stripeVerified` to false on a dead destination** (§1.4) — a stale `true`
   re-fails every sweep; the executors read the flag the invariant says never to trust.

   **⛔ HARD CONSTRAINT, decided 2026-07-27 — do not discover this while building.**
   `lib/stripe-error-class.ts` will say **terminal** for a dead destination, but *terminal alone
   must NOT trigger the flip.* `resource_missing` is **not account-specific**: Stripe returns the
   same code for a missing charge and a missing transfer. Flipping `stripeVerified` on any
   terminal error would disconnect payees for failures that have nothing to do with them —
   during onboarding week, against the one blocker that cannot be compressed (§3).

   The verdict carries **`param`**, which names the field at fault (`'destination'` on the real
   SDK fixture, asserted in `stripe-error-class-guard [1]`). The flip must require
   `class === 'terminal'` **AND** `param` identifying the destination account. Terminal is
   *necessary, not sufficient.*

   Also still true and separate: only the **throw** case is the gap. When `accounts.retrieve`
   SUCCEEDS and reports a lapsed capability, the status routes already write `false` today.
   And the flip is self-healing — the status route and the connect webhook both rewrite the flag
   from a live read, so a false positive does not strand a payee.
5. **Runner-facing completion rate is unfloored** (§1.5) — empty runner shows 100%; `?? 1`
   fallback uncovered by the flicker guard.
