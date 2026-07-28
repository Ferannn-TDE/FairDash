# FairSynq — Current State

> **Volatile. Regenerate before trusting** — run `git log --oneline main -8` and `git branch -v`
> first and reconcile. Do NOT copy anything from this file into `PROJECT_INVARIANTS.md`. This file
> is throwaway: paste it into a working session, never into persistent project knowledge.
>
> Snapshot: `main @ ae50b7a`, **deployed `ae50b7a`** (measured, in sync — see §1), 2026-07-26. Every
> number below was re-measured this session against the live DB unless marked otherwise; anything
> taken on report rather than measured here says so inline.
>
> **The fair is Aug 5–12. That is 10 days out.**

---

## 1. Git / deploy reality

- **PUSHED AND DEPLOYED — nothing outstanding. MEASURED, not inferred, 2026-07-26T14:47:04Z.**

  ```
  served (GET /api/health .commit)  ae50b7a   ← what is actually running
  local main                        ae50b7a   ← exact match
  ahead of origin/main              0
  ```

  Three sessions of work went out in this push, including both money-behaviour commits:
  `836259e` (logger.money — seven money outcomes had been deleted from the prod build) and
  `1a56a8d` (ghost-filter walk — three live revenue violations).

- **The served fingerprint is re-measurable from this shell.** Command that works, verbatim:
  `curl -s https://fair-synq.vercel.app/api/health`. **This corrects a claim that stood here for
  several sessions — that this shell cannot reach prod. It can.** The claim was inherited rather
  than tested: "cannot fetch" is true of *git* (`git ls-remote` → `Permission denied (publickey)`)
  and someone generalised it to "cannot reach prod", which made an easily-measured fact look
  unmeasurable and quietly closed off a check nobody retried. The git limitation is real and
  separate; the served value is the authority (**fingerprint-over-git-ref** — the local ref has
  been wrong twice). **Re-measure rather than trusting this block.**

- **THERE ARE TWO FINGERPRINTS. A matching web SHA says NOTHING about the worker.**

  | Field | Deployment | Source |
  |---|---|---|
  | `.commit` | web app (Vercel) | baked at build time, `next.config.mjs` |
  | `.checks.worker.commit` | worker (Railway) | written by the worker into Redis each sweep |

  `commit` was the *only* fingerprint, and it belongs to the deployment that was never in
  question — so a green health check with a fresh SHA was true in a narrow sense and misleading
  in a wider one, the same shape as `logger.info`, the ten-file guard list, and "this shell
  cannot fetch". **`fingerprint-over-git-ref` has to cover both deployments or it covers
  neither.** Added 2026-07-26; guarded by `test-health-guard [10]`.

  Read them as two facts:
  ```
  curl -s https://fair-synq.vercel.app/api/health | jq '{web: .commit, worker: .checks.worker}'
  ```
  `worker.commit: null` means a worker predating this feature (honestly unknown — never
  guessed, never the web SHA); `"unknown"` means it is running a build with no git provenance.
  The worker also now logs `[Worker] boot { commit }` at **console.warn** — there was previously
  no boot line at all under `NODE_ENV=production`, which is half of why the last push could not
  be confirmed from the logs: continuous sweeps with no visible gap look identical to "never
  deployed."

- **✅ MEASURED 2026-07-26T20:57Z — the fingerprint works, and it closed the `836259e` question
  on its first use.**

  ```
  web    .commit                8266510
  worker .checks.worker.commit  8266510   ← the worker's OWN SHA, self-reported
  local  HEAD                   8266510
  ```

  Three things this settles, none of which was answerable yesterday:
  1. **Railway does inject `RAILWAY_GIT_COMMIT_SHA`.** That was implemented as an *unverified*
     assumption (corroborated only by `next.config.mjs:11`), with `'unknown'` as the honest
     fallback. It returned a real SHA, so the assumption held — confirmed by use, not by faith.
  2. **The worker redeployed and is current.** Both deployments are on the same commit.
  3. **The worker IS running `836259e`.** `8266510` is a descendant, so the worker-side
     `logger.money` lines — the majority of them, and the whole point of that fix — are live.
     This had been open since the push and was previously answerable only from Railway's UI.

  Note the two fingerprints agreeing is now *evidence*, where before it was an assumption with
  nothing behind it. They can legitimately diverge (one deployment failing, or a worker-only
  rollback), and that divergence is the thing worth watching.

- **The vendor + organizer revenue corrections are LIVE** — both the earlier round and the three
  surfaces from `1a56a8d` (organizer fair list, organizer top-items, vendor Firebase tile). These
  are Vercel-side API routes, so the deploy above is sufficient proof for them. Organizer and
  vendor headline numbers DROPPED on 2026-07-26 as a result; that is the correction landing, not a
  regression. Anyone watching those figures should be told before they report it as a bug.
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

