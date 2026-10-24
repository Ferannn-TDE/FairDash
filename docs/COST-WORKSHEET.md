# FairSynq — External Service Cost Worksheet

**Built:** 2026-08-06 · from tree `50d66b1` · repo evidence only.

## How to read this

Two kinds of fact live here and they are never mixed:

- **What the repo proves** — the service is used, where, and what drives its bill. Cited `file:line`.
- **`▢ BLANK`** — only your dashboard or card statement knows this. **Never filled with a guess.**
  Each one names exactly where to look.

No prices are quoted anywhere in this document. Not one. A price I half-remember is worse than a
blank, because a blank cannot be silently wrong. Rates change, differ by region and by negotiated
plan, and every provider below has changed pricing at least once.

---

## ⚠️ Three findings that contradict the working assumptions

Read these before filling anything in — two of them change *what you should do*, not just what you pay.

### 1. The worker is on **Render**, not Railway. Both services are on `plan: free`.

`render.yaml` is the only deploy config in the repo; there is no Railway config anywhere. It declares
two services:

| Service | Type | Plan in repo | Evidence |
|---|---|---|---|
| `fairdash-api` | web (Clerk + Stripe webhooks, `/health`) | `plan: free` | `render.yaml:14-19` |
| `fairsynq-job-workers` | background worker (BullMQ) | `plan: free` | `render.yaml:74-80` |

Two things to check on the dashboard, because the repo can't tell you:

- **Free web services sleep when idle.** Your own `DEPLOYMENT.md:199` recommends UptimeRobot to keep
  `fairdash-api` awake. A sleeping webhook receiver drops Clerk/Stripe webhooks until it wakes.
- **Confirm the worker is actually on Render and actually running.** `/api/health` reports a live
  worker heartbeat, so *a* worker process is connected — but the heartbeat only proves something is
  writing to Redis, not where it runs. Render's free tier has not always included background workers.
  ▢ Confirm both services exist, their real plans, and whether either is suspended.

### 2. There are **two Upstash Redis instances, and both are load-bearing.** Neither is abandoned.

This is the opposite of the "Upstash is a cancel candidate" assumption:

| Instance | Protocol | Used by | Evidence |
|---|---|---|---|
| `simple-rat-130621` | `rediss://` TCP (ioredis) | **BullMQ queue** — every delayed job: payouts, refunds, order timeouts, the reconciler sweep. Also the worker heartbeat + `/api/health` Redis check. | `REDIS_URL` → `lib/queues.ts:38`, `lib/health.ts:101` |
| `enabled-humpback-136522` | REST (`@upstash/redis`) | **Rate limiting on 10 API routes** (order create, vendor-status, login, refund, cancel, collect, release, returns) **and** the vendor membership auth cache | `UPSTASH_REDIS_REST_URL` → `lib/ratelimit.ts:41`, `lib/redis.ts:14` → `lib/vendor-auth-cache.ts` |

**If the REST instance really is quota-dead at 500000/500000, that is a live outage, not a saving.**
`lib/ratelimit.ts:47` throws in production when Redis is unavailable, and the vendor auth cache falls
back to hitting Postgres on every request. Cancelling it would break order creation.

**And `/api/health` would not tell you.** It pings only the TCP instance (`lib/health.ts:101`). The
REST instance — the one on the order-creation hot path — has **no health check at all**. That is a
monitoring blind spot, not a billing question, but it surfaced here so it is written down.

▢ Check the quota on **both** instances at https://console.upstash.com.

### 3. Two services you didn't list are billing you

- **Google Maps Places API** — `useMapsLibrary('places')` at `app/_components/AddressAutocomplete.tsx:16`,
  key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Places Autocomplete is billed **per session/request** and is
  one of the more expensive Maps SKUs. A public client-side key with no HTTP-referrer restriction can
  be scraped and billed to you by third parties. ▢ Verify referrer restrictions and a budget cap.
- **Supabase Storage** — not just Postgres. `app/api/storage/upload/route.ts:48` writes to a
  `delivery-proofs` bucket via signed upload URLs. Storage GB + egress bill separately from the DB.

---

## The worksheet

Fill the ▢ columns from the dashboards in the last column. Then sum.

