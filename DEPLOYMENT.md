# FairSynq Deployment Guide

## Architecture

| Service | Platform | What it runs |
|---------|----------|-------------|
| Web app, API routes, webhooks | **Vercel** (project `fair-synq`) | Next.js app — every `/api/*` route, including the Stripe, Stripe Connect and Clerk webhooks |
| Worker | **Railway** | `npm run worker` (`workers/index.ts`) — BullMQ order jobs (accept timeouts, refunds, payouts) and the reconciler sweep |
| Queue | **Upstash Redis** | BullMQ queue (`REDIS_URL`) and rate limiting (`UPSTASH_REDIS_REST_*`) |
| Database + storage | **Supabase** | PostgreSQL and the document/photo storage buckets |
| Auth | **Clerk** | Sign-in for customers, vendors, runners, organizers and admins |
| Payments | **Stripe** | Separate charges and transfers, Connect payouts to vendors, runners and organizers |

### Domains

- **`https://www.fairsynq.com` is canonical.** `NEXT_PUBLIC_APP_URL` must be exactly this.
- `fairsynq.com` 308s to www (Vercel domain setting).
- `fair-synq.vercel.app` 308s to www, path and query kept (host-matched redirects in `vercel.json`).
- Per-deployment URLs (`fair-synq-<hash>-…vercel.app`) are not redirected and stay behind Vercel
  deployment protection.

### Why a separate worker?

BullMQ delayed jobs (for example the 10-minute vendor accept timeout) and the reconciler sweep need
a persistent process, which serverless functions are not. The worker shares the database, Redis
and Stripe credentials with the web app but serves no HTTP traffic. Webhooks are handled by the
Next.js routes on Vercel; the worker only consumes the jobs those routes enqueue.

---

## Prerequisites

- GitHub repo `Ferannn-TDE/FairDash`, deploying from `main`
- Supabase project (existing DB — do not create a new one)
- Clerk application
- Stripe account with Connect enabled
- Upstash Redis database
- Firebase project with Realtime Database enabled
- Google Maps API key (Places autocomplete on checkout)

---

## Step 1 — Database

1. Supabase Dashboard → your project → **Settings → Database → Connection string**.
2. Copy two strings:

   **Transaction pooler** (Vercel functions) → `DATABASE_URL`:
   ```
   postgresql://postgres.YOURREF:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

   **Direct connection** (Prisma migrations, Railway worker) → `DIRECT_URL`:
   ```
   postgresql://postgres.YOURREF:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

3. Run migrations against the direct URL before deploying:
   ```bash
   DIRECT_URL="<direct-url>" DATABASE_URL="<pooler-url>" npx prisma migrate deploy
   ```

---

## Step 2 — Vercel (web app)

1. Import the repo in Vercel. Next.js is auto-detected; `npm run build` runs
   `prisma generate && next build`.
2. **Project Settings → Environment Variables** — add everything in the `FRONTEND (VERCEL)` section
   of `.env.example`. The ones that are easy to get wrong:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://www.fairsynq.com` (no trailing slash). Production only today — preview deploys need their own value or Connect onboarding links throw. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the Stripe platform endpoint (Step 4) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret of the Stripe Connect event destination (Step 4) |
| `CLERK_WEBHOOK_SECRET` | Signing secret of the Clerk webhook (Step 5) |
| `REDIS_URL` | Upstash `rediss://` URL — the same value as on Railway |
| `HEALTH_WORKER_STALE_SEC` | `360` — must exceed the worker's sweep interval |

3. **Domains:** add `www.fairsynq.com` and `fairsynq.com` (apex redirects to www).
4. Deploy. `NEXT_PUBLIC_*` values are baked in at build time, so after changing one, redeploy
   without the build cache.

---

## Step 3 — Railway (worker)

1. Create a service from the same repo, start command `npm run worker`.
2. Variables: the shared values listed in the `WORKER (RAILWAY)` section of `.env.example`, plus the
   `WORKER_*` throttle settings (`timer` scheduler, 120s sweep — sized for the Upstash free tier;
   see `lib/worker-config.ts`).
3. Deployment settings: `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` and
   `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`, so two workers never sweep at once during a deploy and
   the old one finishes its in-flight sweep.
4. On boot the worker logs a `[Worker] config …` line with every throttle value. Check it after
   changing a variable.

---

## Step 4 — Stripe webhooks

Two separate destinations, each with its own signing secret:

| Destination | URL | Secret |
|-------------|-----|--------|
| Platform endpoint (v1 snapshot events: `payment_intent.*`, `charge.*` incl. refunds and disputes) | `https://www.fairsynq.com/api/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Connect event destination (v2 thin events: account requirements and capabilities) | `https://www.fairsynq.com/api/stripe/connect-webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

To move a destination to a new URL, **edit it in place** — creating a new one issues a new
signing secret that no longer matches Vercel.

Also register `www.fairsynq.com` and `fairsynq.com` as payment method domains (Apple Pay, Google
Pay, Link).

---

## Step 5 — Clerk webhook

Clerk Dashboard → **Webhooks** → endpoint `https://www.fairsynq.com/api/webhooks/clerk`. The
handler acts on `user.created`, `user.updated`, `user.deleted` and `session.created` and returns
200 for anything else. Copy the signing secret into
`CLERK_WEBHOOK_SECRET`. As with Stripe, change the URL in place rather than recreating the endpoint.

---

## Step 6 — Verify

```bash
curl -s https://www.fairsynq.com/api/health | jq '{status, web: .commit, checks, flags}'
```

Expect `status: "ok"`, `database` and `redis` `ok`, and `worker.status: "ok"` with a recent
`lastSweepAt`. There are two fingerprints: `.commit` is the web build, `.checks.worker.commit` is
the Railway worker — check both after a deploy.

Webhooks: send a test event from each dashboard (Stripe, Stripe Connect destination "ping", Clerk)
and confirm a 200 for the matching path on `www.fairsynq.com` in Vercel's request logs.

---

## Troubleshooting

### Worker shows `stale` on /api/health

The worker writes a heartbeat to Redis on every sweep. Stale means it has not swept within
`HEALTH_WORKER_STALE_SEC`: check Railway logs for the boot `[Worker] config` line and sweep
summaries, and confirm `REDIS_URL` is identical on Vercel and Railway.

### FIREBASE_PRIVATE_KEY line breaks

Firebase private keys contain literal `\n` characters. Paste the raw key with real newlines (use the
multi-line env var editor) or wrap it in quotes:
`"-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----\n"`.

### Connect onboarding link fails

The onboarding routes build return URLs from `NEXT_PUBLIC_APP_URL` (`lib/app-url.ts`) and throw if
it is unset — check it is set for the environment you are testing in, then redeploy.

---

## Local Development

```bash
cp .env.example .env.local
# Fill in values

npm run dev          # Next.js (frontend + API routes + webhooks) on localhost:3000
npm run worker       # BullMQ worker + reconciler sweep
npm run gate         # full test gate against the Docker test DB
```