**Re-confirmed 2026-07-25T19:10:24Z — still green a day later**, `commit ee233ec` (§1),
`database ok`, `redis ok`, `worker ok` with `ageSec: 4`. The heartbeat is the point: a dead worker
looks exactly like a calm day from every other surface, so this is the one check that distinguishes
them. Both flags unchanged (`enforceVendorReadiness: false`, `previewBypass: true`), which
independently corroborates §6 items 6 and 10 rather than restating them from memory.

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
- **`flags`: `enforceVendorReadiness: false`, `previewBypass: `true`** (prod). Local `.env.local`
  sets `ENFORCE_VENDOR_READINESS=true` — a **known, deliberate divergence** (§6).
  *(Corrected 2026-07-26: this line read `previewBypass: false`, contradicting four other places in
  this file (`:100`, `:106`, `:426`, `:549`) and both live measurements. `true` is the measured
  value. The contradiction mattered: `previewBypass` gates **`POST /api/orders`** past
  `FAIR_NOT_OPEN` — `app/api/orders/route.ts:190` — not just UI, so a reader who landed on the
  wrong line would conclude the order-placement gate is closed when it is open. Inert until Aug 5
  (the fair is live and the gate passes anyway); it is §6's remove-after-the-fair item.)*

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

**Suite count: 72** (re-measured from `scripts/verify-all.ts`, 2026-07-25 — the stale figure here
was 64). Full gate green at last run: exit 0, zero `FLAKY`.

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

1. 🔐 **Rotate the Railway Redis credential — STILL OPEN, HARD-DATED BEFORE 2026-08-05.**
   *(Re-confirmed open 2026-07-25.)* The current password was **exposed in a chat transcript**.
   Railway has **no in-place rotation**: the fix is delete the Redis service and reprovision, then
   update `REDIS_URL` in Vercel *and* the Railway worker. **Not a config edit — a
   delete-and-reprovision**, so it has downtime and cannot be done in five minutes on the day.
   Follow the §2 ordering exactly (worker to zero FIRST, producer next, consumer last) — a
   half-updated pair is precisely the producer/consumer split that caused the prefix bug and cost
   an entire investigation.
2. **Stripe onboarding: 17 vendors, 4 runners, and 1 REAL organizer (+2 test rows) unconnected.**
   Longest lead, not code, cannot be compressed by working harder. §3.
   *(Corrected 2026-07-25: this read "3 organizers", which sends whoever picks it up chasing two
   test accounts during onboarding. The real outstanding organizer is one.)*
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
   **✅ ORGANIZER LEG PROVEN IN PRODUCTION — 2026-07-28.** The second leg, first execution ever:

   ```
   batch      cms3wdih00001yox74myfz0kl
   event      Italian Fest 2026        organizer  Feran Events (acct_1TxyVbHk5f8bm1bt)
   total      1298¢  (two OrganizerEarning rows, 649¢ each — batched per EVENT, as designed)
   transfer   tr_1TxyZ7Hk5f3uB8J9QR7oJ3zc
   created    2026-07-28T00:08:12Z  →  paid 2026-07-28T00:08:14Z   (2 seconds)
   ```

   Organizer connected at `00:07:27`; the batch formed and paid on the **next sweep**, inside the
   predicted ≤73s. Both `OrganizerEarning` rows → `paid` with `batchId` set. This empirically
   verifies, for the first time, the **batch machinery**, **set-membership** (exactly the unpaid
   window-closed rows for that event), the **reconciliation guard** (batch total === live covered
   sum) and **Pattern Q** — all previously structural-only.

   **✅ RUNNER LEG PROVEN IN PRODUCTION — 2026-07-28. ALL THREE LEGS ARE NOW PROVEN. This item's
   headline question, open since the doc was written, is CLOSED.**

   ```
   tr_3Tvl9NHk5f3uB8J900UakK3u  1150¢  order cmrv5vvly…  created 02:42:07Z
   tr_3Tw97XHk5f3uB8J91KiFYHNG  1150¢  order cmrwoqsms…  created 02:42:10Z
   sweep: repaired=2 [P2]   Pattern P alerts: gone   worker boot seam: ce33957
   ```

   **MONEY LANDED, not merely accepted — the two claims are different and both were checked.**
   The log proves Stripe accepted the call; the connected account proves it arrived:
   `acct_1TxtzrHk5fvDxyij` → **available 1150¢ + pending 1150¢**, two `payment` balance
   transactions with `net === amount` (no fee — correct: the vendor payout already absorbed the
   Stripe fee). Both transfers show `reversed=false`.

   Each transfer's `transfer_group` reads `order_grp_<uuid>` — **inherited from the charge**,
   which confirms the fix worked by its intended mechanism rather than merely stopping the error.

   **It was NOT an onboarding problem** — the runner had been connected since
   `2026-07-27T19:18:37Z` and passed every gate. Two real Stripe bugs sat behind it, and **neither
   was reachable structurally**:
   1. `transfer_group` conflict — the runner invented a group Stripe already owned (`a5cfaeb`).
      **No test could have found this**: it needs a charge that has *already been through a vendor
      payout*, so the group exists to collide with.
   2. Fixing (1) changed the request body under a **stable idempotency key**, so Stripe refused
      every retry (`ce33957`). **This bug was created by fixing the first one.** Key versioned to
      `_v2`; safe because `transfers.list` returned **0 transfers** — verified, not assumed.

   **This is the case for proving the legs on a test fair.** Both bugs were found only because the
   leg finally ran, and the second did not exist until the first was fixed. Discovering either on
   Aug 5 would have meant runners going unpaid during a live event.

   **Stripe is in TEST mode** (`sk_test_*`, confirmed 2026-07-28 from the live key) — so every
   transfer above is test-mode money, as §6 item 3 records for the vendor cohort.
5. 🔴 **The 100m delivery-GPS check DOES NOT EXIST — a documented control that was never built,
   on the chargeback-evidence path.** *(Found 2026-07-25. Decide before Aug 5.)*
   - `haversineMetres` (`app/api/orders/[id]/status/route.ts:61`) and `HOME_DELIVERY_GPS_RADIUS_M`
     (`lib/constants.ts:96`) are **orphaned — no call site anywhere in the repo.** Verified
     against `git show HEAD:` — pre-existing, not introduced by recent work. Both symbols are
     kept deliberately as the marker; deleting them would erase the only trace.
   - Meanwhile the route header claims *"requires proofPath + GPS for HOME_DELIVERY"* and
     `schema.prisma` documents `runnerConfirmedLat/Lng` as *"must be within 100m of address"*.
     Nothing enforces either. The route stores whatever coordinates it is handed, unvalidated.
   - **MEASURED: `runnerConfirmedLat` is set on ZERO orders, ever** (all 381). The one non-voided
     HOME_DELIVERY delivered order has a proof photo and no coordinates. The client *does* try —
     `app/runner/[fairSlug]/delivery/[orderId]/page.tsx:223-227` requests GPS best-effort with a
     5s timeout and sends `null` on denial — so capture is silently failing or being declined.
   - **Cost to implement: bigger than it looks, because the destination coordinates are not
     stored.** `Order` has `deliveryStreet/City/State/Zip` but **no destination lat/lng**, so
     there is nothing to measure 100m *from*. The data is one field away though:
     `app/_components/AddressAutocomplete.tsx:23` already requests `'geometry'` from Places and
     discards it. Full cost = migration (`deliveryLat`/`deliveryLng`) + persist the geometry at
     checkout + ~5 lines using the existing helper + make GPS non-optional or record why it
     failed. **This is a build, not a wiring-up.**
   - **Open question for the decision: is the proof photo alone sufficient dispute evidence?**
     3 open `dispute_clawback` debts total **$101.96** today (§6 item 8). See the report.
6. 🔬 **Profile the sweep — which pattern owns the 14s?** Unprofiled. At fair scale a sweep over 60s
   means overlapping sweeps on the same rows (§2).
7. **Remove the preview-bypass scaffold — AFTER 2026-08-05.** Full removal list in §7.
   ⚠️ **`ALLOW_PREVIEW_BYPASS` is currently `true` in prod** (`/api/health.flags.previewBypass:
   true`, re-measured), and it gates **`POST /api/orders`**, not just UI — `app/api/orders/route.ts:190`
   is what lets an admin past `FAIR_NOT_OPEN`. Leaving it on past Aug 5 is inert (the fair is live,
   the gate passes anyway), but it is live money-path config and should come out.
8. **Live-mode Stripe verification** (webhooks, real transfers). Not started. Local is `sk_test_*`.
9. **The books** (re-measured 2026-07-24): `refund_reversal` **46 events / $975.40** open,
   unclassified; `dispute_clawback` **3 / $101.96** open (Pattern K alerts; chase, no auto-deduct);
   legacy never-paid obligation **~$135.78** *(prior session, not re-measured)*.
   **`payoutStatus=FAILED` is `0`, and as of 2026-07-26 it is a DOUBLY vacuous zero.** Two
   independent reasons, and the second was not known when this note was written:
   1. **Nothing has executed.** The worker is live and the producer works, but no payout job has
      reached the failed handler, because nobody is connected to pay (§3). A `0` from a path that
      has not run is not evidence.
   2. **🔴 The marker path was INVERTED — so even once it runs, a `0` would not have meant what
      it says.** `order-worker.ts` gated the marker on `attemptsMade >= attempts`, and BullMQ
      5.76.8 fails an `UnrecoverableError` job WITHOUT exhausting attempts (`job.js:483` returns
      `[false, 0]` without touching `attemptsMade`; `:549` increments once). So a
      `PayoutReconciliationError` arrived with `attemptsMade = 1` against `attempts = 3` and
      **both** the `payoutStatus='FAILED'` write and the `PAYOUT_FAILED` audit were skipped.
      Transient blips that burned all 3 retries got durable markers; **ledger drift — the most
      serious failure this system raises — got a log line and nothing persisted.** Pattern U
      reads that audit for its failed-since timestamp, so the stuck-money reader was blind to it
      too. **FIXED 2026-07-26** — the gate now keys on finality
      (`lib/payout-failure-finality.ts`), guarded by `scripts/payout-failure-gate-guard.ts`,
      which keeps the OLD gate executable so the defect is demonstrated rather than asserted.

   **What this means for reading the number going forward:** a future non-zero `FAILED` count is
   now trustworthy, but a `0` still is not — reason 1 stands until payouts actually execute. The
   remaining four taxonomy items are unfixed (`docs/reports/failed-marker-taxonomy.md`), and two
   of them (fast-fail on unrecoverable Stripe errors; flipping `stripeVerified` on a dead
   destination) **share a prerequisite that does not exist yet: any Stripe error classification
   at all.** Grep for `resource_missing` / `StripeInvalidRequestError` / `rawType` across
   `lib/ workers/ app/api/stripe/` returns one unrelated hit. Written separately they would be
   one decision derived twice — the through-line class.
10. **`ENFORCE_VENDOR_READINESS` divergence** — `true` locally, `false` in prod, so the public site
   lists 17 vendors when **3** are transactable *(re-measured; was 2)*. Which number a customer
   should see: the connected count. Flipping it is a business decision; visible in `/api/health.flags`.
11. **Rename `RECONCILER_BACKSTOP_ENABLED`** — it gates Pattern N, not the payout backstops.

## 7. Known partials and open questions

- **✅ CLOSED 2026-07-26 — the five permanent Pattern X2 alerts. NOT a books discrepancy.**
  Read this before reacting to *"settled transfer … with NO VendorEarning row at all"*, which
  is alarming on its face and was not a leak.

  **The cohort, and why it cannot grow.** Five settled `Payout` rows, **$127.73**, 3 orders,
  2 vendors (`ALL PRO TEES`, `RANDY'S HOUSE OF BBQ`) on Italian Fest 2026. They **predate the
  `VendorEarning` model**. Measured:

  ```
  earliest Payout                        2026-06-04T05:05:24Z
  earliest VendorEarning                 2026-07-11T19:45:26Z
  settled payouts BEFORE that boundary            5   ← exactly the X2 set
  settled payouts AFTER  that boundary           83   ← all have earning rows
  ```

  A perfect partition. **There was never a row to lose** — the model did not exist when the
  money moved. Anything new arriving in X2 is therefore a genuine defect, not more of this.

  **It is TEST-MODE money in a test-mode Stripe account** — same cohort, same disposition as
  §6 item 3. Nothing to reconcile. Written down explicitly because the alert text reads like a
  books emergency to anyone who finds it later without the key-mode context, and because that
  is exactly the wrong thing to be re-deriving under pressure during the fair.

  **What was actually wrong was the alert, not the money.** X2 said *"Pattern S restores the
  row"*. That is false for the entire observable population, **by construction**: `patternS`
  runs at `reconciler.ts:207`, `patternX` at `:231` — same sweep, S first. An in-window order
  has already been re-accrued by the time X runs, so it cannot still be an orphan there. Every
  row X2 reports is one S already declined. The alert told a human to wait for a healer that
  had already walked past. Fixed: each line now states its own reason (out of S's 24h window,
  with the age; or voided). Guarded by `scripts/x2-referral-ack-guard.ts`.