| # | Service | Cost shape | What the repo proves | ▢ My plan | ▢ My usage | ▢ $/month | Where to find it |
|---|---|---|---|---|---|---|---|
| 1 | **Vercel** (web) | Fixed floor + usage | Next.js app, region `iad1` (`vercel.json:3`). All `/api/*` set `no-store` (`vercel.json:6-10`) → **zero CDN caching on API routes**, so every API hit is a billed function invocation | ▢ | ▢ | ▢ | vercel.com/dashboard → Settings → Billing; Usage tab for bandwidth / invocations / build minutes |
| 2 | **Render** — `fairdash-api` | Fixed per service | Web service, webhooks + health, `plan: free` in repo | ▢ | ▢ | ▢ | dashboard.render.com → service → Settings → Instance Type; Billing page |
| 3 | **Render** — `fairsynq-job-workers` | Fixed per service | Background worker, BullMQ consumers, `plan: free` in repo | ▢ | ▢ | ▢ | same as above |
| 4 | **Supabase** — Postgres | Fixed floor + usage | Sole datastore via Prisma. Pooler `:6543` for serverless, direct `:5432` for the long-lived server processes (`render.yaml:25-32`) | ▢ | ▢ | ▢ | supabase.com/dashboard → project → Settings → Billing; Reports → Database |
| 5 | **Supabase** — Storage | Usage (GB + egress) | `delivery-proofs` bucket, signed uploads (`app/api/storage/upload/route.ts:48`) | ▢ | ▢ | ▢ | same project → Storage → Usage |
| 6 | **Upstash** — `simple-rat-130621` | Usage (per command) | BullMQ queue + worker heartbeat. **Load-bearing: all delayed money jobs** | ▢ | ▢ | ▢ | console.upstash.com → database → Usage / Billing |
| 7 | **Upstash** — `enabled-humpback-136522` | Usage (per command) | Rate limiting (10 routes) + vendor auth cache. **Load-bearing** | ▢ | ▢ | ▢ | same console, second database |
| 8 | **Clerk** | Fixed floor + per-MAU | Auth for all portals; `@clerk/nextjs` server + `@clerk/clerk-react` client. Driver = **monthly active users**, which at a fair means every customer who signs in | ▢ | ▢ | ▢ | dashboard.clerk.com → Settings → Billing; Users → MAU |
| 9 | **Firebase RTDB** | Usage, **no ceiling** (Blaze) | Live order status. Writes gated by `FIREBASE_ENABLED` (`lib/firebase-sync.ts:26`); write sites = `lib/place-order.ts`, `app/api/orders/[id]/vendor-status/route.ts`, `lib/reconcile-order-status.ts`. Billed on **concurrent connections + data transfer + storage** | ▢ | ▢ | ▢ | console.firebase.google.com → project → Usage and billing |
| 10 | **Google Maps Places** | Per request/session | Address autocomplete (`AddressAutocomplete.tsx:16`) | ▢ | ▢ | ▢ | console.cloud.google.com → Billing → Reports, filter by SKU |
| 11 | **Stripe** | **Per transaction** — see below | Charges + Connect transfers to 3 payee types | n/a | ▢ | ▢ | dashboard.stripe.com → Balance → Fees; and stripe.com/pricing for current rates |
| | | | | | **TOTAL** | ▢ | |

Services confirmed **not** billing: `svix` is a library used only to verify Clerk's webhook signatures
(`app/api/webhooks/clerk/route.ts:2`) — no Svix account involved. No email/SMS provider, no error
monitoring (Sentry etc.), no analytics vendor appears anywhere in `package.json` or the env.

---

## Stripe, modelled per order

Stripe is not a monthly line. Do not put a flat number in the table above — compute it:

```
per order        = (charge_rate × order_total) + fixed_fee_per_charge
per payout leg   = transfer/payout fee, if any, × 3 payee types
monthly Stripe   = per_order × orders_this_month  +  payout legs
```

▢ **Get the three rates from https://stripe.com/pricing** (they vary by country, card type, and
whether the card is present). Deliberately not quoted here.

What the repo proves about the shape:

- **Separate charges and transfers**, not destination charges with an application fee. Payouts are
  explicit `stripe.transfers.create({ destination })` calls — `lib/runner-payout.ts:319`,
  `lib/organizer-payout.ts:85`.
- **Three Connect payee types**: vendors, runners, organizers. Each connected account may carry its
  own Connect fee. ▢ Confirm your Connect pricing and count of *active* connected accounts.
- Organizer payouts are **batched per event** (`lib/organizer-payout.ts`), so they cost fewer transfer
  legs than the per-runner ones. Runner payouts are per-earning.

---

## Kill list / action list

Ordered by confidence, not by size. **No item here is "cancel Upstash"** — that assumption was wrong.

