# FairSynq — Current State

> **Volatile. Regenerate before trusting** — run `git log --oneline main -8` and `git branch -v`
> first and reconcile. Do NOT copy anything from this file into `PROJECT_INVARIANTS.md`. This file
> is throwaway: paste it into a working session, never into persistent project knowledge.
>
> Snapshot: `main @ 5300a76`, **deployed `5300a76`**, 2026-07-24 (post-Redis-migration). Every
> number below was re-measured this session against the live DB unless marked otherwise; anything
> taken on report rather than measured here says so inline.
>
> **The fair is Aug 5–12. That is 12 days out.**

---

## 1. Git / deploy reality

- **Served fingerprint: `5300a76` — matches local head. Nothing unpushed.** From `GET /api/health`
  (`commit` field), which is the authority. This shell **cannot fetch** (`git ls-remote` →
  `Permission denied (publickey)`) and the local `origin/main` ref has been wrong twice; trust the
  served fingerprint, not the ref.
- **The vendor + organizer revenue corrections are LIVE.** They were the 4 unpushed commits in the
  previous snapshot; RANDY'S HOUSE OF BBQ no longer sees the 34%-ghost revenue figure. Vendor
  onboarding links are safe to send on this axis.
- Agents never push (see `PROJECT_INVARIANTS.md` → _How we work_). A human pushes.

## 2. Infra — Redis migrated, worker LIVE

**Both of this section's former premises are dead.** Redis is reachable and the production worker
is running. Re-measured `GET /api/health` at 2026-07-24T23:13:46Z:

```json
{ "status": "ok", "commit": "5300a76…",
  "checks": { "database": "ok", "redis": "ok",
    "worker": { "status": "ok", "lastSweepAt": "2026-07-24T23:13:15.191Z", "ageSec": 31 } },
  "flags": { "enforceVendorReadiness": false, "previewBypass": true } }
```

- **Redis is Railway** — TCP proxy `tokaido.proxy.rlwy.net:47918`, scheme `redis://`, so **no TLS is
  applied. That is correct for Railway, not a misconfiguration**: `buildConnectionOptions`
  (`lib/queues.ts:33`) sets `tls: {}` only for `rediss:`.
- **Upstash is ABANDONED and still at `500000/500000`. Do not touch it.** Reads from it fail
  intermittently at the quota ceiling (`EVAL` first, then even `AUTH`) while a bare `PING` still
  answers — a green ping and an unusable instance coexist. Nothing reads it now except
  `lib/ratelimit.ts`, which uses a **separate** `@upstash/redis` REST connection over
  `UPSTASH_REDIS_REST_URL`/`_TOKEN` (`lib/ratelimit.ts:2,55`) — **not** `REDIS_URL`. Rate limiting
  and the queue have never shared a client.
- **Worker is LIVE on Railway.** Sweep every 60s (`workers/order-worker.ts:857`, `repeat: { every:
  60_000 }`); heartbeat written at the **end** of each sweep (`lib/reconciler.ts:248`), so `ageSec`
  means the sweep *completed*, not that the worker booted.

### ⚠️ Sweep duty cycle — 14s of every 60s, unprofiled

Four consecutive observed sweep durations: **14374 / 13914 / 13865 / 13923 ms** — remarkably stable,
~23% duty cycle. *(Reported from Railway logs; not independently re-measured here.)*

**This is the number to watch at fair scale.** The sweep is 23 patterns over the whole order/earning
space, and the current data set is small. If a sweep ever exceeds 60s, BullMQ's repeatable scheduler
fires the next one anyway and **two sweeps run concurrently against the same rows**. The money
patterns are idempotent by construction, so this is a correctness *risk* rather than a proven bug —
but nothing bounds it today. **Which pattern dominates the 14s is unknown and unprofiled**; that is
an open item (§6), not something done.