- **`cmq0c60gf00012icnrmby6a15` — a DISPOSITION, not a repair. The void-after-payout shape,
  with a concrete instance.** $19.90 transferred **2026-06-05**; the order was **voided
  2026-06-20** (status now `PLACED`). `patternS` filters `voidedAt: null` **correctly** — you
  never re-accrue a struck order — so **no window width heals this one**, and widening S would
  not have helped. It is money that moved *before* the order was declared out-of-model. Test
  money here, so it costs nothing; the point of recording it is that §6 item 3 warns about this
  shape in the abstract and this is what it looks like in the data, **before it happens with
  real money.** No fix is owed. A decision is.

- **Pattern S was deliberately NOT widened** (recorded, do not re-open). Widening a
  money-*writing* pattern's reach across 53 days of history to repair a closed cohort of four
  rows that provably cannot grow is not a trade worth taking pre-fair. Asserted by
  `x2-referral-ack-guard [5]`, which fails if S's window or its `voidedAt: null` filter changes.

- **General lesson, worth applying beyond X2: a pattern that refers the reader to another
  pattern must say whether that pattern runs BEFORE or AFTER it in the same sweep.** X2's
  referral was not wrong about *what* Pattern S does — it was wrong about *when*, and that made
  a true sentence into a false instruction. The sweep's pattern order is load-bearing
  (`reconciler.ts:201` already says so for S-before-C/D) and cross-references have to respect it.

