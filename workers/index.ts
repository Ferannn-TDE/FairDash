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

import { startOrderWorker } from './order-worker'

console.log('[Workers] Starting...')

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