### 🔴 Patterns C, D, P, Q, R, S are UNGATED — and now they actually run
- **`flags`: `enforceVendorReadiness: false`, `previewBypass: false`** (prod). Local `.env.local`
  sets `ENFORCE_VENDOR_READINESS=true` — a **known, deliberate divergence** (§6).

`lib/reconciler.ts:183-184` calls `patternC`/`patternD` with only `{ windowStart, maxPerPattern,
dryRun }`. No enable flag. **The 60s sweep is now running, so these act every minute.** The only
stops left are an admin freeze/hold — "don't start the worker" is no longer one of them.

Measured blast radius at cutover was effectively nil, and that was the reason it was safe to start:
the dry-run found **one** candidate (Pattern Q, one event) that would have moved **$0**, because the
organizer is unconnected and `lib/organizer-payout.ts:202` holds rather than transfers.

**`RECONCILER_BACKSTOP_ENABLED` gates Pattern N** (master-status drift auto-heal, `:194`), **not
the payout backstops.** The name misleads and is worth renaming before it fools someone mid-fair.

| Flag | Prod | What `true` does |
|---|---|---|
| `RECONCILER_PATTERN_E_ENABLED` | unset → off | Pattern E **acts**: re-enqueues accept-timeout → cancels + refunds stuck PLACED orders. Money-moving |
| `RECONCILER_BACKSTOP_ENABLED` | unset → off | Pattern **N** auto-heals status drift. **Not a payout flag** |
| `RECONCILER_PATTERN_T_ENABLED` | unset → off | Pattern T cancels phantom accruals on refunded/declined portions |
| **(no flag)** | — | **C, D, P, Q, R, S act whenever the sweep runs** |

### The migration, as it actually happened — DONE

Kept as a record because **the same ordering applies to any future Redis move**, and the rationale
is what makes it correct rather than the steps. Adding `REDIS_URL` to the Railway *worker service*
itself triggers a redeploy and starts the worker, so the consumer must be the last thing wired.

1. **Worker scaled to zero FIRST** — so nothing consumes while producer config is in flux.
2. **Railway Redis provisioned.**
3. **`REDIS_URL` → Vercel only.** Producer first, consumer last.
4. **`TEST_REDIS_PREFIX` unset in both.** ⬅ **This is the step that was silently wrong, and it cost
   the whole investigation.** See the finding below.
5. **Dry-run** (`npx tsx scripts/run-reconcile.ts`; dry-run is the default — `dryRun: !live`,
   `scripts/run-reconcile.ts:22` — and it reads the DB, not Redis, so it works with Redis down).
6. **Read the diff with the vacuity discipline** (§7): name which kind each zero is.
7. **`REDIS_URL` → Railway worker.** Worker starts. Watch the first sweeps.

**Proof the migration took, in order of strength:** `lastSweepAt: null` on `/api/health` immediately
after the Vercel redeploy (the heartbeat lives in Redis, so a null against a previously-populated
value proves Vercel switched instances — positive proof needing no order); then
`bull:fairsynq-orders:id` existing after a real order (proves the producer *enqueues*, not merely
connects).

### 🔬 FINDING — why prod never enqueued: `TEST_REDIS_PREFIX` was set in Vercel

**Cause: `TEST_REDIS_PREFIX` was set in the Vercel environment. Deleting it fixed it.** Every prod
enqueue had been landing under the `test` namespace, which no consumer reads. *(The env-var state is
reported from the Vercel dashboard, not verifiable from this repo; the code path below is verified.)*

The code makes this causal and silent: `getQueuePrefix()` (`lib/queues.ts:58-61`) returns
`raw.replace(/:$/, '') || 'bull'`, so a set var yields `test` and an unset one yields `bull`. All
three construction sites pass it through — `lib/queues.ts:157` (producer), `workers/order-worker.ts:810`
(Worker), `workers/order-worker.ts:854` (repeat scheduler) — with **no hardcoded prefix anywhere**,
so a mismatch can only come from the environment. Producer and consumer diverge with **no error on
either side**: the producer writes happily, the worker listens to a different key space. This is the
codebase's third prefix-misalignment payout bug.

