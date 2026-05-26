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
  JOB_VENDOR_PAYOUT,
  JOB_REFUND,
  JobData,
} from '../lib/queues'
import {
  VENDOR_OFFLINE_HEARTBEAT_MS,
} from '../lib/constants'

// ─── Bootstrap ────────────────────────────────────────────────────────────────

require('dotenv').config({ path: '.env.local' })
require('dotenv').config({ path: '.env' })

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
 * Refunds all open orders for the event and marks them CANCELLED.
 * Terminal states (COMPLETED, CANCELLED, UNCOLLECTED, UNDELIVERABLE) are skipped.
 */
async function handleBulkRefundEvent(job: Job<JobData>) {
  const { eventId } = job.data
  if (!eventId) return
  console.log(`[Worker] bulk-refund-event → event ${eventId}`)

  const openStatuses = [
    OrderStatus.PLACED,
    OrderStatus.ACCEPTED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
  ] as const

  const orders = await prisma.order.findMany({
    where: { eventId, status: { in: [...openStatuses] } },
  })

  if (orders.length === 0) {
    console.log(`[Worker] bulk-refund-event: no open orders for event ${eventId}`)
    return
  }

  console.log(`[Worker] bulk-refund-event: refunding ${orders.length} orders`)

  const results = await Promise.allSettled(
    orders.map(async order => {
      // Issue Stripe refund (best-effort — log failures but continue)
      if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
        try {
          await stripe.refunds.create({
            payment_intent: order.stripePaymentIntentId,
            metadata: { reason: 'emergency_event_cancel', eventId },
          })
        } catch (err) {
          console.error(`[Worker] bulk-refund: Stripe refund failed for order ${order.id}:`, err)
          // Don't skip the DB update — partial refund failure is better than leaving the order open
        }
      }

      // Cancel the order and write audit records atomically
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledBy: 'system',
            cancellationReason: 'Event cancelled by operator',
          },
        }),
        prisma.cancellation.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            vendorId: order.vendorId,
            reason: 'Event cancelled by operator',
            refundIssued: true,
            refundAmount: order.total,
          },
          update: { refundIssued: true, refundAmount: order.total },
        }),
        prisma.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'cancelled',
            actorRole: 'system',
            metadata: { reason: 'emergency_event_cancel', eventId, refundAmount: order.total },
          },
        }),
      ])

      // Update Firebase for both vendor dashboard and customer tracking
      await updateOrderInFirebase(eventId, order.vendorId, order.id, order.customerId, {
        status: 'CANCELLED',
        cancellationReason: 'Event cancelled by operator',
      })
    })
  )

  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length > 0) {
    console.error(`[Worker] bulk-refund-event: ${failed.length}/${orders.length} orders failed`)
    failed.forEach(r => console.error((r as PromiseRejectedResult).reason))
    // Throw so BullMQ marks the job as failed and retries
    throw new Error(`Bulk refund partially failed: ${failed.length} orders errored`)
  }

  console.log(`[Worker] bulk-refund-event: ${orders.length} orders cancelled and refunded`)
}

/**
 * process-vendor-payout
 * Executes the Stripe Connect transfer for a completed order.
 * Retries up to 3x with exponential backoff. Idempotent via Stripe idempotency key.
 * On final failure: logs and marks payoutStatus FAILED on the order.
 */
async function handleVendorPayout(job: Job<JobData>) {
  const {
    orderId,
    vendorId,
    eventId,
    vendorStripeAccountId,
    stripePaymentIntentId,
    stripeChargeId: jobChargeId,
    transferAmountCents,
    payoutIdempotencyKey,
  } = job.data

  if (!orderId || !vendorId || !vendorStripeAccountId || !transferAmountCents || !payoutIdempotencyKey) {
    console.error(`[Worker] process-vendor-payout: missing required fields in job ${job.id}`)
    return
  }

  console.log(`[Worker] process-vendor-payout → order ${orderId}, amount ${transferAmountCents}¢`)

  // Test hook: simulate failure on first attempt to verify retry behaviour
  if (process.env.TEST_RETRY_FAILURE === 'true' && job.attemptsMade === 0) {
    throw new Error('Simulated failure — TEST_RETRY_FAILURE')
  }

  // Retrieve chargeId if not supplied (needed for source_transaction)
  let chargeId = jobChargeId ?? null
  if (!chargeId && stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    try {
      const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId, {
        expand: ['latest_charge'],
      })
      const charge = pi.latest_charge
      if (charge && typeof charge === 'object' && 'id' in charge) {
        chargeId = charge.id as string
        await prisma.order.update({ where: { id: orderId }, data: { stripeChargeId: chargeId } })
      }
    } catch (err) {
      console.warn(`[Worker] process-vendor-payout: could not retrieve charge for order ${orderId}:`, err)
    }
  }

  const transfer = await stripe.transfers.create(
    {
      amount: transferAmountCents,
      currency: 'usd',
      destination: vendorStripeAccountId,
      ...(chargeId && { source_transaction: chargeId }),
      metadata: { orderId, vendorId },
    },
    { idempotencyKey: payoutIdempotencyKey }
  )

  // Fetch the order to get eventId-scoped payout fields
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { subtotal: true, fairSynqFee: true, vendorPayout: true },
  })

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: { stripeTransferId: transfer.id },
    }),
    prisma.payout.create({
      data: {
        eventId: eventId,
        vendorId: vendorId,
        grossAmount: order?.subtotal ?? 0,
        fairSynqFee: order?.fairSynqFee ?? 0,
        netAmount: order?.vendorPayout ?? transferAmountCents / 100,
        stripeTransferId: transfer.id,
        stripeStatus: 'pending',
        processedAt: new Date(),
      },
    }),
  ])

  console.log(`[Worker] Transfer ${transfer.id} created for order ${orderId}`)
}