- **💰 "What a vendor is owed" has FIVE derivations, and the vendor-facing display never reads
  `VendorEarning`.** Walked 2026-07-28. Runner and organizer are single-sourced and correct —
  **do not "fix" them.**

  | Bucket | Sites |
  |---|---|
  | **Ledger** (`*Earning` as stored) | admin money `money/route.ts:90-105`; runner earnings `runners/me/earnings/route.ts:26`; fair reports `admin-fair-reports.ts:89-90`; sweep `payable=` |
  | **Stripe** (a real transfer) | `vendor-earnings.ts:71` — `payout.netAmount` |
  | **Recomputed at display time** | `vendor-earnings.ts` estimate branch; analytics `totalRevenue:161`; revenue chart `revenue/route.ts:117`; stats `stats/route.ts:152` |

  **Per leg, does the payee SEE the number the executor PAYS?**
  - **Runner — ✅ yes.** `runners/me/earnings` reads `RunnerEarning.amountCents`;
    `processRunnerPayout` transfers that value verbatim. One derivation.
  - **Organizer — ✅ yes.** No organizer-facing money surface exists; admin reads the ledger and
    the batch pays the ledger sum.
  - **Vendor — ❌ no.** The vendor sees `Payout.netAmount` or an *estimate*; the admin sees
    `VendorEarning.subtotalCents/netCents`; the executor computes its own slice. Three
    derivations, and **the vendor-facing path never touches `VendorEarning` at all.**

  **NOT being collapsed before the fair, deliberately.** `computeVendorOrderEarnings` is proven,
  and its `estimated`/`settled` split (never blended — `sumVendorEarnings`) is *better* UX than the
  raw ledger. Collapsing it is its own reviewed change, now that this is a test fair.

  The split math itself (`splitStripeFee`, `splitRunnerFee`) IS single-sourced in
  `lib/payout-split.ts`. The duplication is in the *display*, not the arithmetic.

