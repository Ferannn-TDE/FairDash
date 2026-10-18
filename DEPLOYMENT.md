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

**Local processes never touch production by default.** `.env.local` and `.env` point at a Docker
stack on this machine, and `lib/prod-db-guard.ts` refuses a production database (or a remote job
queue) in any process that is not running on Vercel or Railway — the dev server, the seed, a local
worker and every script that builds a database client. The gate suite `prod-db-guard` fails if a
new script constructs a client without the guard.

| Local service | Where | Notes |
|---------------|-------|-------|
| Postgres | `localhost:54329` (`fairsynq_dev`) | Persistent volume; separate from the gate's test DB on 55432 |
| Redis (BullMQ queue) | `localhost:56379` | The production queue is consumed by the Railway worker, so local jobs stay here |
| Upstash-compatible REST | `localhost:58079` | Backs the rate limiter; checkout fails closed without one |
| Supabase Storage, Firebase | off | Uploads and live push are disabled locally until dev projects exist |
| Clerk, Stripe, Maps | shared test-mode keys | Clerk webhooks reach production only; the app creates the local User row on first sign-in (`lib/ensure-db-user.ts`) |

```bash
npm run dev:db:up       # start Postgres + Redis + REST proxy, apply migrations
npm run dev:db:seed     # load prisma/seed.ts (also: npx prisma db seed)
npm run dev             # Next.js on localhost:3000
WORKER_ENABLED=true npm run worker   # optional: a local worker on the local queue
npm run dev:db:down     # stop, keep data      ·  npm run dev:db:reset  # stop and wipe
npm run gate            # full test gate (its own throwaway DB on 55432)
```

To test Stripe webhooks locally, forward them with `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` and put the `whsec_…` it prints in `STRIPE_WEBHOOK_SECRET` in
`.env.local` for that session.

### Switching to production (deliberate operations only)

Production credentials live in `.env.prod.local` (git-ignored, never auto-loaded — Next.js and
dotenv only read `.env`, `.env.local` and `.env.<NODE_ENV>[.local]`). The only supported way to aim
a local command at production is the wrapper, with the Supabase project ref typed out:

```bash
CONFIRM_PROD_DB=<project ref> ./scripts/with-prod-db.sh npx tsx scripts/<operation>.ts
CONFIRM_PROD_DB=<project ref> ./scripts/with-prod-db.sh npm run migrate
```

The wrapper exports the production `DATABASE_URL`/`DIRECT_URL` and **clears `REDIS_URL`**, so an
operation run from a laptop never enqueues into the live queue. Without `CONFIRM_PROD_DB`, or with
the wrong ref, the guard refuses before any connection is made. Back to local: just run commands
normally — nothing persists between invocations.
