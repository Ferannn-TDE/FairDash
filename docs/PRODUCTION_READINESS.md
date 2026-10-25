# FairSynq Production Readiness Plan

**Target:** launch-ready by **Fri Feb 12, 2027** (assumption: no fair is booked yet; replace with a real fair date when one exists).
**Agreed:** 2026-10-18, through a design interview (decision log at the bottom).
**Progress:** the Done column is generated. After checking items off, run `npx tsx scripts/readiness-progress.ts --write`. The gate fails if the table is out of date.

| Phase | Window | Done |
|---|---|---|
| 0. Safety close-out | Oct 19 – Oct 25 | 6/6 |
| 1. Money & trust bugs | Oct 26 – Nov 29 | 52/53 |
| 2. Ops foundation | Nov 2 – Dec 13 | 0/26 |
| B. Business & legal readiness (track) | Nov 2 – Jan 10 | 0/14 |
| 3. Design foundation | Nov 30 – Dec 20 | 1/12 |
| 4. Customer portal | Dec 21 – Jan 3 | 1/12 |
| 5. Email platform | Dec 14 – Jan 10 | 0/20 |
| 6. Vendor portal + onboarding | Jan 4 – Jan 17 | 0/12 |
| 7. Organizer core + earnings card | Jan 11 – Jan 24 | 0/10 |
| R. Cutover rehearsal | Jan 18 – Jan 24 | 0/4 |
| 8. Runner portal + onboarding | Jan 25 – Jan 31 | 0/9 |
| 9. Live cutover | Feb 1 – Feb 5 | 0/21 |
| Buffer | Feb 6 – Feb 12 | — |

## Capacity

- **Oct 18 – Dec 15: light.** Final undergrad semester and finals.
- **Dec 16 – Jan 3: medium.** Graduation and the holidays.
- **Jan 4 – Jan 11: heavy.**
- **Jan 12 onward: medium.** Spring grad semester starts.
- **Feb 6 – Feb 12 is a buffer week.** Nothing is planned in it. It absorbs slips; it is not extra scope.

## Slip order

If time runs short, cut in this order and no further:

1. Runner portal **design migration** (Phase 8). Its P0/P1 fixes stay.
2. P2/P3 **styling** on the vendor and customer portals (Phases 4, 6). Their P0/P1 fixes stay.
3. The organizer **earnings card** (Phase 7).

**Never cut:** Phase 1 money items, monitoring (Phase 2), legal pages and Stripe activation (Track B), the cutover dry run (Phase 9). If cutting the three items above isn't enough, **move the launch date** instead of cutting any of these.

Inside the light-capacity window, if November slips, Phase 3 moves later, not Phase 1. Phase 4 then starts on whatever primitives exist.

## Standing rules (apply to every phase)

- **Column removal is expand/contract.** First a deploy where no code reads or returns the column (removed from the Prisma model, database untouched). Then a later, separate migration drops it. Web and worker instances overlap during deploys.
- **One event never sends two emails.** The guard is a unique `EmailLog` row per `(template, entity)`, not timing or a BullMQ job id.
- **External calls are bounded.** Every Stripe, Resend and Google call has a timeout. On timeout the action fails closed with a clear message; it never skips a check.
- **Guards don't read the clock.** Date-dependent tests pin fixed instants.
- **Every definition of done names its environment:** local Docker stack (anything needing the worker), staging, or production.
- **Touch each page once.** Audit fixes and design migration happen in the same pass.
- **A migration is applied to every database in the same session.** Local dev (`npm run dev:db:migrate`), test (the gate rebuilds it from the schema on every run) and production (`CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx prisma migrate deploy`), then `npm run db:drift` and a production `migrate status` both show nothing pending. `npm run dev` warns first when the dev database is behind. *(2026-10-20: PayeeNotice reached production and test but not dev, and the walkthrough hit a missing table.)*
- **Money changes get a sealed production dry run before their first deploy.** Template: `scripts/owed-back-dry-run.ts` (read-only Postgres session, Prisma writes and Stripe money calls blocked, every seal proven by a control first, plus a positive control showing the probe can see real orders). List every order the first live run would touch, with amounts, and get approval on that list before migrating or pushing. 1.2 is why: 77 passing tests missed a retroactive refund that the dry run found.

---

## Phase 0: Safety close-out (Oct 19 – Oct 25)

The local-off-production work shipped in `72582db` (`lib/prod-db-guard.ts`, Docker dev stack, `CONFIRM_PROD_DB`). This phase closes the remaining gap.