- **🔴 THE GENUINE GAP: nothing compares a ledger row to the transfer it points at.** Pattern X2
  finds a settled transfer with NO earning row. **There is no inverse.** Nothing checks that
  `VendorEarning.netCents` equals the `Payout.netAmount` it references, or that
  `RunnerEarning.amountCents` equals its transfer. **A ledger row and its transfer could disagree
  by any amount and nothing would notice** — every number would remain perfectly consistent with
  itself and wrong. Deferred deliberately (new sweep work on a path that just got ~30% slower, and
  all three legs demonstrably pay the ledger today), but this is the check that would make a
  displayed number *trustworthy* rather than merely self-consistent.

- **✏️ CORRECTION — the vendor "revenue tile" was never rendered.** I told Feran that the
  ghost-filter fix (`1a56a8d`) would visibly drop the vendor's real-time revenue figure and to warn
  people. **Only the order COUNT changed.** `todayOrders` is rendered
  (`vendor/[fairSlug]/dashboard/page.tsx:946`); `todayRevenue` was written from four places and
  read from none — no JSX, no derived value, no conditional. The Firebase push computed a gross
  aggregate on every vendor-status change for a number nobody could see. Deleted 2026-07-28, which
  also removed the second of two gross-revenue copies (the surviving one,
  `stats/route.ts:152`, IS consumed).

- **✅ CLOSED 2026-07-28 — reconciler-side payout failures now leave a durable trace, with a
  cause and a way back.** Pattern P/Q caught every failure into an alert STRING; two terminal
  Stripe errors did that for EIGHT DAYS and were found by a human reading a log scroll.

  **The new-action-string design was REJECTED — do not re-derive it from the old note.** An
  earlier scoping proposed `RUNNER_PAYOUT_FAILED` / `ORGANIZER_PAYOUT_FAILED` by analogy with
  `TIP_REFUND_FAILED`. That analogy does not hold: tip-refund had **no marker at all**, whereas
  runner and organizer already have markers that **Pattern U already reads**
  (`reconciler.ts:1374`, `:1383`). Inventing new strings would have created a second vocabulary
  for an existing state, and Pattern U would not have read it. The markers were never missing —
  they were unreachable, because `recordPayoutFailure` lived in the worker, took a BullMQ `Job`,
  and was not exported. Extracted to `lib/payout-failure-marker.ts`; both paths now write it.

  **Pattern U surfaces reconciler-side failures for the first time.** Its three inline queries
  became `lib/stuck-payouts.ts`, called by BOTH the pattern and the admin money route — Pattern U
  applies its own age threshold and passes no `eventId`; the route passes one.

  **CAUSE, not just state.** The audit `reason` describes the MECHANISM ("halted unrecoverably")
  and both eight-day failures said exactly that with unrelated causes. The classified verdict,
  Stripe `type`/`code` and the raw message now ride in the audit's `metadata` (Json — no schema
  change). ⚠️ `stripeMessage` is Stripe-authored text: render escaped, never as markup.

  **Terminal ONLY.** `terminal` → mark + stop; `transient`/`unknown` → keep retrying, unchanged.
  `unknown` deliberately keeps its retries — misclassifying toward terminal strands money that
  would have moved.

  **The retry is what makes the marking safe, not a nicety.** Marking sets `status='failed'`,
  which removes the row from the candidate query. Under the marking alone, both eight-day rows
  would have been marked on the first attempt, the fix would have deployed, and **nothing would
  have happened** — they no longer qualified, and a hand-edit would have been needed to get paid.
  `POST /api/admin/events/[id]/money/retry-payout` returns the row to the candidate set
  (runner → `tracked`, organizer batch → `pending`) and **executes no payout**: the sweep does the
  money, so there is no second code path to it. Fair-scoped by `requireAdminFairContext`, every
  lookup keyed by `event.id`, and it writes a `RELEASE` audit attributed to the admin.

  **Scope decision, recorded:** the failed-payout list is **per-fair**, not platform-wide. The
  admin money page runs through the chokepoint, and `p6-admin-fair-chokepoint-proof` asserts
  exactly ONE unscoped fair resolve exists in the codebase — a platform-wide list there would
  need a second. `findStuckPayouts` takes an OPTIONAL `eventId` so a future super-admin view
  costs nothing new. Known cost: a failure on a fair you are not viewing is not on that page (it
  is still in the sweep alerts). Acceptable with one live fair; revisit for concurrent fairs.

