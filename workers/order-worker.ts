/**
 * FairSynq Order Worker
 *
 * Standalone BullMQ consumer. Run separately from Next.js:
 *   npm run worker
 *
 * Uses DIRECT_URL (session pooler) instead of DATABASE_URL (transaction pooler)
 * because workers hold open transactions and are incompatible with pgBouncer.
 *
 * Handles all jobs in the fairsynq-orders queue. Firebase writes use the
 * namespaced path fairs/{eventId}/... so multiple simultaneous events
 * never collide in the Realtime DB.
 */

import { Worker, Job, ConnectionOptions } from 'bullmq'
import { PrismaClient, OrderStatus, DisputeStatus } from '@prisma/client'
import Stripe from 'stripe'
import admin from 'firebase-admin'
import {
  ORDER_QUEUE_NAME,
  JOB_UNACCEPTED,
  JOB_UNCOLLECTED,
  JOB_UNDELIVERABLE,
  JOB_HIDE_VENDOR,
  JOB_INCIDENT_REFUND,
  JOB_ESCALATE_DISPUTE,
  JOB_POST_EVENT_REPORT,
  JOB_BULK_REFUND,
  JobData,
} from '../lib/queues'
import {
  VENDOR_OFFLINE_HEARTBEAT_MS,
} from '../lib/constants'

// ─── Bootstrap ────────────────────────────────────────────────────────────────

require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error('[Worker] REDIS_URL is not set — cannot start worker')
  process.exit(1)
}

// Use DIRECT_URL for the worker — avoids pgBouncer transaction mode restrictions
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// Stripe — direct init (not the Next.js singleton)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2023-10-16',
  typescript: true,
})

// Firebase Admin
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

function getRtdb() {
  if (!admin.apps.length) return null
  return admin.database()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Update vendor + customer Firebase nodes under the namespaced fair path. */
async function updateOrderInFirebase(
  eventId: string,
  vendorId: string,
  orderId: string,
  customerId: string,
  payload: Record<string, unknown>
) {
  const db = getRtdb()
  if (!db) return
  await Promise.all([
    db.ref(`fairs/${eventId}/orders/${vendorId}/${orderId}`).update(payload),
    db.ref(`fairs/${eventId}/customerOrders/${customerId}/${orderId}`).update(payload),
  ])
}

// ─── Job handlers ─────────────────────────────────────────────────────────────

/**
 * mark-unaccepted
 * Fires 2 minutes after an order is PLACED.
 * If vendor still hasn't accepted → CANCELLED + full Stripe refund.
 */
async function handleMarkUnaccepted(job: Job<JobData>) {
  const { orderId, vendorId, eventId } = job.data
  if (!orderId || !vendorId) return
  console.log(`[Worker] mark-unaccepted → order ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  if (!order || order.status !== OrderStatus.PLACED) {
    console.log(`[Worker] Order ${orderId} is no longer PLACED (${order?.status}) — skipping`)
    return
  }

  // Issue full Stripe refund
  if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId })
    } catch (err) {
      console.error(`[Worker] Stripe refund failed for order ${orderId}:`, err)
      // Don't block the status update — log and continue
    }
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: 'system',
        cancellationReason: 'Vendor did not accept within 2 minutes',
      },
    }),
    prisma.cancellation.upsert({
      where: { orderId },
      create: {
        orderId,
        vendorId: order.vendorId,
        reason: 'Vendor did not accept within 2 minutes',
        refundIssued: true,
        refundAmount: order.total,
      },
      update: { refundIssued: true, refundAmount: order.total },
    }),
    prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'cancelled',
        actorId: null,
        actorRole: 'system',
        metadata: { reason: 'Vendor did not accept within 2 minutes', refundAmount: order.total },
      },
    }),
  ])

  await updateOrderInFirebase(eventId, vendorId, orderId, order.customerId, {
    status: 'CANCELLED',
    cancellationReason: 'Vendor did not accept within 2 minutes',
  })

  console.log(`[Worker] Order ${orderId} auto-cancelled — vendor did not accept in time`)
}

/**
 * mark-uncollected
 * Fires 10 minutes after BOOTH_PICKUP / CURBSIDE order is marked READY.
 * No refund — customer no-show.
 */
async function handleMarkUncollected(job: Job<JobData>) {
  const { orderId, vendorId, eventId } = job.data
  if (!orderId || !vendorId) return
  console.log(`[Worker] mark-uncollected → order ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  if (!order || order.status !== OrderStatus.READY) {
    console.log(`[Worker] Order ${orderId} is no longer READY (${order?.status}) — skipping`)
    return
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.UNCOLLECTED,
        uncollectedAt: new Date(),
      },
    }),
    prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'uncollected',
        actorRole: 'system',
        metadata: { fulfillmentType: order.fulfillmentType },
      },
    }),
  ])

  await updateOrderInFirebase(eventId, vendorId, orderId, order.customerId, {
    status: 'UNCOLLECTED',
    uncollectedAt: Date.now(),
  })

  console.log(`[Worker] Order ${orderId} marked UNCOLLECTED`)
}

