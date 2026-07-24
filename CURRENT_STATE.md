# FairSynq — Current State

> **Volatile. Regenerate before trusting** — run `git log --oneline main -8` and `git branch -v`
> first and reconcile. Do NOT copy anything from this file into `PROJECT_INVARIANTS.md`. This file
> is throwaway: paste it into a working session, never into persistent project knowledge.
>
> Snapshot: `main @ 33cad88`, **deployed `b45c230`**, 2026-07-24. Every number below was
> re-measured this session against the live DB unless marked otherwise.
>
> **The fair is Aug 5–12. That is 12 days out.**

---

## 1. Git / deploy reality

- **Served fingerprint: `b45c230`** — from `GET /api/health` (`commit` field), which is the
  authority. This shell **cannot fetch** (`git ls-remote` → `Permission denied (publickey)`), and
  the local `origin/main` ref has been wrong twice; trust the served fingerprint, not the ref.
- **Local head: `33cad88`. Unpushed: 4 commits.** The stale local ref reads `b45c230`.
- **⚠️ The 4 unpushed commits carry the vendor + organizer revenue corrections.** Until they ship,
  RANDY'S HOUSE OF BBQ sees a revenue figure that is **34% ghosts**. Push before any vendor
  onboarding link goes out — the first thing a vendor does on sign-in is check what they are owed.
- Agents never push (see `PROJECT_INVARIANTS.md` → _How we work_). A human pushes.

## 2. Infra — read this before touching Redis

- **Worker OFF, Redis unreachable.** Live health: `status: degraded`, `redis: "unreachable"`,
  `worker: { status: "unknown", lastSweepAt: null }`, HTTP 503. Upstash quota exhausted. That
  response is the endpoint working, not a regression.
- **`flags`: `enforceVendorReadiness: false`, `previewBypass: false`** (prod). Local `.env.local`
  sets `ENFORCE_VENDOR_READINESS=true` — a **known, deliberate divergence** (§6).

### 🔴 Patterns C, D, P, Q, R, S are UNGATED

`lib/reconciler.ts:183-184` calls `patternC`/`patternD` with only `{ windowStart, maxPerPattern,
dryRun }`. No enable flag. **Connect Redis and the 60s recurring sweep starts enqueuing real
payout transfers within a minute.** The only stops are: don't start the worker, or an admin
freeze/hold.

**`RECONCILER_BACKSTOP_ENABLED` gates Pattern N** (master-status drift auto-heal, `:194`), **not
the payout backstops.** The name misleads and is worth renaming before it fools someone mid-fair.

| Flag | Prod | What `true` does |
|---|---|---|
| `RECONCILER_PATTERN_E_ENABLED` | unset → off | Pattern E **acts**: re-enqueues accept-timeout → cancels + refunds stuck PLACED orders. Money-moving |
| `RECONCILER_BACKSTOP_ENABLED` | unset → off | Pattern **N** auto-heals status drift. **Not a payout flag** |
| `RECONCILER_PATTERN_T_ENABLED` | unset → off | Pattern T cancels phantom accruals on refunded/declined portions |
| **(no flag)** | — | **C, D, P, Q, R, S act whenever the sweep runs** |

### Agreed migration sequence — do not reorder

Adding `REDIS_URL` to Railway **itself triggers a redeploy and starts the worker**, so:

1. **Stop / scale-to-zero the Railway worker service FIRST.**
2. Provision the Railway Redis instance.
3. `REDIS_URL` → **Vercel** (and wherever the dry-run runs). **Railway only when ready to start.**
4. **`TEST_REDIS_PREFIX` unset in BOTH.** It is `test:` in `.env.local`; `getQueuePrefix()`
   (`lib/queues.ts:58`) returns `test` when set, `bull` when not. Producer and worker both read it,
   so a mismatch between Vercel and Railway means **enqueue and consume silently diverge** — this
   codebase has two prior payout-breaking bugs from prefix misalignment.
5. **Dry-run** (`npx tsx scripts/run-reconcile.ts` — dry-run is the default; works without Redis).
6. **Read the diff.** Then, and only then, start the worker.