#### The diagnostic that cracked it: `meta` and `:id` are DIFFERENT evidence

This is the generalisable part, and it located the fault **without a single log line**:

| key | written when | therefore proves |
|---|---|---|
| `<prefix>:<queue>:meta` | **`Queue` constructor**, unconditionally, error swallowed (`bullmq/dist/cjs/classes/queue.js:45-53`) | a Queue was **CONSTRUCTED** |
| `<prefix>:<queue>:id` | `INCR idKey` inside the add\* Lua only (e.g. `bullmq/dist/cjs/scripts/addDelayedJob-6.js:541`), never deleted | a Queue was **USED** — an `add()` succeeded |

On Railway after a real prod order: `bull` had **neither**, `test` had **both**. Construction and
use had both happened — just in the wrong namespace. *(The `test`-side reading is user-reported; the
`bull`-side absence was read directly.)*

Reading `meta` as evidence of enqueuing would have pointed at a producer defect that did not exist.
Promoted as a discipline — see `PROJECT_INVARIANTS.md` → *constructed-is-not-used*.

#### The three candidate causes, all now dead

| # | candidate | what killed it |
|---|---|---|
| 1 | Quota rejected the enqueue | Enqueues were **succeeding** all along, under `test`. Nothing was rejected. |
| 2 | `REDIS_URL` was recent in Vercel, so no traffic since | Ruled out first: the var had existed since Jul 17. |
| 3 | The prod path never calls `add()` — scheduling only happens in worker-side reconciler patterns | False. `placePaidOrder` enqueues `JOB_UNACCEPTED` on **every** placement (`lib/place-order.ts:135-148`), unconditional on fulfillment type, vendor readiness, or preview bypass. |
| 4 | Prod never took a real order | Dead: **24 non-voided orders on/after Jul 17**, every one of which reached at least one enqueue trigger (placement alone is a trigger). Its *specific* form — that those 24 were all placed locally — was the live reading until the prefix was found. |

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

### Inspecting the queue — the probe

`scripts/step-b-inspect.ts` reads any Redis instance read-only with raw `LLEN`/`ZCARD`/`LRANGE`/
`ZRANGE`/`HGETALL` — **no `EVAL`**, because BullMQ's `getJobCounts()` Lua both trips a quota ceiling
and can `RPOP` a legacy marker. No Worker, no scheduler, no promote/retry/drain/obliterate.

**The target is explicit and it refuses to run without one** — there is deliberately no implicit
`.env.local` fallback, because `.env.local` still points at exhausted Upstash:

```bash
npx tsx scripts/step-b-inspect.ts --url 'redis://default:PASS@tokaido.proxy.rlwy.net:47918'
PROBE_REDIS_URL='redis://…' npx tsx scripts/step-b-inspect.ts
npx tsx scripts/step-b-inspect.ts --env       # opt IN to .env.local, prints a warning
```

It prints the `[:id counter]` line first, with the absent-vs-empty distinction spelled out inline so
the finding above cannot be re-lost. `--prefix bull,test` overrides the default of both.

**Enqueue-failure observability, audited.** No swallowed-error money-loss path exists: every failing
enqueue logs at ERROR (`lib/queue-safe.ts:70`) before returning `'dropped'`, and vendor drops also
fire `notifyPayoutDropped` (`lib/order-side-effects.ts:83`). **But nothing is durable** — `lib/logger.ts`
is `console.*` only, no Prisma, and `notify.ts` adds only Slack. **The runtime log is the sole
evidence, subject to retention.** Three asymmetries on that path are recorded in §7.

## 3. Payee connection — the fair-readiness headline

**Nobody on this platform can currently be paid except three vendors.**

Re-measured 2026-07-24 (`stripeVerified: true AND stripeAccountId NOT NULL` for all three):