/**
 * mark-undeliverable
 * Fires 10 minutes after HOME_DELIVERY order is marked READY.
 * No refund — runner could not complete delivery.
 */
async function handleMarkUndeliverable(job: Job<JobData>) {
  const { orderId, vendorId, eventId } = job.data
  if (!orderId || !vendorId) return
  console.log(`[Worker] mark-undeliverable → order ${orderId}`)

  const order = await prisma.order.findUnique({ where: { id: orderId } })

  if (!order || order.status !== OrderStatus.READY) {
    console.log(`[Worker] Order ${orderId} is no longer READY (${order?.status}) — skipping`)
    return
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.UNDELIVERABLE },
    }),
    prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'undeliverable',
        actorRole: 'system',
      },
    }),
  ])

  await updateOrderInFirebase(eventId, vendorId, orderId, order.customerId, {
    status: 'UNDELIVERABLE',
  })

  console.log(`[Worker] Order ${orderId} marked UNDELIVERABLE`)
}

/**
 * auto-hide-vendor
 * Fires 5 minutes after a vendor's heartbeat goes stale.
 * Checks lastHeartbeatAt before acting — a fresh heartbeat arriving before
 * this job fires will have updated the DB, so the guard prevents a false hide.
 */
async function handleAutoHideVendor(job: Job<JobData>) {
  const { vendorId, eventId } = job.data
  if (!vendorId) return
  console.log(`[Worker] auto-hide-vendor → vendor ${vendorId}`)

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } })
  if (!vendor) return

  // Guard: if a heartbeat arrived after this job was scheduled, do nothing
  if (vendor.lastHeartbeatAt) {
    const msSinceHeartbeat = Date.now() - vendor.lastHeartbeatAt.getTime()
    if (msSinceHeartbeat < VENDOR_OFFLINE_HEARTBEAT_MS) {
      console.log(`[Worker] Vendor ${vendorId} heartbeat is fresh — skipping auto-hide`)
      return
    }
  }

  if (vendor.isOffline) {
    console.log(`[Worker] Vendor ${vendorId} already offline — skipping`)
    return
  }

  await prisma.vendor.update({
    where: { id: vendorId },
    data: { isOffline: true },
  })

  // Notify vendor dashboard via Firebase
  const db = getRtdb()
  if (db) {
    await db.ref(`fairs/${eventId}/heartbeats/${vendorId}`).update({
      autoHidden: true,
      autoHiddenAt: Date.now(),
    })
  }

  console.log(`[Worker] Vendor ${vendorId} auto-hidden from menu (heartbeat stale)`)
}

/**
 * incident-auto-refund
 * Fires 5 minutes after an IncidentReport is filed.
 * If the operator has not responded (resolvedAt is null), issues an automatic refund.
 */