**Connection config needs no code change.** `buildConnectionOptions` exists twice —
`lib/queues.ts:21` (producer) and `workers/order-worker.ts:734` (consumer), byte-identical but for
`lazyConnect` — and both set BullMQ's hard requirements (`maxRetriesPerRequest: null`,
`enableReadyCheck: false`). `tls: {}` is applied **only** when the URL scheme is `rediss:`, so a
Railway `redis://` URL simply won't set it.

**⚠️ IPv6 risk, flagged and NOT applied:** no `family` option is set anywhere. Railway's internal
hostname (`*.railway.internal`) resolves **AAAA/IPv6 only** and ioredis defaults to IPv4. Use the
**public URL first**; only if that fails is `family: 0` the fix — and that is a code change wanting
explicit go-ahead.

**Healthy looks like** (HTTP **200**, not 503):
```json
{ "status": "ok",
  "checks": { "database": "ok", "redis": "ok",
    "worker": { "status": "ok", "lastSweepAt": "…Z", "ageSec": 37 } } }
```
The heartbeat is written at the **end** of each sweep (`lib/reconciler.ts:248`), so it means the
sweep *completed*, not that the worker booted. Stale past **180s** (`lib/health.ts:19`) against a
60s sweep. Expect `worker: "unknown"` with `redis: "ok"` for up to ~60s after start — that gap is
normal, not a fault.

**Stranded jobs cannot be inspected** — Redis is unreachable, so anything still in the Upstash
queue must be *inferred from the DB*, not read. Abandoned job types and their recovery: vendor
payout → **Pattern C**; held vendor slice → **Pattern D**; runner payout → **Pattern P**;
organizer payout → **Pattern Q**; accept timeout → **Pattern E** (the only gated one). Today each
finds nothing to pay (§3), but that is because every payee is unconnected — not a safety property.

## 3. Payee connection — the fair-readiness headline

**Nobody on this platform can currently be paid except three vendors.**

| Payee | Connected | Total |
|---|---|---|
| Vendors (`stripeVerified`) | **3** | 20 (17 ACTIVE, 3 PENDING) |
| Runners (`stripeVerified`) | **0** | 4 |
| Organizer (`stripeAccountId`) | **null** — not connected | 1 |

- **14 approved vendors cannot receive a payout.** All 17 ACTIVE vendors have menu items, so
  Stripe is the blocker, not the menu.
- **No runner or organizer payout leg has EVER executed end-to-end.** RunnerEarning: 2 rows,
  both `tracked`, **$23.00**, never `paid`. OrganizerEarning: 2 rows, both `accrued`, **$12.98**,
  with **0 `OrganizerPayout` rows** — no batch has ever been created. Only the vendor leg has real
  history: 79 `paid` / **$3,109.15**, 8 `accrued`, 157 `cancelled`.
- **This is other people's onboarding, not code.** Longest lead on the board; cannot be compressed
  by working harder. 12 days.

## 4. What shipped since the last regeneration — by class

- **Runner stats collapsed onto one source.** The admin runner table derives from the ledger +
  custody events; `Runner.totalCompleted` / `totalDispatched` / `completionRate` are **write-dead**
  and marked DEPRECATED in `schema.prisma`. Drop migration deferred.
- **Custody-for-counts / ledger-for-money.** `lib/runner-completion.ts` owns delivery counts and
  completion; `lib/runner-earnings.ts` owns money. The ledger-derived count under-reported (a
  DELIVERED zero-fee order accrues nothing), so count fields were **removed** from the earnings
  summary rather than paralleled. Includes the ghost fix and "delivery proves possession".
- **Checkout address rebuilt.** `lib/delivery-address.ts` is one validator shared by the form and
  `POST /api/orders`, so the form cannot build a payload the route rejects. Both fabricated
  defaults are gone (`city || street`, `zip || '00000'`); real city/state/zip inputs plus a
  **unit line** (new `Order.deliveryUnit` / `deliveryState`); one formatter replaced five hand-joins.