- **✅ CLOSED 2026-07-28 — `[Reconciler] BACKSTOP WARNINGS` no longer cries wolf on the designed
  path.** `reconciler.ts` asserted *"any repair means a primary path leaked"* of EVERY pattern
  unconditionally, so `repaired=2 [P2]` produced *"Pattern P repaired 2 — a real-time path is
  leaking; investigate."*

  **It fired on BOTH proving runs and neither of us noticed** — the organizer batch at 00:08 and
  the runner payouts at 02:42, the two most important successful sweeps this project has had.
  That is the evidence for why precision matters here rather than an argument about it: this is
  the block where a genuine Pattern C/D leak would surface *during* the fair, and a warning that
  cries wolf on the designed path trains the reader to skip it.

  **Fix: every pattern declares its kind** (`PATTERN_KIND`), rather than an exception list — a
  new pattern must now choose instead of inheriting the wrong default.
  - `backstop` (12: A B C E F G H I N S T X) — repairing means a real-time path leaked. Warns.
  - `designed` (2: **D**, **R**) — repairing IS the primary path. D drains a hold that exists
    *because* the vendor was unconnected; R executes tip refunds, which have no per-order
    enqueue at all. A warning here would be a false statement.
  - `mixed` (2: **P**, **Q**) — genuinely both, by their own docs, and **not distinguishable from
    stored state**. They stay LOUD with honest either/or wording, because silencing them could
    hide a dropped enqueue. The bias is deliberate: mislabelling a backstop as designed silences a
    real leak; the reverse is only noise.

  **↪ Follow-up, not built:** P/Q *could* be resolved exactly, using `stripeConnectedAt` — if the
  payee connected AFTER the earning's refund window closed, the sweep paying it is definitionally
  pay-on-connect, not a dropped enqueue. Cheap and available, but it needs the reconcile summaries
  to report a per-row reason, which is a wider change than this one. The warning text names the
  check so a human can run it by hand today.

  Guarded by `scripts/backstop-warning-guard.ts` — whose load-bearing half is that every genuine
  backstop STILL warns, since a fix that silenced everything would pass a naive test.

- **🔴 FOURTH TEST-POLLUTION INCIDENT — 76 fabricated `Payout` rows, found 2026-07-28 by the new
  transfer-existence check on its first run. NOT CLEANED UP; the decision is open.**

  **⚠️ NO REAL MONEY IS IMPLICATED.** Stripe has always been in TEST mode. What is at stake is
  **ledger correctness going into the real fair — not a debt.** Nobody is owed anything.

  **What they are, measured — not inferred from dates or amounts:**
  - The **ORDERS ARE REAL**: all 76 carry a `stripePaymentIntentId` AND a `stripeChargeId`, and
    every sampled PaymentIntent resolves in Stripe. They are the operator's own manual test
    orders through the real checkout (`customerName: 'Refund Test'`, one Clerk user).
  - The **PAYOUT ROWS ARE FABRICATED** — `tr_` + 8 random chars, written by a test suite's Stripe
    spy running against production.
  - **38 of the 76 orders ALSO have a genuine payout**, so these are duplicate rows layered on
    real ones, not a phantom order set.

  **The headline is 95.4% fabricated.** Every paid `VendorEarning`, by what its own
  `stripeTransferId` resolves to:

  ```
  backed by a LIVE transfer :  7 rows,  14,479¢   ($144.79)   ← actually settled
  backed by a DEAD id       : 76 rows, 301,834¢ ($3,018.34)   ← fabricated
  TOTAL paid                : 83 rows, 316,313¢ ($3,163.13)
  ```

  So `paid=$3,163.13` — quoted repeatedly as evidence the vendor leg was working — is really
  **$144.79**. Every surface reading `VendorEarning.status='paid'` inherits this: the admin money
  page, the sweep summary `paid=`, and `admin-fair-reports`. The vendor-facing display does NOT
  (it reads `Payout.netAmount`/estimates — see the five-derivations entry above), which is its own
  divergence.

  **✅ THE JUL 25 VENDOR-LEG PROOF STANDS — verified explicitly.** All four payouts from that day
  resolve in Stripe (`tr_3Tw9RpHk…`, `tr_3TwpqWHk…`, `tr_3TwqT1Hk…`, `tr_3TwqUkHk…`, $53.98
  total, 00:33→01:19). The pollution is 2026-07-12→17 and does not touch it. **"All three legs
  proven" is unaffected.**

  **↪ OPEN DECISION — two candidate end states, neither taken:**
  1. *Cancel the earnings + delete the fabricated payouts* — if the money never should have been
     considered settled.
  2. *Return the earnings to `accrued`* — they are real orders, so the accrual may be legitimate
     and only the SETTLEMENT is false.
  A delete is not a delete: removing a `Payout` while leaving its `VendorEarning` at `paid`
  creates the X2 condition in reverse. Any cleanup must also consider `RunnerEarning`,
  `OrganizerEarning`, refunds and chargebacks on those orders.

  **§6 item 3's precedent does NOT transfer.** It declined to clean up test orders because
  *voiding does not reverse settled transfers* — the money had genuinely moved. **Here nothing
  settled**: there is no transfer to reverse, which removes the reason that decision existed.
  Different case; the conclusion is genuinely open rather than inherited.