async function handleIncidentAutoRefund(job: Job<JobData>) {
  const { incidentId } = job.data
  if (!incidentId) return
  console.log(`[Worker] incident-auto-refund → incident ${incidentId}`)

  const incident = await prisma.incidentReport.findUnique({
    where: { id: incidentId },
    include: { order: true },
  })

  if (!incident) return

  // Guard: operator already responded
  if (incident.resolvedAt) {
    console.log(`[Worker] Incident ${incidentId} already resolved — skipping auto-refund`)
    return
  }

  const order = incident.order

  // Determine refund amount: entire order unless affectedItems specifies partials
  const isFullOrder = !incident.affectedItems
  let refundAmount = order.total

  if (!isFullOrder && Array.isArray(incident.affectedItems)) {
    // Partial refund: sum subtotals of affected OrderItems
    const affectedIds = incident.affectedItems as string[]
    const affectedItems = await prisma.orderItem.findMany({
      where: { id: { in: affectedIds }, orderId: order.id },
    })
    refundAmount = affectedItems.reduce((sum, i) => sum + i.subtotal, 0)
  }

  // Issue Stripe refund
  if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        amount: Math.round(refundAmount * 100),
      })
    } catch (err) {
      console.error(`[Worker] Stripe refund failed for incident ${incidentId}:`, err)
      return
    }
  }

  await prisma.$transaction([
    prisma.incidentReport.update({
      where: { id: incidentId },
      data: {
        resolvedAt: new Date(),
        resolution: isFullOrder ? 'full_refund' : 'partial_refund',
        autoRefundTriggered: true,
      },
    }),
    prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: 'incident_auto_refund',
        actorRole: 'system',
        metadata: { incidentId, refundAmount, isFullOrder },
      },
    }),
  ])

  console.log(`[Worker] Incident ${incidentId} auto-refunded: $${refundAmount.toFixed(2)}`)
}

/**
 * escalate-dispute
 * Fires 24 hours after a Dispute is filed in OPEN status.
 * If admin has not resolved it, escalates to ESCALATED.
 */
async function handleEscalateDispute(job: Job<JobData>) {
  const { disputeId } = job.data
  if (!disputeId) return
  console.log(`[Worker] escalate-dispute → dispute ${disputeId}`)

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } })
  if (!dispute) return

  if (dispute.status !== DisputeStatus.OPEN) {
    console.log(`[Worker] Dispute ${disputeId} is no longer OPEN (${dispute.status}) — skipping`)
    return
  }

  await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: DisputeStatus.ESCALATED },
  })

  console.log(`[Worker] Dispute ${disputeId} escalated — no admin response within 24 hours`)
}

/**
 * generate-post-event-report
 * Fires immediately (delay: 0) when admin closes an event.
 * Full implementation in Phase 1.10 — stub logs intent and returns.
 */
async function handleGeneratePostEventReport(job: Job<JobData>) {
  const { eventId } = job.data
  console.log(`[Worker] generate-post-event-report → event ${eventId}`)
  // TODO Phase 1.10: implement lib/reports/post-event-report.ts
  // const report = await buildPostEventReport(eventId)
  // await sendReportEmail(report)
  console.log(`[Worker] Post-event report generation not yet implemented — Phase 1.10`)
}

/**
 * bulk-refund-event
 * Fires immediately (delay: 0) on Emergency Cancel.
 * Full implementation in Phase 3.5 — stub logs intent and returns.
 */
async function handleBulkRefundEvent(job: Job<JobData>) {
  const { eventId } = job.data
  console.log(`[Worker] bulk-refund-event → event ${eventId}`)
  // TODO Phase 3.5: fetch all PLACED/ACCEPTED/PREPARING/READY orders for event
  // Issue Stripe refunds for each, update statuses, notify customers
  console.log(`[Worker] Bulk refund not yet implemented — Phase 3.5`)
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

const worker = new Worker<JobData>(
  ORDER_QUEUE_NAME,
  async (job: Job<JobData>) => {
    switch (job.name) {
      case JOB_UNACCEPTED:
        await handleMarkUnaccepted(job)
        break
      case JOB_UNCOLLECTED:
        await handleMarkUncollected(job)
        break
      case JOB_UNDELIVERABLE:
        await handleMarkUndeliverable(job)
        break
      case JOB_HIDE_VENDOR:
        await handleAutoHideVendor(job)
        break
      case JOB_INCIDENT_REFUND:
        await handleIncidentAutoRefund(job)
        break
      case JOB_ESCALATE_DISPUTE:
        await handleEscalateDispute(job)
        break
      case JOB_POST_EVENT_REPORT:
        await handleGeneratePostEventReport(job)
        break
      case JOB_BULK_REFUND:
        await handleBulkRefundEvent(job)
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
console.log(`[Worker] Handlers: ${[
  JOB_UNACCEPTED, JOB_UNCOLLECTED, JOB_UNDELIVERABLE,
  JOB_HIDE_VENDOR, JOB_INCIDENT_REFUND, JOB_ESCALATE_DISPUTE,
  JOB_POST_EVENT_REPORT, JOB_BULK_REFUND,
].join(', ')}`)

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown() {
  console.log('[Worker] Shutting down...')
  await worker.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