| Payee | Connected | Total |
|---|---|---|
| Vendors (event-scoped) | **3** | 20 |
| Runners | **0** | 4 |
| Organizers | **0** | 3 |

- **17 vendors cannot receive a payout.** Stripe is the blocker, not the menu.
- **Organizers read 0 of 3 — the "3" is NOT a bug and does not need re-investigating.** The three
  `FairOrganizer` records are **2 test accounts created during onboarding testing + 1 real organizer
  (unconnected)**. The previous snapshot said "1 organizer"; only the test rows are new. The
  connected count has always been 0. *(The 2 test rows are part of the pre-fair data reset, §6.)*
- **No runner or organizer payout leg has EVER executed end-to-end.** RunnerEarning: 2 rows,
  both `tracked`, **$23.00**, never `paid`. OrganizerEarning: 2 rows, both `accrued`, **$12.98**,
  with **0 `OrganizerPayout` rows** — no batch has ever been created.
- **The live worker has not changed this.** `payoutStatus` is set on exactly **4** orders, all
  `COMPLETED`, and all last touched between 2026-06-04 and 2026-07-22T01:28Z — i.e. **before** the
  worker died on Jul 22. `Payout` rows are unchanged at 136. **The Railway worker has run sweeps but
  has not yet completed a single payout**, because there is nobody connected to pay.
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
- **`completedAt` is deliberately NOT set on DELIVERED — for EVERY delivered order, not just legacy
  ones.** *(Scope corrected this session; the previous wording said "legacy" and undersold it.)* The
  ternary at `lib/reconcile-order-status.ts:426` sets `completedAt` for `COMPLETED` and falls through
  to `{}` for `DELIVERED`, so **runner-delivered orders are permanently invisible to Patterns C and
  S**, past and future, by construction — not a backfill decision about old rows. Guarded in both
  directions by `scripts/delivered-timeline-guard.ts:43-44`. **Pattern L is their backstop**, windowed
  on `updatedAt` precisely because `completedAt` is never set (`lib/reconciler.ts:807-808`). The
  timeline reads the accrual timestamp instead.
  **Measured:** of 136 non-voided COMPLETED/DELIVERED orders, **133 have `completedAt` set (all 133
  COMPLETED); the 3 nulls are exactly the 3 DELIVERED.** The mechanism is intact — C/S zeros are
  window-limited, not structurally dead.
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

**Redis migration is DONE and drops off this list.** Reordered 2026-07-24.

1. 🔐 **Rotate the Railway Redis credential — BEFORE 2026-08-05.** The current password was
   **exposed in a chat transcript**. Railway has **no in-place rotation**: the fix is delete the
   Redis service and reprovision, then update `REDIS_URL` in Vercel *and* the Railway worker. Do it
   in the §2 order (worker to zero first) — a half-updated pair is exactly the producer/consumer
   split that caused the prefix bug.
2. **Stripe onboarding: 17 vendors, 4 runners, 3 organizers unconnected.** Longest lead, not code,
   cannot be compressed by working harder. §3.
3. **Pre-fair data reset — DELIBERATELY NOT DOING THE TEST-ORDER CLEANUP.** The prod test orders
   accrued, and the live worker then **paid** them: payable went $287 → $344 → back to **$287.00**
   as $53.98 settled to RANDY'S HOUSE OF BBQ. That is test-mode money in a test-mode Stripe
   account against the test vendor — **not worth engineering time**, and the decision is recorded
   so it is not re-opened.

   ⚠️ **KEEP THE PRINCIPLE THE ATTEMPT SURFACED — it will be true with REAL money at the fair:**

   > **Voiding an order does NOT reverse a settled transfer.** `voidedAt` is an out-of-model
   > exclusion marker (`schema.prisma`, `Order.voidedAt`) — the reconciler skips the order and
   > Stripe is untouched. Once the worker has executed a payout, the money is gone from the
   > platform balance and only a **Pattern-T reversal or a Stripe-side reversal** brings it back.
   > Any future "just void the bad orders" cleanup plan is wrong the moment a payout has fired.
   > Check `Payout` / `VendorEarning.status = 'paid'` **before** assuming a void is sufficient.