- [x] Audit the 42 scripts in `scripts/` that write to the database without importing the guard. Each one either uses `lib/db.ts` or calls the guard directly. *(2026-10-18: all 42 go through `lib/db` or `guardedPrisma`, or are static source scanners that never connect. No raw `pg` clients anywhere; nothing in `tests/` or `app/` builds its own client.)*
- [x] Add a gate check that fails when any script constructs its own `PrismaClient` without the guard. *(Already existed as `prod-db-guard-test.ts [3]`; tightened so a guard that is only a comment, or is called after the client, fails. Positive-controlled with a planted file.)*
- [x] Record `72582db` + `scripts/prod-db-guard-test.ts` as the proof of isolation.
- [x] **Oct 21:** after the Supabase reset, re-run the bucket settings check on the current project (future staging) and do one upload pass. *(2026-10-24: Storage serves reads; bucket settings now come from `lib/storage-buckets.ts`, applied with `scripts/apply-bucket-config.ts` (adds the allowed-type lists; re-read matches). Upload pass done 2026-10-24: one menu photo on the test fair through the real vendor flow landed as a 75 KB JPEG, publicly readable, then deleted.)*
- [x] Clerk guard (`lib/prod-clerk-guard.ts`, `scripts/prod-clerk-guard-test.ts`): a local process refuses the production Clerk instance's keys (today `noble-tahr-47`, the instance www runs on) unless `CONFIRM_PROD_CLERK=<host>`. The proxy serves a 503 locally, and every script that builds a Clerk client is guarded and scanned. *(2026-10-19, after opening localhost `/onboarding` wrote to a real user's Clerk metadata and the webhook carried it into production.)*
- [x] **You:** create a separate Clerk development application for localhost and put its keys in `.env.local` (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`). Until then the local dev server refuses every request. *(Done 2026-10-19: `ready-zebra-3552`; confirmed 2026-10-24 that the `.env.local` publishable key decodes to that instance.)*

**Done when:** the gate check fails on an unguarded fixture script and passes on the real tree. Verified locally.

---

## Phase 1: Money & trust bugs (Oct 26 – Nov 29)

### 1.1 Delivery radius enforcement
`homeDeliveryRadiusKm` exists but nothing reads it at order time, and delivery addresses carry no coordinates.

- [x] `POST /api/orders` geocodes the stored street/city/state/ZIP **on the server**, pinned to the ZIP (`components=postal_code:…`). Coordinates from the browser are never trusted. *(Changed from `place_id`: checkout keeps fields editable and dorm addresses are often typed, so a `place_id` is often missing or stale.)*
- [x] New server-only key `GOOGLE_GEOCODING_API_KEY`, restricted to the Geocoding API (no referrer restriction, never `NEXT_PUBLIC`). The browser Maps key stays referrer-restricted. *(Code reads it and the guard enforces server-only; **you** create it in Google Cloud and set it on Vercel Production + Preview. Until then, home-delivery orders are refused.)* *(2026-10-20: live on www; the delivery checks returned real distances. Local `.env.local` copy was pasted twice and is fixed.)*
- [x] Straight-line (haversine) check from `eventLat/eventLng` to the address against `homeDeliveryRadiusKm`, **before** the PaymentIntent is created.
- [x] The same check runs when the address is picked at checkout, for early feedback. The order route remains the authority.
- [x] Copy says "within X km of the fair (straight-line distance)" in the checkout error and in the radius setting.
- [x] Store `deliveryLat/deliveryLng` on the order, plus `deliveryGeoPrecision` (Google `location_type`); approximate results are accepted and the runner view says "Location approximate". No backfill of old orders.
- [x] Fail closed on config: home delivery can't be enabled unless the fair has coordinates and a radius. Shown as a fair-readiness item.
- [x] Geocoding call has a timeout. If Google is unreachable, the order fails with "We can't verify your address right now. Try pickup or retry."
- [x] Test matrix (`scripts/delivery-radius-guard.ts`, 62 checks, mutation-tested): Springfield fair + Edwardsville address rejected with no PaymentIntent; in-radius accepted; missing `place_id` rejected; fair without coordinates has no home delivery; geocoder timeout rejected.
- [x] ZIP fallback *(2026-10-20; live check on www found campus ZIP 62026 returns nothing, even for SIUE's own address)*: when the ZIP-pinned search is empty, search again unpinned and accept the top result only in the typed ZIP or city (and the typed state). Fallback points are always approximate; the order keeps the address as typed. Guard [12]: Cougar Village 62026 and 1 Hairpin Dr 62026 found and approximate; another city, or the same city name in another state, rejected; the existing matrix unchanged. 5/5 mutations killed.

### 1.2 Delivery fee on cancel-before-pickup (CURRENT_STATE #18)
Policy: refund the delivery fee on any cancel where no runner earned anything (no `RunnerEarning`), whoever cancelled. On a multi-vendor order, only when every vendor portion is cancelled. Service fee stays non-refundable.

- [x] Fold the delivery fee into Pattern R (`lib/tip-refund.ts`): one "delivery & tip" refund per order, same gate. New key `owed_back_${orderId}`; `tipRefundId` stays the marker; `deliveryFeeRefundCents` itemizes. Curbside fee included.
- [x] Key-independent ceiling: read the charge and every refund on it (all pages) from Stripe; refund only tip + fee minus earlier owed-back refunds (by metadata label), and halt if the charge has less room than that. Never a partial refund.
- [x] Halts are durable (`OwedBackHalt`), shown on the admin money page (banner + "Refunds stopped" tab) until resolved. Admin "Mark resolved" needs a note, writes an audit row, and never refunds.
- [x] No retroactive fee refunds: the fee is owed back only for cancels at or after `OWED_BACK_FEE_FROM` (2026-10-19T00:00Z); earlier cancels keep the tip-only rule. Halt rows use `ON DELETE RESTRICT`.
- [x] Sealed dry run against production (`scripts/owed-back-dry-run.ts`: read-only Postgres session, Prisma writes and Stripe money calls blocked, controls first). First sweep: 0 orders. Cutoff keeps out 1 historic fee-only order (Italian Fest, Jul 21, $12.99), which the probe confirms would otherwise have been refunded.
- [x] Reconciliation test (`scripts/b4-tip-refund-test.ts`, 90 checks, 24/24 mutations caught): auto-cancelled order refunds food + delivery + tip to the cent; a partially cancelled multi-vendor order refunds no delivery fee; an order with a `RunnerEarning` refunds neither; old tip refund with a lost marker refunds the fee only; >10 and >100 refunds on a charge.
- [x] Update `/refund-policy` to state the rule.
- [x] Known trade-off: a runner who accepted but hadn't picked up gets nothing. Revisit if runners complain.
- [x] Apply the migration (`20261019120000_add_owed_back_fee_refund`) to production, then deploy. Done 2026-10-19 (a35cc68); first sweep 0 refunds, 0 adoptions, 0 halts, matching the dry run.

### 1.3 Refund and order display
- [x] Order page shows the tip as its own line. Total = itemized lines.
- [x] Order page shows each refund part as it lands ("Food refunded $35.00 · Delivery & tip refunded $15.99").
- [x] One shared itemization helper (`lib/order-itemization.ts`) feeds the order page and the organizer order detail. The receipt and refund emails (5.2) must use it too.
- [x] `GET /api/orders/[id]` returns refund state derived from COMPLETED `Refund` rows through the helper the organizer route uses.
- [x] Expand step: remove `Cancellation.refundIssued` and `refundAmount` from the Prisma model and every response. (Contract step is in Phase 9.)
- [x] Grep guard (`scripts/order-itemization-guard.ts`): nothing in `app/` or `components/` reads `refundIssued`/`refundAmount`.

### 1.4 Payout-status limbo + Connect webhook
Root cause: `StripeConnectCard` maps "onboarding complete but transfers not active yet" to "Payout setup unfinished" and reads status only once.

- [x] Add a `verifying` state: "Verifying with Stripe, usually under a minute", no "finish setup" button. (Verifying = nothing due from the payee, transfers not active yet.)
- [x] Poll `/status` while verifying: every 3s for 30s, then every 15s up to 5 min, then "Still verifying. This page updates on its own; you can leave and come back." with a cached 60s refresh. (Email promise waits for Phase 5.) `?fresh=1` is honoured only for the payee's owner, within the per-user `connectStatusFresh` limit, fail closed.
- [x] `StripeConnectCard` is the single owner for vendor, runner and organizer. Delete the duplicate in `app/vendor/[fairSlug]/settings/page.tsx`.
- [x] Show `currently_due`/`past_due` requirements in plain English ("Stripe needs: ID document").
- [x] `app/api/stripe/connect-webhook`: conditional update (`stripeVerified` false→true via `updateMany`). Only `count === 1` triggers the "payout setup complete" email. One writer (`lib/connect-status.ts`) for the webhook and all three `/status` routes; the notice is a `PayeeNotice` row until Phase 5 sends it (migration `20261020120000_add_payee_notice`).
- [x] `stripeConnectedAt` is set once, at that transition, not on every event.
- [x] True→false transition schedules a delayed job (~10 min) that re-reads live status and sends "payout setup needs attention" only if still restricted. The gate itself closes immediately.
- [x] Return 500 on internal errors so Stripe retries. Signature failures stay 400; unknown event types stay 200.
- [x] Tests: same event replayed ×3 gives one status change and one email job; a database failure returns 500; all four card states render. (`connect-status` 80 checks against the test DB incl. the real runner executor; `connect-card` 38; 13/13 mutations killed. Sealed production dry run `scripts/connect-dry-run.ts`: 9 payees, 0 transitions, 0 notices, 0 re-checks.)
- [x] Walkthrough GIF of return-from-Stripe for vendor, runner and organizer. *(2026-10-20, local stack: all three reached "Payouts active" and opened their gate once. The vendor run caught the card freezing on "Verifying" after one poll; fixed in 6b94083, runner and organizer then updated without a reload.)*

### 1.5 Tracking map centering (basic fix)
- [x] Center on `deliveryLat/Lng` when present, otherwise on the fair coordinates. Never the world view. *(Cause: the embed was sent free text such as "Fair grounds" or "<vendor> booth 12". Now `orderMapCenter` in `components/order/helpers.ts` always sends coordinates; guard `order-map-center`, 15 checks.)*
- [x] No coordinates at all: show no map rather than a globe.

### 1.7 Rate limits that match their policies
`lib/ratelimit.ts` built one shared limiter (30/min), so the per-policy numbers in `RATE_LIMITS` were never read. Found while planning: order creation, cancel and the public vendor read were keyed by **IP**, so a fair crowd on one Wi-Fi or carrier IP shared one bucket. The `login` policy had no caller: sign-in goes through Clerk.

- [x] Each policy uses its own limiter from `RATE_LIMITS`, keyed per user where the user is known. Numbers set at ≥2× the worst legitimate rate computed from the code (3 open devices per user):

| Policy | Limit/min | Worst legitimate rate | Headroom | Change |
|---|---|---|---|---|
| vendorStatus | 120 | 36 (booth rush: accept + ready every ~10 s, one shared login on 3 devices) | 3.3× | raised from 30 |
| orderCreate | 10 per user | 4 (order + card-decline retries) | 2.5× | was per IP |
| deliveryCheck | 20 | 9 (address pick + 2 field blurs, ~3 corrections) | 2.2× | raised from 10 |
| connectStatusFresh | 75 | 36 (payout card: 12 fresh reads in its first minute × 3 devices; over the limit → cached read) | 2.1× | raised from 30 |
| refund (cancel) | 10 per user | 4 (cancelling several orders) | 2.5× | raised from 5; was per IP; now fails closed |
| publicRoutes (signed in) | 60 per user | 30 (opening ~10 vendor pages/min × 3 devices) | 2× | was per IP |
| publicAnonymous (signed out) | 600 per IP | 300 (~30 people browsing on one IP) | 2× | new |
| login | — | — | — | removed; Clerk attack protection (9.2) |

- [x] Test proving each limit is enforced at its own number (N allowed, N+1 refused, per policy), with a positive control that a different policy's key is unaffected. *(`scripts/rate-limit-test.ts`, 26 checks, real `@upstash/ratelimit` against a local proxy in docker-compose.test.yml; 4/4 mutations killed.)*

### 1.8 Code can't deploy ahead of its migration
Migrations are applied by hand; Prisma reads every column, so code that ships before its migration breaks every read of that table.

- [x] `/api/health` reports pending Prisma migrations against the live database, and is non-200 when any are pending. *(2026-10-24: public `checks.migrations` is ok/fail only (no counts, same rule as the rest of the public body); names and count are on `/api/admin/health`. The build bakes the folder names (`next.config.mjs`, `BUILD_MIGRATIONS`); `lib/migration-status.ts` compares them with `_prisma_migrations`. A database ahead of the build is fine; unreadable is `unknown` and non-200. `scripts/migration-health-test.ts`, 19 checks, 10/10 mutations killed.)*
- [x] A deploy-time or gate check fails when the build's migrations folder has entries the target database hasn't applied; the uptime monitor (2.3) alerts on it. *(2026-10-24, partly: `scripts/migration-drift.ts` (merged with the dev-database drift script from 2026-10-20) exits 1 on pending, is in the gate, and read-only against production finds all 58 applied. It runs by hand before a push (`CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/migration-drift.ts`). 2026-10-25: proven on Vercel Preview with `tsx scripts/migration-drift.ts` before `next build`: passes against the live database (58/58), and fails naming the folder when a migration the database lacks is added. Checks `DATABASE_URL` (Vercel's `DIRECT_URL` is not a valid URL). 2026-10-25: on for production builds (`npm run build`); override `SKIP_MIGRATION_CHECK=1` for one deploy, documented in the script header. First production build (`3303889`, 2026-10-25) logged `all 58 migrations applied`. The uptime alert on a 503 is tracked in 2.3.)*
- **Note:** Vercel Preview uses the production `DATABASE_URL` until cutover (9.1), so a Preview build's drift check, and anything a Preview deployment does, reads and writes the live database. Treat a Preview URL like production until then.

### 1.6 Card statement descriptor
Charges are created on the platform account (separate charges & transfers, no `on_behalf_of`), so the FairSynq prefix appears.

- [x] Optional `Event.statementName`, organizer-editable, with a fallback to an automatic short form of the fair name. *(2026-10-25: migration `20261025120000_add_event_statement_name` (adds one nullable column); organizer settings has a "Card Statement Name" field with a live preview; stored already cleaned; an input with no letter left is refused.)*
- [x] `statement_descriptor_suffix` set per order. Cleaned to Stripe's rules (22 chars total, no `<>\'"*`). Falls back to the prefix alone. Unit test for the cleaning. *(2026-10-25: `lib/statement-descriptor.ts`; with FAIRSYNQ the suffix gets 12 characters. Stricter than Stripe: A–Z 0–9 space & . - only, accents folded, cut at a word boundary, at least one letter or no suffix at all. `scripts/statement-descriptor-test.ts`, 38 checks incl. a 5000-input fuzz, 9/9 mutations killed. Probed: Stripe test mode rejects `*`, `'` and digits-only at create (so a raw name could fail checkout) but does not check length.)*
- [ ] One test-mode charge confirms the descriptor shown in the Stripe dashboard reads `FAIRSYNQ* <FAIR>`. *(2026-10-25: `scripts/statement-descriptor-live.ts` placed a real charge through `POST /api/orders`: suffix `ITALIAN FEST` applied, but Stripe printed `STRIPE* ITALIAN FEST` because the sandbox the app's keys use (`acct_1TFJuBHk5f3uB8J9`) has no shortened descriptor. Re-run after setting it there.)*

### 1.9 Roles that match their rows
Clerk `roles[]` opens the portal doors and the payee rows (OrgMember, VendorMember, Runner) open the gates. 2026-10-19 production had 6 disagreements. Read-only root cause of each:

| Kind | Count | Code path | Still open? |
|---|---|---|---|
| Runner row, no `runner` role | 1 | `/api/drivers` minted Runners without syncing roles until 0b300f6 (2026-08-01); never backfilled | Path fixed. Gap: the sync is best-effort and "self-heals on the next sync" has no next sync |
| Runner row, no `runner` role | 1 | Out-of-band insert on 2026-06-10 (no RunnerApplication; predates any committed runner-create code) | **Yes**: any script/seed/SQL insert skips the sync, including the 9.3 cutover seed |
| `vendor` / `runner` role, no row | 2 | Optimistic `roles[]` write in `/onboarding` at signup, removed by 0b300f6; both signed up 2026-08-01 within the deploy window; the union sync can never remove a role | Path fixed. Gap: no explicit revoke, so stale claims live forever |
| DB user, no Clerk user | 1 | `softDeleteClerkUser` tombstone (user had orders; `purged…` clerkId, `.invalid` email) | No: by design; the check should classify it as expected |
| Clerk user, no DB row | 1 | Signed up 2026-02-24, before the Clerk webhook (2026-03-22) and `/onboarding` (2026-04-18); never returned | Mostly closed. Gap: the webhook silently skips a user with no primary email |

- [x] Role reconcile: one function that adds every missing payee role from the rows (never removes), run on sign-in and by a worker sweep, so a failed best-effort sync or an out-of-band insert converges. *(`lib/role-sync` `reconcileAllRoles`; Clerk webhook `session.created`; worker in-process timer, hourly, OFF without `CLERK_SECRET_KEY`. Sealed production dry run 2026-10-20: 22 Clerk users, first run adds `runner` to 2 users, nothing else; positive control passed.)*
- Explicit revoke: moved below the line (2026-10-20). The 2 stale claims stay until then.
- [x] Every script that creates an OrgMember/VendorMember/Runner (seeds included) goes through the same create-and-sync helper; a gate scan fails on a bare create outside tests. *(`lib/payee-membership.ts`; 7 sites moved; scan covers nested, multi-line and raw SQL.)*
- [x] Clerk webhook logs a warning (not a silent skip) when a user has no primary email; such a user still gets a DB row on first authenticated request. *(Row is created by the webhook itself: first email, else `<clerkId>@pending.invalid`, the same fallback checkout uses.)*
- [x] `role-consistency-check` classifies purge tombstones as expected and exits non-zero on anything else; it runs after the 9.3 seed as a cutover gate.
- [x] Tests (test DB + a fake Clerk client): each kind above is created, then shown converged by the reconcile, with a positive control that the check sees the mismatch first. *(`scripts/role-reconcile-test.ts`, 38 checks, 12/12 mutations killed.)*

### 1.10 Delivery address fields (P1)
Found 2026-10-24 on the www test order (`cmvm0h9om…`): `deliveryStreet` held the whole address ("125 W Main St, Collinsville, IL 62234, USA"). The unit "125" was typed by the customer, so the unit field worked. Cause: picking a suggestion copied Google's `formatted_address` into Street, in both `handlePlaceSelect` and `AddressAutocomplete`'s own input text.

- [x] Street is the street line only: `streetLineFromPlace` (`lib/delivery-address.ts`) builds number + road, else the building, else the first part of the formatted address. City, state and ZIP keep their own fields. The unit stays the customer's. *(2026-10-25)*
- [x] Autofill hints on every address input: `address-line1` (street), `address-line2` (unit), `address-level2` (city), `address-level1` (state), `postal-code` (ZIP). Google's autocomplete may override the street input's hint with its own dropdown.
- [x] Test: `delivery-address-guard` [6] runs on real Google results captured into `scripts/fixtures/places-results.json` (numbered street, campus road with no number, an address with a unit, a corrected ZIP). 4/4 mutations killed. The server geocode of "125 W Main St" + Collinsville/IL/62234 is the same point at ROOFTOP as the old full-address form.
- [x] No backfill: past orders with a full-address street geocode to the same point and still display (with the city repeated).

**Done when:** every test above passes in the gate, the descriptor is confirmed on a test charge, and the three payee GIFs are recorded. Worker-dependent flows (refunds, emails from the webhook) are verified on the local Docker stack.

---

## Phase 2: Ops foundation (Nov 2 – Dec 13)

Mostly dashboard work. Runs alongside Phase 1.

### 2.1 Domain and DNS
You already have delegate access to the GoDaddy account holding fairsynq.com, so email DNS and support@ are **not** blocked on the transfer.

- [ ] Snapshot every existing DNS record before any change.
- [ ] Move the domain into your own GoDaddy account (account change). You start it if your delegate level allows; otherwise the owner does. Fallback: Cloudflare nameservers.
- [ ] Registrant contact set to you/FairSynq. WHOIS privacy on.
- [ ] Auto-renew on with your payment method. Note the expiry date.

### 2.2 support@
- [ ] Zoho Mail free plan (check the current limits: users, storage, IMAP, mobile app first). Replies come from support@fairsynq.com.
- [ ] Root-domain MX, SPF and DKIM for Zoho.
- [ ] DMARC on the root at `p=none` with reports. Tighten to `quarantine` after two clean weeks.
- [ ] An `alerts@` alias, used as the notification contact for Stripe, Sentry and Better Stack.

### 2.3 Monitoring and alerting
- [ ] Better Stack Uptime (free): `/api/health` every 3 min, failing on non-200 or a stale worker heartbeat. Email + phone push.
- [ ] Public status page at status.fairsynq.com.
- [ ] Sentry (free) on the Vercel app and the Railway worker. Separate environments for production and preview.
- [ ] Sentry `beforeSend` scrubs names, emails, phone numbers, addresses and Stripe IDs. Request bodies are never sent.
- [ ] Sentry alert: more than 3 errors in 10 minutes on `/api/stripe/connect-webhook` or `/api/webhooks/stripe`.
- [ ] Stripe → Settings → Team: `alerts@` receives Stripe's account and webhook emails.
- [ ] Usage alerts at 70% of every free-tier limit (list in 2.4), set in each provider's dashboard.
- [ ] Test: stop the Railway worker for ~10 min and confirm the phone alert (expected within 6–9 min with `HEALTH_WORKER_STALE_SEC=360` and a 3-minute check). Restart; confirm the boot sweep and health recover. (Repeated on new production in Phase 9.)
- [ ] Test: force a 500 on a webhook in a Vercel Preview deploy; confirm the Sentry alert fires.
- [ ] Owed-back halts (`OwedBackHalt`, from 1.2) go to Sentry as alerts when first raised, so a customer owed money pages you instead of waiting for someone to open the money page.

### 2.4 Free-tier inventory (`docs/COST-WORKSHEET.md`)
- [ ] Every free tier we depend on, with its limit, current usage and upgrade trigger: Supabase, Upstash, Railway, Vercel, Clerk, Resend, Zoho, Google Maps/Geocoding/Routes, Sentry, Better Stack.
- [ ] Upstash budget updated for 3-minute health checks (~29K commands/month).
- [ ] Upstash commands spent by rate limiting on a busy fair day (e.g. 2,000 attendees, typical browsing; every limited request is at least one command, including signed-out menu reads at 600/min per IP), checked against the daily share of the 500K/month budget the worker also lives on.
- [ ] Resend: "free supports about 45 orders/day" written down, with the trigger "upgrade to paid before the first real fair". Verify current pricing first.
- [ ] Google: check current free usage for Geocoding (the pricing model changed in 2025) before writing a cost.

### 2.5 Local storage
- [ ] Supabase CLI local stack (`supabase start`) replaces the `fairsynq-dev-db` Postgres container. CLI version pinned in the repo. Auth, realtime and edge functions turned off in `supabase/config.toml`. Redis stays in `docker-compose.dev.yml`.
- [ ] One bucket config file (names, public/private, size limits, allowed types) seeds local storage, provisions staging and production, and is what the vendor-document-privacy and upload-cap tests check against. *(2026-10-24, partly: `lib/storage-buckets.ts` + `scripts/apply-bucket-config.ts` provision the current project, and the upload-cap guard checks size, types and public against it. Left: seeding local storage, and the vendor-document-privacy test reading it.)*
- [ ] `.env.local` points at local storage. Uploads work on the local stack.

**Done when:** the worker-stop alert reached your phone, a test email to support@ arrived and a reply from support@ landed in an outside inbox, the Sentry test alert fired, and an upload works locally.

---

## Track B: Business & legal readiness (Nov 2 – Jan 10)

Lead-time items. Phase 9 only flips keys; activation must already be approved by then.

- [ ] **Decide the business entity** (LLC vs sole proprietor). Do this first; it determines everything Stripe asks for. Target: by Nov 15.
- [ ] If LLC: file it, get an EIN, open a business bank account.
- [ ] Start Stripe live account activation: business details, tax ID, bank account, website. Target: submitted by Nov 29.
- [ ] Complete the Stripe Connect platform profile.
- [ ] Respond to any Stripe review questions. Activation approved by Jan 10 at the latest.
- [ ] Draft a **Terms of Service**. The text vendors already accept (`termsVersion`) becomes part of it, with one versioned source.
- [ ] Draft a **Privacy Policy**, including runner location handling (current position only during a delivery, cleared within 24h).
- [ ] Update the `/refund-policy` draft (also in 1.2).
- [ ] **Legal review** of the Terms, Privacy Policy and Refund Policy by a lawyer, a lawyer-reviewed template service, or a university legal clinic. Drafts may be written in-house; nothing is published unreviewed.
- [ ] Publish the three reviewed pages.
- [ ] Footer and signup screens link to all three pages.
- [ ] Stripe public details: support URL `https://www.fairsynq.com`, support email `support@fairsynq.com`, statement descriptor prefix `FAIRSYNQ`.
- [ ] Stripe Connect branding: name, icon and colour for the onboarding and Express dashboard.
- [ ] Google OAuth consent screen: FairSynq app name, support email `support@fairsynq.com`, privacy policy link.

**Done when:** Stripe shows the account as activated for live payments, and all three legal pages are live and linked.

---

## Phase 3: Design foundation (Nov 30 – Dec 20)

Today: 77 pages, two shared UI components, 1,164 one-off Tailwind values. The palette stays (neon pink `#FF0077` on near-black); the app is dark-only and launches dark-only.

- [ ] Tokens: color, type scale, spacing, radii, shadows, motion durations and easings.
- [ ] A `prefers-reduced-motion` rule in the motion tokens.
- [ ] WCAG AA contrast checks on token pairs, especially pink text on dark at small sizes.
- [ ] Primitives: `Button`, `Input`, `Select`, `Card`.
- [ ] Primitives: `Modal`, `ConfirmDialog` (states the consequence; money actions name the amount on the button).
- [ ] Primitives: `Toast`, `EmptyState`, `Skeleton`, `ErrorState`.
- [ ] Primitives: `Badge`/`StatusPill`, `PageHeader`, `Sheet` (mobile bottom sheet).
- [x] Primitive: `FairCard` (`app/_components/FairCard.tsx`), the only public fair card (landing and `/fairs`). Equal-height flex column, fixed-ratio banner, 2-line reserved description, bottom-pinned CTA, date-derived status, AA badges. Pinned by `scripts/fair-card-guard.ts`. Migrate it to tokens with the rest.
- [ ] A primitives showcase page (dev-only).
- [ ] Lint rule blocking new arbitrary Tailwind values.
- [ ] Contrast is part of the verification for every migrated page.
- [ ] Email templates (Phase 5) read the same tokens.

**Done when:** the showcase page is screenshotted, the lint fails on a new arbitrary value, and the contrast test passes. Verified locally.

---

## Portal audits (Phases 4, 6, 7, 8): method

Each portal gets `docs/audit/<portal>.md`, one checkbox row per page × element: action, expected, actual, states (loading/empty/error/success), destructive (needs `ConfirmDialog`), accessibility (keyboard reachable, visible focus, input labels), visual issues, severity (**P0** money/blocking · **P1** broken · **P2** confusing · **P3** cosmetic), with a `file:line` and a screenshot.

1. The checklist is produced from the code plus driving each page on the local stack with seeded data for every role and state (empty, live and ended fair; an order in each status).
2. **Your pass:** you walk the portal on the local stack and add findings to the same file, tagged `[Feran]`.
3. P0/P1 fixed in the phase. P2/P3 fixed while migrating that page to the design system.
4. Every destructive action goes through `ConfirmDialog`.

**A portal is done when** your pass is in, all P0/P1 are closed, every page has screenshots at 390px and 1280px in `docs/audit/screens/`, and the main path has a walkthrough GIF.

## Phase 4: Customer portal (Dec 21 – Jan 3)

About 20 pages: landing → fair → menu → checkout → tracking → account.

- [ ] Audit checklist written (`docs/audit/customer.md`).
- [x] Fair cards (landing "Happening now & soon" and `/fairs`): uniform height, clamped description, fixed banner, only live/upcoming under "Happening now", ended fairs under Past Events with "View fair", "1 vendor" pluralization, AA badge contrast. Fixed 2026-10-19 via the shared `FairCard`; screenshots at 390px and 1280px taken.
- [ ] **P1:** opening `/onboarding` writes to Clerk (`publicMetadata.role`, `roles[]` via the organizer bootstrap) and the DB with no user action. It must write only when the user submits something. *(2026-10-19: a page view on localhost changed a real account.)*
- [ ] Data consistency: users whose Clerk `roles[]` disagrees with their payee rows. Read-only check `scripts/role-consistency-check.ts`. 2026-10-19 production: 4 of 21 compared users mismatch (runner row but no `runner` role: 2; `vendor` role without a row: 1; `runner` role without a row: 1), plus 1 DB user with no Clerk user and 1 Clerk user with no DB row. Decide the repair per kind; the role sync can only add roles. Root cause and fixes: 1.9.
- [ ] Your pass added.
- [ ] P0/P1 closed.
- [ ] Pages migrated to tokens and primitives (zero arbitrary values on migrated pages).
- [ ] Loading, empty and error states on every page.
- [ ] Contrast checks pass on migrated pages.
- [ ] Screenshots at 390px and 1280px.
- [ ] Public read-only pages and APIs (fair pages, menus, the vendor list) served with Vercel edge caching and a short revalidate, so anonymous browsing mostly skips the server and Redis. Then decide whether signed-out reads still need a limiter at all (today: `publicAnonymous`, 600/min per IP, one Upstash command per request).
- [ ] Walkthrough GIF: browse → order → track → cancel/refund view.

## Phase 5: Email platform (Dec 14 – Jan 10)

Resend, sending from `notifications.fairsynq.com`. Clerk keeps sending verification and password reset.

### 5.1 Infrastructure
- [ ] Resend account. SPF, DKIM and DMARC for `notifications.fairsynq.com` added to DNS.
- [ ] `EmailLog` table: recipient, template, entity, status (sent / failed / deferred: daily cap), provider id, timestamp. Unique on `(template, entity)` as the send-once anchor.
- [ ] Email is a new job type on the existing `fairsynq-orders` queue. No new queue.
- [ ] Email jobs run at a lower BullMQ priority than order jobs.
- [ ] Hard timeout on the Resend call.
- [ ] A Resend 429 for the daily cap delays the job until the cap resets instead of retrying.
- [ ] Alert when daily sends reach 70.
- [ ] Templates are React Email components using the Phase 3 tokens, each with a plain-text version.
- [ ] Preview: every template renders in the React Email preview with sample data.
- [ ] Admin page listing `EmailLog` (who, what, when, status).
- [ ] Turn off Stripe's own receipts once ours are live.

### 5.2 Essential templates (no opt-out)
- [ ] Customer: order confirmation + receipt (itemized: food per vendor, delivery, tip, service fee), built from `itemizeOrder`.
- [ ] Customer: delivered / ready for pickup.
- [ ] Customer: cancellation/refund, one per cancellation event. A partial cancel says the rest is still coming; a full cancel sends one itemized email after everything owed is issued, covering only parts not already emailed, with a note that the parts may show separately on the statement. "Everything owed is issued" is computed per order, not triggered by Pattern R.
- [ ] Vendor: application received; approved / rejected with reason; documents missing or rejected; document expiring (14 and 3 days).
- [ ] Vendor: menu request approved / rejected; order refunded after acceptance (earnings change explained); dispute opened (order, amount, what they owe).
- [ ] Runner: application received / approved / rejected.
- [ ] Organizer: application received / approved / rejected; event-close batch payout sent.
- [ ] All payees: payout setup needed / complete / needs attention (from 1.4); payout sent; payout failed (reason and how to fix).
- [ ] Admin: daily digest (applications awaiting review, failed payouts, free-tier usage).

**Done when:** the send-once test passes (same event ×3 gives one `EmailLog` row and one send), every template has a preview screenshot, and a real inbox check (Gmail and Outlook) passes, including a spam score. Verified on the local stack with the Resend free tier.

## Phase 6: Vendor portal + onboarding (Jan 4 – Jan 17)

- [ ] Audit checklist written (`docs/audit/vendor.md`).
- [ ] Your pass added.
- [ ] P0/P1 closed.
- [ ] Pages migrated (10 pages).
- [ ] Onboarding: every step shows what's needed, why, and what happens next; clear progress and status.
- [ ] Required documents: insurance (with expiry), food handler permit (with a new `foodPermitExpiryDate`). Business license optional. Expiry dates confirmed by the organizer at approval.
- [ ] Expiry is valid through the end of that day in the fair's timezone (`Event.timezone`).
- [ ] The readiness API marks a vendor not-ready after a required document expires (new orders only; orders in progress finish). Fixed-date tests, including the cut-off in `America/Chicago`.
- [ ] At approval, warn the organizer if a document expires before the fair ends; they can approve anyway or request an update.
- [ ] Organizer alerted before a document expires during an active fair.
- [ ] Real-phone/tablet check: touch targets, one-handed use, readability in bright light.
- [ ] Screenshots + walkthrough GIF.

## Phase 7: Organizer core + earnings card (Jan 11 – Jan 24)

**Demo-ready for pitches by Jan 24.** Core pages: `/organizer`, `/organizer/fairs`, `/organizer/fairs/new`, `/fairs/[fairSlug]`, `/fairs/[fairSlug]/settings`, `/fairs/[fairSlug]/vendors`, `/fairs/[fairSlug]/vendors/[vendorSlug]`.

- [ ] Audit checklist written (`docs/audit/organizer.md`).
- [ ] Your pass added.
- [ ] P0/P1 closed.
- [ ] Core pages migrated.
- [ ] "Your earnings" card on `/fairs/[fairSlug]`, read from the ledger through one shared helper. Settled vs estimated labelled; never gross. Display-only.
- [ ] Payout status on the card: Scheduled → Sent on [date] → Failed (with what to do).
- [ ] If Connect isn't set up: "You've earned $X · Connect payouts to receive it", with the button, using the 1.4 states.
- [ ] "View payouts in Stripe" link (Express dashboard login link).
- [ ] Total across fairs on `/organizer`.
- [ ] Test: the card matches the ledger the event-close batch pays.

## Phase 8: Runner portal + onboarding (Jan 25 – Jan 31)

- [ ] Audit checklist written (`docs/audit/runner.md`).
- [ ] Your pass added.
- [ ] P0/P1 closed.
- [ ] Pages migrated (6 pages). *First to cut under the slip order; P0/P1 stay.*
- [ ] Onboarding: driver's license required only for home delivery; no document for curbside/at-fair runners.
- [ ] Location heartbeat every 20s; stale after 60s (`STALE_AFTER_SEC`).
- [ ] Runner location cleared on DELIVERED/cancel, with a sweep backstop at 24h. Onboarding copy says what's kept.
- [ ] "Keep FairSynq open while delivering" banner (wake lock already exists).
- [ ] Real-phone check on staging.fairsynq.com (HTTPS needed for GPS): touch targets, one-handed use, bright light, GPS-paused state.

## Phase R: Cutover rehearsal (Jan 18 – Jan 24)

Runs alongside Phase 7 so problems surface with three weeks to go, not one. Phase 9 then executes a runbook that has already worked once.

- [ ] Runbook written: every step of 9.1–9.3, plus every env var that differs between staging and production, per platform (Vercel Production/Preview, Railway, Upstash, Supabase, Clerk, Stripe, Resend, Google).
- [ ] Full runbook dry run against a throwaway Supabase project, in test mode.
- [ ] Schema diff after the dry run confirms `Vendor.slug` is per-event unique (the global-unique drift is gone).
- [ ] Runbook updated with everything the dry run got wrong, then the throwaway project deleted.

**Done when:** the dry run completed end to end from the written runbook, with no step improvised.

## Phase 9: Live cutover (Feb 1 – Feb 5)

Today's production becomes **staging** (test keys, test Clerk, all history kept). Launch gets a fresh project.

### 9.1 Environments
- [ ] New Supabase **organization** containing only production. Staging stays in the current org.
- [ ] Check Supabase's free active-project limit; pause or delete Timeline if staging + production + Timeline exceeds it.
- [ ] Separate Upstash databases for staging and production.
- [ ] staging.fairsynq.com: Vercel Preview with staging env vars and test keys. DNS record added. No staging worker (auto-cancel and payouts don't run there).
- [ ] Preview's `DATABASE_URL` points at staging, not production (until then Preview shares the live database; see 1.8). Fix or remove Vercel's invalid `DIRECT_URL` at the same time if not done earlier.
- [ ] Bucket config applied to the production project.

### 9.2 Keys and providers
- [ ] Stripe live keys on Vercel Production and Railway.
- [ ] Fresh live webhook endpoints (platform + Connect) on www with new `whsec_` secrets.
- [ ] Test-mode webhooks re-pointed to staging.fairsynq.com.
- [ ] Clerk production instance, with its DNS records (clerk./accounts. CNAMEs, email DKIM), app name and logo, email From name.
- [ ] Clerk attack protection on the production instance: failed-attempt lockout and bot protection on, verified by a lockout on a test account. Sign-in has no app-side rate limit (1.7); Clerk is the only guard.
- [ ] Resend upgraded to paid (trigger from 2.4), or explicitly deferred with the daily-cap alert in place.

### 9.3 Cutover (following the rehearsed runbook from Phase R)
- [ ] Contract step: migration dropping `Cancellation.refundIssued` and `refundAmount` (run on staging too).
- [ ] Worker-stop alert test repeated on new production.
- [ ] `prisma migrate deploy` on the empty production database. Seed only real data (admin account, real organizers and fairs entered fresh).
- [ ] Seed creates organizers, vendors and runners only through `lib/payee-membership` (the gate enforces it); then `scripts/role-consistency-check.ts` exits 0 against the new database and Clerk instance.
- [ ] Health check green: deploy SHA, worker heartbeat, Redis.

### 9.4 Stranger walkthrough
- [ ] Sign up and pay as a stranger on production: every screen, every email and the card statement line screenshotted. No personal name anywhere.
- [ ] Vendor, runner and organizer onboarding each run once on production, through live Stripe Connect.
- [ ] Real refund of a real small charge, checked to the cent.
- [ ] Branding inventory (below) checked off.

**Done when:** the stranger walkthrough is captured and a real charge + refund reconciles.

---

## Branding inventory

The codebase has no customer-facing personal name. Every leak is in an external service.

| Where | Shown to | Owner | Done |
|---|---|---|---|
| Stripe public details (statement descriptor, receipt name, support email/URL) | Customers | You | [ ] |
| Stripe Connect branding (onboarding + Express dashboard) | Payees | You | [ ] |
| Stripe receipts (off once ours ship) | Customers | You | [ ] |
| Clerk production (app name, logo, email From) | Everyone | You | [ ] |
| Google OAuth consent screen (app name, support email) | Everyone | You | [ ] |
| Domain WHOIS (privacy on) | Public | You | [ ] |
| Resend From: `FairSynq <…@notifications.fairsynq.com>` | Everyone | Code | [ ] |
| "Feran Events" organizer record | Organizers | Gone with fresh production | [ ] |
| `package.json` name `fairdash`; Gmail in a comment at `app/api/drivers/route.ts:139` | Internal | Code | [ ] |

---

## Below the line (after launch, unordered)

- Explicit role revoke (1.9 item 2): remove a payee role only when no row backs it, never admin roles; then clear the 2 stale signup-time claims with approval per user
- Admin portal and remaining organizer pages migrated to the design system
- Page transitions and list animations
- Light mode
- Premium tracking map: polling only while collected + visible; runner sends every 10s or 25m; one Routes call per delivery at pickup, cached; client-side ETA along the polyline; styled dark map ID; status steps from `deriveOrderView`; "location paused" state for customers
- Non-essential emails with opt-out + List-Unsubscribe: welcome, fair starting soon, organizer fair-readiness nudge, organizer daily review digest
- True single refund per order (only if support data shows confusion)
- `/organizer/payouts` page (when organizers run several fairs)
- Per-fair document requirements set by organizers
- Runner auto insurance and background checks: get legal/insurance advice before scaling runners
- Small trip payment for runners on cancel-after-accept (only if runners complain)
- Google Workspace for support@
- Staging worker
- Native app or PWA for background GPS

---

## Decision log (2026-10-18)

1. Phase 0 shrinks to closing the guard gap; `72582db` already moved local off production.
2. Launch target Feb 12, 2027 (assumed). Above the line: money/trust bugs, Stripe live + Clerk prod, monitoring + billing alerts, domain ownership, delivery-fee policy, basic map centering.
3. Delivery fee refunded on any cancel where no runner earned anything; multi-vendor only when all vendors cancel. Runner who accepted but didn't pick up gets nothing (known trade-off).
4. Delivery fee folds into Pattern R; itemized copy instead of an engine rewrite. Pattern R runs on every sweep (production `WORKER_SWEEP_INTERVAL_MS=120000`).
5. Domain: account change into your GoDaddy, registrant + auto-renew; DNS already editable via delegate access.
6. Resend, free now / paid before the first fair; email as a job type on `fairsynq-orders`; send from `notifications.fairsynq.com`.
7. support@ on Zoho free; every free tier inventoried with an upgrade trigger.
8. Email list as in Phase 5; vendor new-order stays off email.
9. Design: tokens + primitives first; customer paths, then portals; palette kept; dark-only; contrast checks.
10. Organizer earnings card on the fair page, from the ledger, amount shown even when payouts aren't set up.
11. Payout limbo: `verifying` state + polling + single card component.
12. Connect webhook: conditional transition, 500 on internal errors, debounced "needs attention".
13. Better Stack + Sentry (PII scrubbed) + usage alerts; tests run on production pre-launch.
14. Radius: server geocoding by `place_id`, checked before payment, fail closed.
15. Fresh production database at launch; current production becomes staging; isolated Supabase org and Upstash.
16. Audit method with your `[Feran]` pass, real-phone checks, accessibility per row. Order: customer → vendor → organizer → runner.
17. Local storage via the Supabase CLI stack; one bucket config file.
18. Documents: insurance + food permit required with expiry; business license optional; fair-timezone expiry; no mid-service cut-offs.
19. Statement descriptor `FAIRSYNQ* <FAIR>` via a per-order suffix.
20. Tracking: keep Postgres + polling, no Realtime; one cached route per delivery.
21. Drop `refundIssued`/`refundAmount` via expand/contract (standing rule for all column removals).
22. Phase order as above, with Track B, a buffer week, and the slip order.
23. Cutover dry run moved to Jan 18–24 (Phase R); progress table generated by `scripts/readiness-progress.ts`; legal pages reviewed before publishing.