- **✅ THE DURABLE HALF IS LANDED — `lib/transfer-existence.ts` + `scripts/transfer-existence-audit.ts`.**
  Asserts every stored transfer id resolves in Stripe. This is the inverse of Pattern X2 and it
  would have caught all four pollution incidents on the day each happened.
  - Bulk `transfers.list` (69 transfers, one 792ms call) — ~11× cheaper than per-row `retrieve`.
  - **NOT a reconciler pattern**, deliberately: it needs the network and the 60s sweep has no
    network dependency, so a Stripe outage must not read as a sweep failure. Hand-runnable plus
    admin-triggered.
  - **Membership is ABSENCE FROM STRIPE, never id shape.** Shape is corroboration only; the two
    partitions agree on all 143 rows today and a disagreement is reported as a finding.
  - ⚠️ **A DATE WINDOW WOULD HAVE BEEN UNSAFE and was nearly shipped.** 34 LEGITIMATE payouts
    fall inside the polluted rows' 2026-07-12→17 range, so a window would have silently
    suppressed real rows from a money check. The acknowledged set is 76 EXPLICIT transfer ids;
    `transfer-existence-guard [3]` fails if a date rule creeps back.

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
- **Option B — collapse the per-vendor transition table into the aggregator. POST-FAIR, still owed.**
  Commit A closed the *reachable race* (contested-guard writes); it did **not** remove the
  *duplicate derivation*. Different jobs. The inventory as it stands:

  | table | file:line | governs |
  |---|---|---|
  | `CUSTOMER_TRANSITIONS` | `app/api/orders/[id]/status/route.ts:49` | `Order.status` (checkout confirm) |
  | `RUNNER_TRANSITIONS` | `app/api/orders/[id]/status/route.ts:54` | `Order.status` (runner) |
  | **`ALLOWED_TRANSITIONS`** | **`app/api/orders/[id]/vendor-status/route.ts:17`** | **`VendorOrderStatus.status` — the live vendor path** |
  | `MASTER_RANK` / `canAdvance` / `WRITE_GUARD` | `lib/reconcile-order-status.ts:52,194,306` | `Order.status` (the aggregator) |

  *(`VENDOR_TRANSITIONS` was a fifth; deleted in Commit A along with its dead route branch.)*
  **B = promote `ALLOWED_TRANSITIONS` into a `VENDOR_RANK`/`canAdvanceVendor` pair mirroring
  `MASTER_RANK`/`canAdvance`.** Deferred because it touches `DECLINED`, which is refund-eligibility
  (`payableVendorIds`, `lib/process-payout.ts:129`) — a larger change to the money path, unreviewed,
  days before the event, is the trade not to take. `scripts/status-write-guard.ts` [3] pins the
  inventory meanwhile, so a *new* table cannot appear quietly.

- **Fix 3's race is NARROWED BY NOTHING — closure is Pattern X, deliberately. POST-FAIR proper fix.**
  `lib/process-refund.ts:241` now reads `paidRow || earning.status === 'paid'`, but **both signals
  are written AFTER the Stripe transfer** (`process-payout.ts:406` transfer → `:420` Payout row →
  `:445` earning), so a refund landing in the ~500ms window still decides CASE 1 and leaves the
  transfer standing. **The proper fix is a nullable `Payout.stripeTransferId` + a pre-transfer
  pending row** (migration). It was NOT done now because the alternative — reserving the earning
  pre-transfer via a new `'paying'` status — ripples a new vocabulary through
  `computeLedgerBreakdown` (a `'paying'` row silently drops out of payable), `classifyVendorSlice`,
  and Patterns C/D/S/T, and a row stuck in `'paying'` after a crash would be invisible to every
  reader. **Detected-reliably beat made-impossible-by-a-rushed-state-machine.**

- **Audit corrections — the second-pass audit was wrong in two ways that must not be re-inherited.**
  1. Its cited line for the TOCTOU (`app/api/orders/[id]/status/route.ts:324`) was a **DEAD PATH** —
     no caller in the repo; the vendor dashboard uses `/vendor-status`
     (`app/vendor/[fairSlug]/dashboard/page.tsx:79`). The reachable instance was **one route over**,
     on `VendorOrderStatus`, not `Order`.
  2. It framed the class as **worker-induced. It is not.** Two vendor taps race each other with no
     sweep involved, so this has been live since long before the worker started. The worker
     *widened* the window; it did not create it. Findings #3 and #4 *are* genuinely worker-induced.