4. **The three payout legs end-to-end — ✅ VENDOR LEG PROVEN IN PRODUCTION, runner + organizer
   still never executed.** On 2026-07-25 the full production loop ran unattended for the first
   time: **prod producer → Railway Redis → live Railway worker → Stripe transfer.** Measured:
   `Payout` rows **136 → 140**, orders with `payoutStatus` **4 → 8**, paid **$3,109.15 →
   $3,163.13** (+$53.98), four payouts between **00:33 and 01:19**. One of them is
   `cmrzeiyty000lqu5l59lz051a` — the order placed to prove the producer enqueues. Producer,
   queue, consumer and Stripe are now all verified on the vendor path.
   **Still unexecuted: the runner and organizer legs**, blocked on payee onboarding (§3), not on
   code. Watch each execute once before trusting it unattended.
5. 🔬 **Profile the sweep — which pattern owns the 14s?** Unprofiled. At fair scale a sweep over 60s
   means overlapping sweeps on the same rows (§2).
6. **Remove the preview-bypass scaffold — AFTER 2026-08-05.** Full removal list in §7.
   ⚠️ **`ALLOW_PREVIEW_BYPASS` is currently `true` in prod** (`/api/health.flags.previewBypass:
   true`, re-measured), and it gates **`POST /api/orders`**, not just UI — `app/api/orders/route.ts:190`
   is what lets an admin past `FAIR_NOT_OPEN`. Leaving it on past Aug 5 is inert (the fair is live,
   the gate passes anyway), but it is live money-path config and should come out.
7. **Live-mode Stripe verification** (webhooks, real transfers). Not started. Local is `sk_test_*`.
8. **The books** (re-measured 2026-07-24): `refund_reversal` **46 events / $975.40** open,
   unclassified; `dispute_clawback` **3 / $101.96** open (Pattern K alerts; chase, no auto-deduct);
   legacy never-paid obligation **~$135.78** *(prior session, not re-measured)*.
   **`payoutStatus=FAILED` is `0`, and it is STILL a vacuous zero.** The reason has changed and is
   now narrower: the worker is live and the producer works, but **no payout job has yet reached the
   failed handler**, because nobody is connected to pay (§3). The marking machinery still has never
   run in prod (`docs/reports/failed-marker-taxonomy.md` §1.3) and has three gaps to fix before the
   worker is trusted. A `0` from a path that has not executed is not evidence.
9. **`ENFORCE_VENDOR_READINESS` divergence** — `true` locally, `false` in prod, so the public site
   lists 17 vendors when **3** are transactable *(re-measured; was 2)*. Which number a customer
   should see: the connected count. Flipping it is a business decision; visible in `/api/health.flags`.
10. **Rename `RECONCILER_BACKSTOP_ENABLED`** — it gates Pattern N, not the payout backstops.

## 7. Known partials and open questions

- **The cancel 409 is still unexplained — and is NOT the checkout 409.** Keep these apart:
  - ✅ **`FAIR_NOT_OPEN` 409 on `POST /api/orders` — EXPLAINED, working as designed.**
    `app/api/orders/route.ts:184-201`: `deriveEventLiveState` (`lib/event-date.ts:82-90`) returns
    `upcoming` for Italian Fest (`startDate 2026-08-05`, today Jul 24), and the route refuses unless
    `hasPreviewAccess()` passes. Body: *"Italian Fest 2026 isn't open for orders yet — it runs Aug 5
    – Aug 12, 2026."* Closed; not a bug.
  - ❓ **The cancel 409 is a different, still-open thing.** Cancel's only 409 is the voided refusal
    and that order is PLACED, not voided; the ambiguous-code 409 can't be it either (zero collisions
    in the DB). **Still needs Network evidence: method, URL, response body.** Do not theorize or
    build for it until captured, and do not let the checkout 409's resolution be mistaken for this
    one's.