- **Dates split into two kinds.** `lib/event-date.ts` = CALENDAR dates (zone-fixed; fairs rendered
  a day early). `lib/audit-time.ts` = INSTANTS (explicit locale + named zone; the money log read
  `19/07/2026` for non-US browsers). Neither imports the other, asserted.
- **Live-state derivation.** `deriveEventLiveState` — before/within/after the run, enablement-gated
  — replaced `status === 'ACTIVE' → "Live Now"` on badges, the fair hero and the vendor portal.
  Then the **server** gate: `POST /api/orders` refuses a closed fair with a named `FAIR_NOT_OPEN`.
- **`lib/resolve-order.ts`.** One tolerant + unambiguous order resolver (short code or cuid;
  `take: 2` + throw on collision, never picks one). Fixed the cancel 404 across 8 call sites.
- **Order log.** Whole-event server-side search (short code, customer, vendor), real `count()`
  total, cursor "Load older", server-side filters, day grouping, age badge. The dead "Refunded" tab
  (not a master status) became "Issues".
- **Admin preview bypass** — temporary; env flag **AND** strict-admin session, both server-side.
- **Money page** — platform-vs-fair scope boundary, section nav, and an audit trail that was
  silently capped at 50 of 161 rows.
- **Ghost-filter sweep** — `lib/order-scope.ts` (`IN_MODEL_ORDERS`) + a **scanner** guard covering
  ~40 aggregates across the order log, organizer and vendor surfaces.

**Suite count: 64** (re-measured from `scripts/verify-all.ts`). Full gate green at last run.

### Proven in production data this session

The newest home-delivery order (Jul 23, 15:05 — the same order the cancel bug was filed on) stored:
`street: "417 Cougar Village, Edwardsville, IL 62025, USA"`, `unit: "417-1C"`,
`city: "Edwardsville"`, `state: "IL"`, `zip: "62025"`.

**That answers three open questions at once:** Places **does** resolve the campus/dorm address, the
parser works end-to-end, and the unit line is being used — with no fabricated `00000`. The 10
legacy `street === city` rows are unchanged and were deliberately not backfilled.

## 5. Decisions recorded — do not re-litigate

- **Completion floor = 5** (`lib/constants.ts:158`). Below it the admin shows raw
  `delivered/collected` and "not enough deliveries" — no percentage, no bar, no `<90%` banner. A
  ratio over N=1–4 turns one bad order into a 25–100-point swing on the screen where an admin
  decides who stays on the roster.
- **`completedAt` is deliberately NOT backfilled on DELIVERED.** The null is load-bearing: Pattern
  C/S scan `status IN COMPLETE_STATES AND completedAt >= windowStart`, so the null keeps legacy
  DELIVERED orders out of those money windows. The timeline reads the accrual timestamp instead.
- **A pre-collect release is excluded from the completion denominator.** Only possession-then-
  failure counts; releasing early costs the runner nothing — the point of the release path.
- **Stripe `retrieve`/`list` paths are deliberately UNGATED by fair-open state.** An order placed
  during a fair must settle after it ends; gating payout/refund/reconciler would strand money. The
  guard asserts the *absence* of the clause there.
- **No `includeVoided` opt-in on organizer or vendor surfaces.** They never need "revenue including
  struck orders". That opt-in exists only on the admin order log.
- **`MUST_NOT_FILTER`** (`scripts/organizer-ghost-guard.ts`) — four queries that must **never**
  carry the ghost filter, each with its reason, asserted: `webhooks/stripe` (must find any order to
  reconcile a real charge), `process-chargeback` (a chargeback on a later-voided order must still
  claw back), `resolve-order` (the caller decides), `runners/me/location` (operational lookup).

## 6. Open items, ranked

1. **Redis migration** — gates everything below. Sequence in §2.
2. **Stripe onboarding: 14 vendors, 4 runners, 1 organizer.** Longest lead, not code. §3.
3. **The three payout legs end-to-end** — runner and organizer have never executed once. Watch a
   single one execute before anything runs unattended.
