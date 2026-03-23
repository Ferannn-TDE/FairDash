/**
 * FairSynq Order Worker
 *
 * Standalone BullMQ consumer. Run separately from Next.js:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' workers/order-worker.ts
 *
 * Or add to package.json scripts:
 *   "worker": "ts-node --compiler-options {\"module\":\"CommonJS\"} workers/order-worker.ts"
 *
 * Handles:
 *   - mark-uncollected: fires 15 min after READY for BOOTH_PICKUP / CURBSIDE orders
 *   - mark-undeliverable: fires for HOME_DELIVERY orders that time out
 */

import { Worker, Job, ConnectionOptions } from 'bullmq'
import { PrismaClient, OrderStatus } from '@prisma/client'
import admin from 'firebase-admin'
import {
  ORDER_QUEUE_NAME,
  JOB_UNCOLLECTED,
  JOB_UNDELIVERABLE,
  UncollectedJobData,
} from '../lib/queues'

// ─── Init ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error('[Worker] REDIS_URL is not set — cannot start worker')
  process.exit(1)
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// Firebase Admin — same init pattern as lib/firebase-admin.ts
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    })
  } else {
    console.warn('[Worker] Firebase credentials missing — RTDB writes disabled')
  }
}

function getDb() {
  if (!admin.apps.length) return null
  return admin.database()
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

async function handleMarkUncollected(job: Job<UncollectedJobData>) {
  const { orderId, vendorId } = job.data
  console.log(`[Worker] mark-uncollected → order ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  // Guard: only act if order is still READY (vendor may have completed it manually)
  if (!order || order.status !== OrderStatus.READY) {
    console.log(`[Worker] Order ${orderId} is no longer READY (${order?.status}) — skipping`)
    return
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.UNCOLLECTED,
      uncollectedAt: new Date(),
    },
  })

  // Firebase RTDB update
  const db = getDb()
  if (db) {
    await db.ref(`orders/${vendorId}/${orderId}`).update({
      status: 'UNCOLLECTED',
      uncollectedAt: Date.now(),
    })
    // Notify customer
    const customerId = order.customerId
    await db.ref(`customerOrders/${customerId}/${orderId}`).update({
      status: 'UNCOLLECTED',
    })
  }

  console.log(`[Worker] Order ${orderId} marked UNCOLLECTED`)
}

async function handleMarkUndeliverable(job: Job<UncollectedJobData>) {
  const { orderId, vendorId } = job.data
  console.log(`[Worker] mark-undeliverable → order ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  if (!order || order.status !== OrderStatus.READY) {
    console.log(`[Worker] Order ${orderId} is no longer READY — skipping`)
    return
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.UNDELIVERABLE },
  })

  const db = getDb()
  if (db) {
    await db.ref(`orders/${vendorId}/${orderId}`).update({ status: 'UNDELIVERABLE' })
    await db.ref(`customerOrders/${order.customerId}/${orderId}`).update({
      status: 'UNDELIVERABLE',
    })
  }

  console.log(`[Worker] Order ${orderId} marked UNDELIVERABLE`)
}

// ─── Worker ───────────────────────────────────────────────────────────────────

function buildConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url)
  const opts: ConnectionOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
  if (parsed.password) (opts as Record<string, unknown>).password = decodeURIComponent(parsed.password)
  if (parsed.username && parsed.username !== 'default') {
    (opts as Record<string, unknown>).username = decodeURIComponent(parsed.username)
  }
  if (parsed.protocol === 'rediss:') (opts as Record<string, unknown>).tls = {}
  return opts
}

const connection = buildConnectionOptions(redisUrl)

const worker = new Worker<UncollectedJobData>(
  ORDER_QUEUE_NAME,
  async (job: Job<UncollectedJobData>) => {
    switch (job.name) {
      case JOB_UNCOLLECTED:
        await handleMarkUncollected(job)
        break
      case JOB_UNDELIVERABLE:
        await handleMarkUndeliverable(job)
        break
      default:
        console.warn(`[Worker] Unknown job: ${job.name}`)
    }
  },
  { connection, concurrency: 5 }
)

worker.on('completed', job => {
  console.log(`[Worker] ✓ ${job.name} (${job.id}) completed`)
})

worker.on('failed', (job, err) => {
  console.error(`[Worker] ✗ ${job?.name} (${job?.id}) failed:`, err.message)
})

worker.on('error', err => {
  console.error('[Worker] Connection error:', err)
})

console.log(`[Worker] Listening on queue: ${ORDER_QUEUE_NAME}`)

// Graceful shutdown
async function shutdown() {
  console.log('[Worker] Shutting down...')
  await worker.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