- **`Order.status = PLACED` while its `VendorOrderStatus` is `ACCEPTED` — unresolved.** Order
  `cmrzeiyty000lqu5l59lz051a` (placed 2026-07-24T20:37:28.918Z, BOOTH_PICKUP, $16.50).
  **Known:** the VOS row reads `ACCEPTED` with `acceptedAt 2026-07-24T20:37:48.746Z`, while the
  master `Order.status` is still `PLACED` with `Order.acceptedAt` null — 20s apart, so the vendor
  accept landed and the master flip did not follow. Its `OrderEvent` trail is **empty** (zero rows).
  **Also known:** later test orders that same evening converged to `COMPLETED` correctly, so this is
  **not** a blanket convergence failure — likely path-specific.
  **Not known:** which accept path this order took, why the master did not converge, and whether the
  empty `OrderEvent` trail is related or is its own gap. `reconcileMasterStatus` is the single owner
  of master status; nothing here has been traced to it yet. **Do not fix blind** — capture the accept
  request first, the same discipline the cancel 409 is under.
- **Money routes are not through `resolveOrder`.** The organizer/admin refund routes and
  `runner-payout` / `tip-refund` fetch by a bare param or a canonical id. No short code reaches
  them through a known path — but "no known path" is weaker than the guarantee the resolver gives
  elsewhere. Low-risk follow-up, deliberately not folded into a money path pre-fair.
- **Customer order-history ghost filter — pending a product call.** Do **not** just filter: a
  voided order the customer **paid for** vanishing looks like it never existed. The rule should
  probably key on **whether money moved** — visible (marked voided, with refund state) if there was
  a charge, hidden if not.
- **Preview bypass is temporary scaffolding — and it is ON in prod right now.**
  `ALLOW_PREVIEW_BYPASS=true` (`/api/health.flags.previewBypass: true`, re-measured 2026-07-24). It
  gates **four** surfaces, and the money one is easy to miss: **`POST /api/orders:190`** (past
  `FAIR_NOT_OPEN`), `app/fair/[fairSlug]/page.tsx:218,229` (UI), `app/api/preview-access/route.ts:21`
  (the probe), `app/api/health/route.ts:36` (reports the flag; not a gate). Both real gates route
  through one `hasPreviewAccess()` (`lib/preview-access.ts:55`) requiring flag **AND** strict admin.
  Remove after Aug 5: `lib/preview-access.ts`, `app/api/preview-access/`, the hook + banner, the
  health flag, its guard — `grep -ri preview` finds all of it.
- **Tagging preview-created orders: recommended, NOT implemented.** They are real rows.
  `voidedAt`/`voidReason` is the existing out-of-model marker, but using it touches the order write
  path and accrual semantics — wants its own reviewed change.
- **Stale-order cleanup: recommended, NOT executed.** 225 of 377 orders are already voided; the
  honest path is voiding the remaining stale ones rather than deleting. Should follow the ghost
  filters (now shipped), not precede them.