- **✅ CLOSED 2026-07-25 — THE LIVE WORKER NO LONGER THREATENS THE TEST GATE. The
  scale-the-worker-to-zero discipline is RETIRED. Do not keep doing it.**

  *The section is kept, not deleted: it is why the isolation work happened, and a reader who
  finds no trace of it will re-derive the whole thing from scratch.*

  **What it used to say.** Suites seeded into the shared **prod** DB and the 60s sweep mutated
  their rows mid-run, so a money suite could fail and the gate still read green. The interim
  workaround was to scale the Railway worker to zero before any full gate.

  **Why it is closed — by CONSTRUCTION, not by a run of clean gates.** There is no longer a
  shared database for the two to race over. Measured inside a real gate run:

  ```
  DATABASE_URL      → localhost:55432 / fairsynq_test
  DIRECT_URL        → localhost
  TEST_DATABASE_URL → localhost
  lib/db redirect   → localhost:55432        ← the load-bearing one
  ```

  That last line is the one that matters and the one worth re-checking if this is ever doubted:
  suites seed through `testPrisma()`, but the **code under test** writes through `lib/db`. Had
  `lib/db` resolved to prod, the structural argument would have been false no matter how many
  clean gates ran. It doesn't. Two independent refusals enforce it — `scripts/with-test-db.sh`
  pins all three variables from one value and refuses a non-local host, and `lib/test-db.ts`
  refuses independently with no fallback to `DATABASE_URL`. The worker operates on prod Supabase
  and cannot see the test container.

  **Deliberately NOT the evidence for closing this:** "N consecutive clean gate runs." Against a
  1-in-8 flake, three clean runs happen by luck ~65% of the time. Counting runs could never have
  distinguished *closed* from *lucky*; resolving the connection string settles it in one command.

  **STILL IN FORCE — judge a gate run by exit code AND zero `FLAKY` lines.** This was never
  really about the worker. `verify-all` retries and exits **0** while printing
  `⚠️ FLAKY (passed only on retry)`, so a pass-on-retry can still hide a real failure from any
  other cause. Keep reading both.

  **HISTORY, so the original finding is not lost:** on 2026-07-24, with the worker live and
  suites on the shared prod DB, `c1-admin-money-control` failed **1 run in 8**; with the worker
  at zero, **4 consecutive clean runs** (65/65 gate + 3 isolated, 94 assertions each). Accurate
  when measured. No longer live — the mechanism it measured is gone.

  **The nine suites — no longer at risk from the worker, but two carry a latent weakness.**
  Group (A) is fully resolved: the race needed a shared DB.

  *(A) Seeds AND drives the reconciler — RESOLVED, no shared DB to race over:*
  `c1-admin-money-control-test.ts` (4 × `runReconciliationSweep`) · `reverser-pattern-t-guard.ts` (1)
  · `test-phase6-backstop.ts` (1) · `b2-runner-payout-test.ts` · `b3-organizer-payout-test.ts` ·
  `b4-tip-refund-test.ts` (the last three call `reconcileRunnerPayouts` / `reconcileOrganizerPayouts`
  / `reconcileTipRefunds` directly)

  *(B) ⚠️ Seeds AND asserts on an UNSCOPED aggregate — demoted from 🔴, not deleted:*
  `organizer-bootstrap-test.ts` (`orgMember.count`) · `runner-onboarding-proof.ts`
  (`runner.count` before/after). **This fragility is independent of the worker.** A global
  count before/after is broken by *any* concurrent writer — a second suite, a parallel gate, a
  developer with a REPL open on the test DB. Isolation removed the writer that was actually
  hitting them; it did not make the assertions correct. Scope them to their own fixtures when
  either is next touched. `c1-admin-money-control-test.ts` was already hardened this way
  (scoped to `actorType: 'admin'`, `:392`) and is the pattern to copy.

  **🔴 OBSERVED 2026-07-26 — this stopped being theoretical.** The new
  `x2-referral-ack-guard` went **FLAKY on a gate run** with exactly this shape: it asserted
  `supp.length === 1`, a **global** count, while `patternX` scans *every* `Payout` row in the
  database — and several suites (`test-refunds`, `verify-chargeback`, `verify-case2-branches`,
  `verify-refund-matrix`, `admin-reports-test`) legitimately leave settled payouts with no
  earning behind them. Whether it passed depended on **which suites had run first**. It could
  not be reproduced in 8 subsequent runs (3 gates + 5 isolated), so the fix was NOT "run it
  again until clean" — counting clean runs cannot distinguish *fixed* from *lucky* (same
  argument as the isolation closure above). The assertion was rescoped to the suite's own
  seeded rows, removing the class of dependency rather than the symptom.

  **What this proves about (B):** isolation removed the *worker* as a concurrent writer, but
  **the rest of the gate is also a writer**, and these two suites still count globally against
  a DB that 70+ other suites seed. The failure mode is no longer predicted — it has now been
  watched. `organizer-bootstrap-test` (`orgMember.count`) and `runner-onboarding-proof`
  (`runner.count` before/after) carry the identical defect and are still unfixed.
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

Flushed 2026-07-24; re-filling below as new disciplines are earned. Promote them rather than
deferring across sessions again.

- **`a-control-that-crashes-proves-less-than-one-that-fails`** *(earned 2026-07-26)*. The
  existing rule — a negative test needs a positive twin, or the negatives pass vacuously —
  is necessary but not sufficient. **A twin that ABORTS tells you nothing about the assertions
  downstream of it.** Observed: running `x2-referral-ack-guard`'s positive control (delete an
  entry from `ACKNOWLEDGED_X2`) threw a `TypeError` on `supp[0].includes(...)` against an empty
  array, killing the process before `[2]`–`[5]` ever reported. The run *looked* like evidence
  and was not — you learn only that something broke, not which assertions still hold. Fixed to
  degrade cleanly (`(mine[0] ?? '')`), after which the same control reported a legible
  `12 passed, 7 failed` naming exactly which properties depend on the entry.

  **Same family as the vacuous zero:** an output shaped like a result that carries no
  information. Rule: a positive control must leave every other assertion in the suite still
  running and still reporting.

- **`prisma-not-undefined-is-a-no-op`** *(earned 2026-07-28)*. `where: { x: { not: undefined } }`
  does not filter — Prisma drops it and the query matches EVERY row. It silently turned a
  "rows with a transfer id" query into "all 140 rows", and produced a *correct* answer for the
  wrong reason, so nothing looked wrong. Use `{ not: null }` on nullable columns.

  Same family as the NULLS FIRST finding: **a query shape that returns something true-looking
  about rows you did not mean to ask about.** The tell is that the count is plausible, so it
  passes review. Adjacent to the vacuous zero — the output has the shape of an answer.

- **`scope-assertions-to-your-own-fixtures`** *(re-earned 2026-07-26, now with an observed
  instance — see §7 group (B))*. A global count in a suite is broken by any other writer, and
  in a 73-suite gate the other writers are the other suites. Assert over rows you seeded, never
  over a whole table.