/**
 * process-refund
 * Issues a Stripe refund for a cancelled order.
 * Idempotent via Stripe idempotency key + BullMQ jobId deduplication.
 * Updates the Cancellation record with the issued refund amount on success.
 */
async function handleRefund(job: Job<JobData>) {
  const {
    orderId,
    vendorId,
    cancellationVendorId,
    stripePaymentIntentId,
    stripeChargeId,
    refundReason,
    refundIdempotencyKey,
    refundAmountCents,
  } = job.data

  if (!orderId || !stripePaymentIntentId || !refundIdempotencyKey) {
    console.error(`[Worker] process-refund: missing required fields in job ${job.id}`)
    return
  }

  console.log(`[Worker] process-refund → order ${orderId}`)

  const baseParams = stripeChargeId
    ? { charge: stripeChargeId, metadata: { orderId, reason: refundReason ?? 'cancelled' } }
    : { payment_intent: stripePaymentIntentId, metadata: { orderId, reason: refundReason ?? 'cancelled' } }
  const refundParams = refundAmountCents
    ? { ...baseParams, amount: refundAmountCents }
    : baseParams

  const refund = await stripe.refunds.create(
    refundParams,
    { idempotencyKey: refundIdempotencyKey }
  )

  const refundAmount = refund.amount / 100

  await prisma.cancellation.upsert({
    where: { orderId },
    create: {
      orderId,
      vendorId: cancellationVendorId ?? vendorId ?? '',
      reason: refundReason ?? null,
      refundIssued: true,
      refundAmount,
    },
    update: { refundIssued: true, refundAmount },
  })

  console.log(`[Worker] Refund ${refund.id} issued for order ${orderId} — $${refundAmount.toFixed(2)}`)
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

export function startOrderWorker() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('[Worker] REDIS_URL is not set — cannot start worker')
    process.exit(1)
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
        case JOB_VENDOR_PAYOUT:
          await handleVendorPayout(job)
          break
        case JOB_REFUND:
          await handleRefund(job)
          break
        default:
          console.warn(`[Worker] Unknown job: ${job.name}`)
      }
    },
    { connection, concurrency: 5 }
  )

  worker.on('completed', async job => {
    console.log(`[Worker] ✓ ${job.name} (${job.id}) completed`)

    if (job.name === JOB_VENDOR_PAYOUT && job.data.orderId) {
      await prisma.order.update({
        where: { id: job.data.orderId },
        data: { payoutStatus: 'COMPLETED' },
      }).catch(e => console.error('[Worker] Failed to set payoutStatus=COMPLETED:', e))
    }
  })

  worker.on('failed', async (job, err) => {
    console.error(`[Worker] ✗ ${job?.name} (${job?.id}) failed after ${job?.attemptsMade} attempt(s):`, err.message)

    if (
      job?.name === JOB_VENDOR_PAYOUT &&
      job?.data?.orderId &&
      job.attemptsMade >= (job.opts.attempts ?? 3)
    ) {
      await prisma.order.update({
        where: { id: job.data.orderId },
        data: { payoutStatus: 'FAILED' },
      }).catch(e => console.error('[Worker] Failed to set payoutStatus=FAILED:', e))
      console.error(`[Worker] Payout permanently FAILED for order ${job.data.orderId} — manual intervention required`)
    }
  })

  worker.on('error', err => {
    console.error('[Worker] Connection error:', err)
  })

  console.log(`[Worker] Listening on queue: ${ORDER_QUEUE_NAME}`)
  console.log(`[Worker] Handlers: ${[
    JOB_UNACCEPTED, JOB_UNCOLLECTED, JOB_UNDELIVERABLE,
    JOB_HIDE_VENDOR, JOB_INCIDENT_REFUND, JOB_ESCALATE_DISPUTE,
    JOB_POST_EVENT_REPORT, JOB_BULK_REFUND,
    JOB_VENDOR_PAYOUT, JOB_REFUND,
  ].join(', ')}`)

  return worker
}