| Action | Why | Confidence |
|---|---|---|
| ▢ **Restrict the Google Maps key** to your domains + set a budget cap | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ships to the browser. Unrestricted keys get scraped and billed to you. This is the only item here that can produce a surprise bill with no ceiling | High — the key is public by construction |
| ▢ **Add a Firebase Blaze budget alert** | Blaze is pay-as-you-go with **no ceiling**. RTDB bills on concurrent connections, which scale with simultaneous customers watching order status — exactly what a busy fair produces | High |
| ▢ **Check the REST Upstash quota** and, if exhausted, upgrade — do not cancel | Rate limiting throws in production when Redis is down (`lib/ratelimit.ts:47`), and the vendor auth cache degrades to a DB hit per request | High |
| ▢ **Add a health check for the REST Upstash instance** | `/api/health` covers only the TCP one. The hot-path instance is unmonitored | High — code-provable gap |
| ▢ Decide whether the two Render free services are viable | Free web services sleep; a sleeping `fairdash-api` drops Clerk and Stripe webhooks. Your own `DEPLOYMENT.md:199` works around this with UptimeRobot | Medium — depends on real plan |
| ▢ Consider whether **two** Upstash instances are needed | They serve genuinely different protocols (TCP for BullMQ, REST for edge/serverless), so this may be correct. But confirm it's deliberate, not drift | Low — likely justified |
| ▢ Review `no-store` on all `/api/*` | `vercel.json:6-10` disables CDN caching for every API route. Correct for money endpoints; possibly costing invocations on read-only public ones | Low — needs judgement, not a blanket change |

---

## Scenario A — idle / off-season

Fixed floors only. Stripe ≈ $0 (no orders). Firebase near-zero (no connections). Maps near-zero.

| Line | ▢ $/month |
|---|---|
| Vercel floor | ▢ |
| Render — web | ▢ |
| Render — worker | ▢ |
| Supabase floor (DB + storage at rest) | ▢ |
| Upstash × 2 (idle; the queue still polls) | ▢ |
| Clerk floor (base + retained MAU) | ▢ |
| Firebase (idle) | ▢ |
| **Idle total** | **▢** |

Note: the worker never fully idles — the reconciler sweep runs on a recurring schedule and writes a
heartbeat roughly every 30–40s, so the queue Redis accrues commands even with zero orders.

## Scenario B — during a fair

Run this twice, at 500 and 5 000 orders.

| Line | Driver | ▢ Multiplier | ▢ $/month |
|---|---|---|---|
| Everything in Scenario A | fixed | 1 | ▢ |
| Vercel invocations + bandwidth | API hits/order — order create, status polls, vendor dashboard. `no-store` means none are CDN-absorbed | ▢ | ▢ |
| Supabase compute + egress | queries/order; analytics and dashboard reads are the heavy ones | ▢ | ▢ |
| Supabase storage | delivery-proof photos × delivered orders | ▢ | ▢ |
| Upstash (queue) | jobs/order — timeout + payout + any refund, plus the sweep | ▢ | ▢ |
| Upstash (REST) | rate-limit check on **every** call to those 10 routes + auth-cache reads | ▢ | ▢ |
| Clerk MAU | **every customer who signs in during the fair counts as an MAU** — likely your steepest step | ▢ | ▢ |
| Firebase RTDB | **concurrent** connections at peak, not total orders. A 2-hour dinner rush is the peak that bills | ▢ | ▢ |
| Google Maps Places | one autocomplete session per checkout address entry | ▢ | ▢ |
| Stripe | per-order formula above × orders | ▢ orders | ▢ |
| **Fair-month total** | | | **▢** |

The two lines most likely to surprise you are **Clerk MAU** (steps up with unique signed-in customers,
not order count) and **Firebase concurrent connections** (peaks with simultaneous viewers, so it tracks
the busiest hour rather than the daily total). Both are worth checking after your first real fair.

---

## The six-tab check, for "what am I paying *right now*"

Faster than any repo analysis. Each shows plan + current charge in seconds:

1. https://vercel.com/dashboard → Settings → Billing
2. https://dashboard.render.com → Billing (covers both services)
3. https://supabase.com/dashboard → project → Settings → Billing
4. https://console.upstash.com → **check both databases**
5. https://dashboard.clerk.com → Settings → Billing
6. https://console.firebase.google.com → Usage and billing
7. https://console.cloud.google.com → Billing → Reports (Maps — separate from Firebase billing even
   though both are Google)
8. https://dashboard.stripe.com → Balance → Fees (actual fees paid, not a subscription)

That's eight, not six — Maps and Stripe are the two that get forgotten.