- **🔴 THE LIVE WORKER MAKES THE TEST GATE UNRELIABLE. Interim discipline, until isolation exists:
  SCALE THE RAILWAY WORKER TO ZERO BEFORE ANY FULL GATE, AND BACK UP AFTER.**
  Suites seed into the shared prod DB; the 60s sweep mutates their rows mid-run. `verify-all`
  retries and exits **0** while printing `⚠️ FLAKY (passed only on retry)` — so a money suite can
  fail and the gate still reads green. **Judge a gate run by exit code AND zero FLAKY lines.**
  Measured: `c1-admin-money-control` failed **1 run in 8** with the worker live; with the worker
  at zero, **4 consecutive clean runs** (65/65 gate + 3 isolated, 94 assertions each).
  This is a workaround, not a fix — the cause is the absence of a test database (§ top open item).

  **The nine suites at risk — named set, not an estimate:**

  *(A) Seeds AND drives the reconciler — races the live worker head-on:*
  `c1-admin-money-control-test.ts` (4 × `runReconciliationSweep`) · `reverser-pattern-t-guard.ts` (1)
  · `test-phase6-backstop.ts` (1) · `b2-runner-payout-test.ts` · `b3-organizer-payout-test.ts` ·
  `b4-tip-refund-test.ts` (the last three call `reconcileRunnerPayouts` / `reconcileOrganizerPayouts`
  / `reconcileTipRefunds` directly)

  *(B) Seeds AND asserts on an unscoped aggregate:*
  `organizer-bootstrap-test.ts` (`orgMember.count`) · `runner-onboarding-proof.ts`
  (`runner.count` before/after)

  Only `c1-admin-money-control-test.ts` has been hardened (scoped to `actorType: 'admin'`,
  `:392`). **The other eight are unfixed** — they simply have not been unlucky yet.
- **Two enqueue-observability asymmetries (found in the swallowed-error audit, §2). Neither is
  silent; both are thinner than their vendor twin.** The vendor payout checks the return and logs a
  CRITICAL line naming the order (`lib/reconcile-order-status.ts:505-509`), plus
  `notifyPayoutDropped`. The other two legs discard it:
  - `enqueueRunnerPayout` at `lib/reconcile-order-status.ts:605` — return value dropped. Its
    `try/catch` is **dead for this case**: the function returns `false` on drop, it does not throw.
  - `enqueueOrganizerPayout` at `app/api/admin/events/[id]/status/route.ts:62` — same shape, same
    dead catch.

  A drop still emits `[Queue] Failed to enqueue after 3 attempts` from `lib/queue-safe.ts:70`, so
  nothing vanishes — what is missing is the order/event-tagged CRITICAL line and any `notify*`.
  This is the same **§3-divergence shape** as the vendor double-pay hole (one leg hardened, its
  twins not). Cheap fix, but it touches money paths — wants its own reviewed change, not a fold-in.
- **`if (enqueued)` at `app/api/orders/[id]/status/route.ts:428` logs success and not failure.**
  Harmless today (the drop is logged inside the helper) but it reads backwards; the interesting
  event is the one that goes unlogged at the call site.
- **🔴 The producer fails SILENTLY where the consumer fails LOUDLY — on the money-in path.**
  `lib/place-order.ts:136` is `if (ordersQueue) { … }` with **no `else`**: when `getOrderQueue()`
  returns null, the accept-timeout enqueue is skipped and **nothing is logged at the call site at
  all**. The worker's equivalent path refuses to start: `console.error('[Worker] REDIS_URL is not
  set — cannot start worker')` then `process.exit(1)` (`workers/order-worker.ts:751-754`).
  That asymmetry is the finding — the consumer is fail-loud, the producer is fail-silent, and the
  silent one is the one taking money. It is also why the prefix bug could persist: a producer that
  cannot reach its queue looks identical to one with nothing to enqueue.
- **Dry-run reading discipline.** The last dry-run returned all zeros because the **24h lookback
  excluded every stale order** (oldest Jun 11) — that is "the patterns won't SEE this data", **not**
  "the patterns are safe on it". The genuine reassurance is narrower: Pattern V is unwindowed with
  **0** candidates, and E / backstop / T are gated off. Never report "0" without saying which it is.

## 8. Promotion queue for `PROJECT_INVARIANTS.md`

**EMPTY — flushed 2026-07-24.** Everything queued here was promoted in this commit, plus two new
disciplines earned this session (*newest-needs-null-handling*, *constructed-is-not-used*). See
`PROJECT_INVARIANTS.md` → *How we work* and the through-line table.

Re-fill as new disciplines are earned; promote them rather than deferring across sessions again.
