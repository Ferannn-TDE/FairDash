# FairSynq Deployment Guide

## Architecture

| Service | Platform | What it runs |
|---------|----------|-------------|
| Frontend + API routes | **Vercel** (free Hobby) | Next.js app — React SPA + all `/api/*` serverless functions |
| Webhook server + worker | **Render** (free tier) | Express server handling Clerk/Stripe webhooks + BullMQ order-timeout worker |
| Database | **Supabase** | Existing PostgreSQL instance — no changes needed |

### Why two services?

The Next.js API routes (`/api/orders`, `/api/vendors`, etc.) use `@clerk/nextjs/server` and `next/headers` — APIs that are only available inside the Next.js runtime. Vercel runs them natively as serverless functions.

The BullMQ worker (`workers/order-worker.ts`) processes delayed jobs (e.g. marking an uncollected order after 15 minutes) and must run as a **persistent process** — something serverless functions can't do. The webhook handlers are co-located on the same Render service for simplicity.

---

## Prerequisites

- GitHub repo with the FairSynq codebase pushed to `main`
- [Supabase](https://supabase.com) project already set up (existing DB — do not create a new one)
- [Clerk](https://clerk.com) application created
- [Stripe](https://stripe.com) account with Connect enabled
- [Upstash](https://upstash.com) Redis instance (free tier, for BullMQ)
- [Firebase](https://firebase.google.com) project with Realtime Database enabled

---

## Step 1 — Get your Supabase connection strings

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Go to **Settings → Database**
3. Scroll to **Connection string** section
4. Copy two strings:

   **Transaction pooler** (for Vercel serverless functions):
   ```
   postgresql://postgres.YOURREF:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
   ```

   **Direct connection** (for Render persistent server + Prisma migrations):
   ```
   postgresql://postgres.YOURREF:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```

5. Run migrations against the direct URL before deploying:
   ```bash
   DIRECT_URL="<direct-url>" DATABASE_URL="<pooler-url>" npx prisma migrate deploy
   ```

---

## Step 2 — Deploy Frontend to Vercel

### 2a. Connect repo

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel auto-detects Next.js — no framework changes needed
4. Leave **Build Command** and **Output Directory** as defaults (overridden by `vercel.json`)

### 2b. Set environment variables

In **Project Settings → Environment Variables**, add all variables from the `FRONTEND (VERCEL)` section of `.env.example`:

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL (e.g. `https://fairdash.vercel.app`) |
| `NEXT_PUBLIC_API_URL` | Your Render service URL (e.g. `https://fairdash-api.onrender.com`) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard → Webhooks (set after Step 3) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks (set after Step 4) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Cloud Console → APIs & Services |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase Console → Project Settings → General |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → Service Accounts |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts |
| `FIREBASE_PRIVATE_KEY` | Firebase Console → Generate new private key |
| `DATABASE_URL` | Supabase **Transaction pooler** URL (port 6543) |
| `DIRECT_URL` | Supabase **Direct** URL (port 5432) |
| `REDIS_URL` | Upstash Console → your Redis database |

### 2c. Deploy

Click **Deploy**. Vercel will install dependencies, run `npx prisma generate && next build`, and deploy.

---

## Step 3 — Deploy Backend to Render

### 3a. Create web service

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Web Service**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `fairdash-api`
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install && npx prisma generate`
   - **Start Command**: `npx ts-node --compiler-options '{"module":"CommonJS"}' server.ts`
   - **Plan**: Free

   > Alternatively, push `render.yaml` to your repo and use **New → Blueprint** to auto-configure everything.

### 3b. Set environment variables

In the Render service dashboard → **Environment**, add:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **transaction pooler** URL (port 6543) |
| `DIRECT_URL` | Supabase **direct** URL (port 5432) — Render uses this for the persistent connection |
| `CLERK_SECRET_KEY` | Same as Vercel |
| `CLERK_WEBHOOK_SECRET` | From Clerk Dashboard → Webhooks |
| `STRIPE_SECRET_KEY` | Same as Vercel |
| `STRIPE_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks |
| `FIREBASE_PROJECT_ID` | Same as Vercel |
| `FIREBASE_CLIENT_EMAIL` | Same as Vercel |
| `FIREBASE_PRIVATE_KEY` | Same as Vercel |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Firebase Realtime Database URL |
| `REDIS_URL` | Upstash Redis URL |
| `FRONTEND_URL` | Your Vercel URL (e.g. `https://fairdash.vercel.app`) |

### 3c. Deploy

Click **Create Web Service**. Render will build and deploy. The health check endpoint at `/health` confirms it's running.

---

## Step 4 — Configure Clerk Webhooks

1. Open [Clerk Dashboard](https://dashboard.clerk.com) → your application → **Webhooks**
2. Click **Add Endpoint**
3. Set **Endpoint URL** to:
   ```
   https://fairdash-api.onrender.com/api/webhooks/clerk
   ```
4. Subscribe to events: `user.created`, `user.updated`, `user.deleted`
5. Copy the **Signing Secret** → add it as `CLERK_WEBHOOK_SECRET` in both Vercel and Render

---

## Step 5 — Configure Stripe Webhooks

1. Open [Stripe Dashboard](https://dashboard.stripe.com) → **Developers → Webhooks**
2. Click **Add endpoint**
3. Set **Endpoint URL** to:
   ```
   https://fairdash-api.onrender.com/api/webhooks/stripe
   ```
4. Subscribe to events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `transfer.created`, `transfer.paid`
5. Copy the **Signing secret** → add it as `STRIPE_WEBHOOK_SECRET` in both Vercel and Render

---

## Step 6 — Verify everything is connected

### Health checks

```bash
# Render backend
curl https://fairdash-api.onrender.com/health
# Expected: {"status":"ok","service":"fairdash-api","timestamp":"..."}

# Vercel frontend
curl https://fairdash.vercel.app/api/health
# Expected: {"status":"ok"}
```

### Database

```bash
curl https://fairdash.vercel.app/api/test-db
# Expected: {"success":true,...}
```

### Clerk webhook (test from Clerk Dashboard)

Go to Clerk Dashboard → Webhooks → your endpoint → **Send test event** → `user.created`
Check Render logs for: `[Clerk Webhook] user.created → synced user ...`

### Stripe webhook (test from Stripe Dashboard)

Go to Stripe Dashboard → Webhooks → your endpoint → **Send test webhook** → `payment_intent.succeeded`
Check Render logs for: `[Stripe Webhook] payment_intent.succeeded → ...`

---

## Troubleshooting

### Render service sleeps after 15 minutes (free tier)

The Render free tier spins down inactive services. This is acceptable for the webhook server (Clerk/Stripe will retry failed deliveries), but means the BullMQ worker will be offline during sleep.

**Fix**: Use [UptimeRobot](https://uptimerobot.com) (free) to ping `https://fairdash-api.onrender.com/health` every 10 minutes, keeping the service alive.

### Build fails because `ts-node` or `prisma` not found

The Render build command uses `npm install --include=dev` to ensure `ts-node`, `prisma`, and TypeScript type packages are available even when `NODE_ENV=production`. This is already set in `render.yaml`. If you created the service manually, make sure your **Build Command** is:
```
npm install --include=dev && npx prisma generate
```

### FIREBASE_PRIVATE_KEY line breaks

Firebase private keys contain literal `\n` characters. When pasting into Render/Vercel, paste the raw key with actual newlines (use the multi-line env var editor) or wrap in quotes: `"-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----\n"`.

### CORS errors from frontend

Check that `FRONTEND_URL` on Render exactly matches your Vercel deployment URL (no trailing slash). If using a custom domain, update `FRONTEND_URL` to the custom domain.

### Prisma migration in CI

Run migrations manually before deploying:
```bash
DATABASE_URL="<pooler-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```
Or add it to the Render **Build Command**:
```
npm install && npx prisma generate && npx prisma migrate deploy
```

---

## Local Development

```bash
cp .env.example .env.local
# Fill in values

npm run dev          # Next.js (frontend + API routes) on localhost:3000
npm run start:api    # Express server (webhooks + worker) on localhost:8080
npm run worker       # BullMQ worker only (standalone)
```
