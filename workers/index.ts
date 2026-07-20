/**
 * FairSynq Worker Process
 *
 * Entry point for the BullMQ worker process — runs separately from the
 * Express webhook server and from Next.js.
 *
 * Start via:
 *   npm run worker
 *
 * On Render: deploy as a background worker service pointing to this file.
 * The webhook server (npm run server) must be a SEPARATE service.
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

// ── WORKER GATE ───────────────────────────────────────────────────────────────
// The worker is a MONEY ACTOR: it pays vendors, fires timeouts, and runs the
// reconcile sweep every 60s against the production DB. Any process that starts it
// with the live REDIS_URL becomes a silent money actor — a dev machine running
// `npm run worker` out of habit already caused an unplanned executor run.
// So startup requires explicit intent: WORKER_ENABLED=true, set ONLY on the real
// worker host (Railway). Absent or anything else → exit loudly, run nothing.
if (process.env.WORKER_ENABLED !== 'true') {
  console.error(
    '[Workers] REFUSING TO START — WORKER_ENABLED is not "true". ' +
    'This process pays real money and sweeps the production ledger; it must only run ' +
    'on the designated worker host. Set WORKER_ENABLED=true there (and only there).',
  )
  process.exit(0)
}

// Dynamic import AFTER the gate — a static `import` hoists and would load (and run any
// module-level side effects of) the worker module before the gate executes.
const { startOrderWorker } = await import('./order-worker')

// Deploy fingerprint in the boot line: the health endpoint fingerprints Vercel,
// but the worker is a separate deploy on a separate host — this is the ONLY place
// its served commit surfaces. Railway injects RAILWAY_GIT_COMMIT_SHA.
const commit =
  process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown'
console.log(`[Workers] Starting... (WORKER_ENABLED=true, commit=${commit})`)

const workers = [
  startOrderWorker(),
]

async function shutdown() {
  console.log('[Workers] Graceful shutdown...')
  await Promise.all(workers.map(w => w.close()))
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT',  shutdown)