4. **Live-mode Stripe verification** (webhooks, real transfers). Not started.
5. **The books** (re-measured): `refund_reversal` **46 events / $975.40** open, unclassified;
   `dispute_clawback` **3 / $101.96** open (Pattern K alerts; chase, no auto-deduct);
   `payoutStatus=FAILED` **0**; legacy never-paid obligation **~$135.78** *(prior session, not
   re-measured)*.
6. **`ENFORCE_VENDOR_READINESS` divergence** — `true` locally, `false` in prod, so the public site
   lists 17 vendors when **2** are transactable. Which number a customer should see: **2**.
   Flipping it is a business decision; the divergence is now visible in `/api/health.flags`.
7. **Rename `RECONCILER_BACKSTOP_ENABLED`** — it gates Pattern N, not the payout backstops.

## 7. Known partials and open questions

- **The cancel 409 is still unexplained.** The 404 is fixed (short-code resolution). Cancel's only
  409 is the voided refusal and that order is PLACED, not voided; the new ambiguous-code 409 can't
  be it either (zero collisions in the DB). **Needs Network evidence: method, URL, response body.**
  Do not theorize or build for it until captured.
- **Money routes are not through `resolveOrder`.** The organizer/admin refund routes and
  `runner-payout` / `tip-refund` fetch by a bare param or a canonical id. No short code reaches
  them through a known path — but "no known path" is weaker than the guarantee the resolver gives
  elsewhere. Low-risk follow-up, deliberately not folded into a money path pre-fair.
- **Customer order-history ghost filter — pending a product call.** Do **not** just filter: a
  voided order the customer **paid for** vanishing looks like it never existed. The rule should
  probably key on **whether money moved** — visible (marked voided, with refund state) if there was
  a charge, hidden if not.
- **Preview bypass is temporary scaffolding.** Remove after Aug 5: `lib/preview-access.ts`,
  `app/api/preview-access/`, the hook + banner in the fair page, the health flag, and its guard.
  `grep -ri preview` finds all of it.
- **Tagging preview-created orders: recommended, NOT implemented.** They are real rows.
  `voidedAt`/`voidReason` is the existing out-of-model marker, but using it touches the order write
  path and accrual semantics — wants its own reviewed change.
- **Stale-order cleanup: recommended, NOT executed.** 225 of 377 orders are already voided; the
  honest path is voiding the remaining stale ones rather than deleting. Should follow the ghost
  filters (now shipped), not precede them.
- **Dry-run reading discipline.** The last dry-run returned all zeros because the **24h lookback
  excluded every stale order** (oldest Jun 11) — that is "the patterns won't SEE this data", **not**
  "the patterns are safe on it". The genuine reassurance is narrower: Pattern V is unwindowed with
  **0** candidates, and E / backstop / T are gated off. Never report "0" without saying which it is.

## 8. Promotion queue for `PROJECT_INVARIANTS.md` (do NOT promote now — list only)

**Disciplines earned:**
- **custody-for-counts / ledger-for-money** — two spines, different questions; guarded.
- **fingerprint-over-git-ref** — the served `/api/health` `commit` is the authority; the local ref
  was wrong twice.
- **test-the-artifact-not-a-reconstruction** — a hand-made snippet compiled with `tsc` "proved" a
  JSX space that SWC actually stripped. Read the built bundle.
- **guards-scan-code-not-prose** — three guards failed on their own explanatory comments; strip
  comments before scanning, or the reasoning gets deleted to stay green.
- **guards-match-shape-not-names-or-locations** — a guard keyed on `startDate`/`endDate` missed an
  aliased copy; one keyed on a filename broke when the code improved. Shape-keyed scanners caught
  two queries that careful manual passes had missed.
- **named-sets-over-counts** — `4 money routes found (5)` says something changed; a named set says
  *what*, and fails with the offending path.

**Through-line table rows earned:** `lib/resolve-order.ts` (order identity),
`lib/order-scope.ts` (in-model orders), `lib/delivery-address.ts` (address validation + format),
`lib/event-date.ts` (calendar dates) — each with its guard.

*The queue is long enough that it deserves its own commit rather than another session's deferral.*
