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

import dotenv from 'dotenv'
import { Worker, Job, ConnectionOptions, UnrecoverableError } from 'bullmq'
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
  JOB_RUNNER_PAYOUT,
  JOB_ORGANIZER_PAYOUT,
  JOB_REFUND,
  JOB_RECONCILE,
  getQueuePrefix,
  JobData,
} from '../lib/queues'
import { Queue } from 'bullmq'
import { runReconciliationSweep } from '../lib/reconciler'
import {
  VENDOR_OFFLINE_HEARTBEAT_MS,
} from '../lib/constants'
import { processOrderPayout, PayoutReconciliationError } from '../lib/process-payout'
import { processRunnerPayout } from '../lib/runner-payout'
import { processEventOrganizerPayout } from '../lib/organizer-payout'
import { refundVendorPortion } from '../lib/process-refund'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'

// ─── Bootstrap ────────────────────────────────────────────────────────────────

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

// Use DIRECT_URL for the worker — avoids pgBouncer transaction mode restrictions
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// Stripe — direct init (not the Next.js singleton)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2023-10-16' as any,
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

  // Per-vendor refund through the SINGLE engine, FEE KEPT (the vendor failed to
  // accept, but the platform service still ran). NOT a whole-order/fee-inclusive
  // raw Stripe refund. CASE 1 — payout never fired, so no reversal.
  if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    const items = await prisma.orderItem.findMany({ where: { orderId }, select: { vendorId: true } })
    for (const vid of [...new Set(items.map(i => i.vendorId))]) {
      try {
        await refundVendorPortion({ orderId, vendorId: vid, reason: 'vendor_did_not_accept', actor: 'system:accept-timeout' })
      } catch (err) {
        console.error(`[Worker] accept-timeout per-vendor refund failed (reconciler will retry) order ${orderId} vendor ${vid}:`, err)
      }
    }
  }

  // Status via the aggregator (asserted timeout override, behind canAdvance — the
  // TOCTOU re-fire is refused). Reconcile FIRST so a retry's top guard (status ===
  // PLACED) short-circuits and never duplicates the audit rows below.
  await reconcileMasterStatus(orderId, {
    timeout: { status: 'CANCELLED', by: 'system', reason: 'Vendor did not accept within 2 minutes' },
  })

  await prisma.$transaction([
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

  // Status via the aggregator (asserted timeout override, behind canAdvance). Sets
  // uncollectedAt. Reconcile first so a retry's top guard (status === READY)
  // short-circuits before the audit OrderEvent.
  await reconcileMasterStatus(orderId, { timeout: { status: 'UNCOLLECTED' } })

  await prisma.orderEvent.create({
    data: {
      orderId,
      eventType: 'uncollected',
      actorRole: 'system',
      metadata: { fulfillmentType: order.fulfillmentType },
    },
  })

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

  // Status via the aggregator (asserted timeout override, behind canAdvance).
  // Reconcile first so a retry's top guard (status === READY) short-circuits.
  await reconcileMasterStatus(orderId, { timeout: { status: 'UNDELIVERABLE' } })

  await prisma.orderEvent.create({
    data: {
      orderId,
      eventType: 'undeliverable',
      actorRole: 'system',
    },
  })

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
  const isFullOrder = !incident.affectedItems
  let refundAmount = 0

  // Incident refunds WAIVE THE FEE (genuine "something went wrong") — routed
  // through the SINGLE engine, never raw Stripe.
  if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    const allItems = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, vendorId: true, subtotal: true } })
    const totalSubtotalCents = allItems.reduce((s, i) => s + Math.round(i.subtotal * 100), 0)
    const serviceFeeCents = Math.round(order.fairSynqFee * 100)

    if (isFullOrder) {
      // Whole order broke → refund every vendor their slice + waived fee share.
      for (const vid of [...new Set(allItems.map(i => i.vendorId))]) {
        try {
          const r = await refundVendorPortion({ orderId: order.id, vendorId: vid, reason: `incident:${incidentId}`, actor: 'system:incident', waiveFee: true })
          refundAmount += r.sliceCents / 100
        } catch (err) {
          console.error(`[Worker] incident full refund failed order ${order.id} vendor ${vid}:`, err)
        }
      }
    } else if (Array.isArray(incident.affectedItems)) {
      // Only some items affected → refund just those vendors' affected slices
      // (+ proportional fee, waived). Unaffected vendors keep their portions.
      const affectedIds = new Set(incident.affectedItems as string[])
      const affected = allItems.filter(i => affectedIds.has(i.id))
      const byVendor: Record<string, number> = {}
      for (const i of affected) byVendor[i.vendorId] = (byVendor[i.vendorId] ?? 0) + Math.round(i.subtotal * 100)
      for (const [vid, affectedCents] of Object.entries(byVendor)) {
        // affected portion's share of the service fee (proportional), also waived
        const feeOnAffected = totalSubtotalCents > 0 ? Math.round(serviceFeeCents * affectedCents / totalSubtotalCents) : 0
        const overrideCents = affectedCents + feeOnAffected
        try {
          const r = await refundVendorPortion({ orderId: order.id, vendorId: vid, reason: `incident:${incidentId}`, actor: 'system:incident', waiveFee: true, amountCentsOverride: overrideCents, markVendorStatus: false })
          refundAmount += r.sliceCents / 100
        } catch (err) {
          console.error(`[Worker] incident partial refund failed order ${order.id} vendor ${vid}:`, err)
        }
      }
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

  console.log(`[Worker] Incident ${incidentId} auto-refunded: $${(refundAmount ?? 0).toFixed(2)}`)
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
      // Emergency "the event broke, refund everyone in full" → per-vendor through
      // the SINGLE engine with FEE WAIVED (genuine emergency goodwill). Best-effort
      // per vendor; the reconciler backstops any failure.
      if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
        const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { vendorId: true } })
        for (const vid of [...new Set(items.map(i => i.vendorId))]) {
          try {
            await refundVendorPortion({ orderId: order.id, vendorId: vid, reason: 'emergency_event_cancel', actor: 'system:emergency', waiveFee: true, markVendorStatus: false })
          } catch (err) {
            console.error(`[Worker] bulk-refund: engine refund failed order ${order.id} vendor ${vid}:`, err)
          }
        }
      }

      // Status via the aggregator (asserted timeout/operator override, behind
      // canAdvance — won't regress an already-terminal order). Then audit rows.
      await reconcileMasterStatus(order.id, {
        timeout: { status: 'CANCELLED', by: 'system', reason: 'Event cancelled by operator' },
      })
      await prisma.$transaction([
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
 * Per-vendor payout for a fulfilled order (separate charges & transfers).
 * Delegates ALL fee/transfer math to the shared processOrderPayout():
 *   - reads the REAL settled Stripe fee from the balance transaction
 *   - splits it proportionally across all vendors on the cart (integer cents)
 *   - sends one idempotent transfer per connected vendor (subtotal − feeShare)
 *   - holds unconnected/zero-or-negative vendors; reconciles to the cent
 *
 * Retries (BullMQ backoff) when the balance txn hasn't settled yet
 * (PayoutNotSettledError → rethrown). A reconciliation failure is permanent —
 * thrown as UnrecoverableError so it halts for manual review instead of looping.
 */
async function handleVendorPayout(job: Job<JobData>) {
  const { orderId } = job.data
  if (!orderId) {
    console.error(`[Worker] process-vendor-payout: missing orderId in job ${job.id}`)
    return
  }

  console.log(`[Worker] process-vendor-payout → order ${orderId}`)

  // Test hook: simulate failure on first attempt to verify retry behaviour
  if (process.env.TEST_RETRY_FAILURE === 'true' && job.attemptsMade === 0) {
    throw new Error('Simulated failure — TEST_RETRY_FAILURE')
  }

  try {
    const res = await processOrderPayout(orderId)
    console.log(
      `[Worker] payout complete for order ${orderId}: ${res.transfers.length} transfer(s), ` +
      `${res.held.length} held, Stripe fee ${res.stripeFeeCents}¢`,
    )
  } catch (err) {
    if (err instanceof PayoutReconciliationError) {
      // Deterministic money-correctness failure — never retry, never send money.
      console.error(`[Worker] RECONCILIATION HALT for order ${orderId}: ${err.message}`)
      throw new UnrecoverableError(err.message)
    }
    // Transient (e.g. balance txn not settled, no charge yet) → let BullMQ retry.
    throw err
  }
}

/**
 * process-runner-payout (Part B B2)
 * Pays a runner their accrued earning for a delivered order. Delegates ALL logic
 * to processRunnerPayout(): reads RunnerEarning.amountCents (the ledger, verbatim),
 * sends one idempotent transfer (key runner_payout_${orderId}) to the runner's
 * Connect account, marks the row paid + stamps the transfer id. Unconnected →
 * held (no transfer, no error). Same error discipline as the vendor payout:
 *   - PayoutReconciliationError (ledger drift) → UnrecoverableError (halt, no retry)
 *   - transient (no charge yet) → rethrow → BullMQ retry
 */
async function handleRunnerPayout(job: Job<JobData>) {
  const { orderId } = job.data
  if (!orderId) {
    console.error(`[Worker] process-runner-payout: missing orderId in job ${job.id}`)
    return
  }
  console.log(`[Worker] process-runner-payout → order ${orderId}`)
  try {
    const res = await processRunnerPayout(orderId)
    console.log(`[Worker] runner payout for order ${orderId}: ${res.outcome}` +
      (res.amountCents != null ? ` (${res.amountCents}¢)` : '') +
      (res.transferId ? ` transfer=${res.transferId}` : ''))
  } catch (err) {
    if (err instanceof PayoutReconciliationError) {
      console.error(`[Worker] RUNNER RECONCILIATION HALT for order ${orderId}: ${err.message}`)
      throw new UnrecoverableError(err.message)
    }
    // Transient (e.g. no charge yet) → let BullMQ retry.
    throw err
  }
}

/**
 * process-organizer-payout (Part B B3)
 * Pays an event's organizer their accrued share as ONE batched transfer.
 * Delegates to processEventOrganizerPayout(): creates/reuses the batch record
 * (idempotency anchor), sends one plain transfer (no source_transaction) to the
 * organizer's Connect account keyed by the batch id, marks the batch + covered
 * earnings paid. Same error discipline as the other payouts:
 *   - PayoutReconciliationError (batch total ≠ covered sum) → UnrecoverableError
 *   - transient → rethrow → BullMQ retry
 */
async function handleOrganizerPayout(job: Job<JobData>) {
  const { eventId } = job.data
  if (!eventId) {
    console.error(`[Worker] process-organizer-payout: missing eventId in job ${job.id}`)
    return
  }
  console.log(`[Worker] process-organizer-payout → event ${eventId}`)
  try {
    const res = await processEventOrganizerPayout(eventId)
    console.log(`[Worker] organizer payout for event ${eventId}: ${res.outcome}` +
      (res.totalCents != null ? ` (${res.totalCents}¢)` : '') +
      (res.transferId ? ` transfer=${res.transferId}` : ''))
  } catch (err) {
    if (err instanceof PayoutReconciliationError) {
      console.error(`[Worker] ORGANIZER RECONCILIATION HALT for event ${eventId}: ${err.message}`)
      throw new UnrecoverableError(err.message)
    }
    throw err
  }
}

/**
 * process-refund
 * Issues a Stripe refund for a cancelled order.
 * Idempotent via Stripe idempotency key + BullMQ jobId deduplication.
 * Updates the Cancellation record with the issued refund amount on success.
 */
async function handleRefund(job: Job<JobData>) {
  const { orderId, vendorId, refundReason, refundAmountCents } = job.data

  if (!orderId) {
    console.error(`[Worker] process-refund: missing orderId in job ${job.id}`)
    return
  }

  // FOLDED INTO THE ENGINE. enqueueRefund has no callers post-migration, but any
  // in-flight JOB_REFUND must still route through refundVendorPortion — NEVER raw
  // Stripe. If a vendor is named, refund that portion (override = partial amount);
  // otherwise refund every vendor's portion. Idempotent.
  console.log(`[Worker] process-refund → order ${orderId} (via engine)`)
  const vendorIds = vendorId
    ? [vendorId]
    : [...new Set((await prisma.orderItem.findMany({ where: { orderId }, select: { vendorId: true } })).map(i => i.vendorId))]

  for (const vid of vendorIds) {
    try {
      await refundVendorPortion({
        orderId, vendorId: vid, reason: refundReason ?? 'cancelled', actor: 'system:job-refund',
        ...(refundAmountCents && vendorId ? { amountCentsOverride: refundAmountCents } : {}),
      })
    } catch (err) {
      console.error(`[Worker] process-refund engine call failed order ${orderId} vendor ${vid}:`, err)
    }
  }
}

/**
 * reconcile-sweep (recurring, ~60s)
 * Periodic backstop: compares Stripe (money-truth) against the DB (state-truth)
 * and self-heals pipeline leaks the real-time paths missed — all via existing
 * idempotent functions (lib/reconciler.ts). Pattern E (auto-cancel of stuck
 * PLACED orders) is detect-and-alert by default; it only acts when
 * RECONCILER_PATTERN_E_ENABLED=true.
 */
async function handleReconcile(_job: Job<JobData>) {
  await runReconciliationSweep()
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
        case JOB_RUNNER_PAYOUT:
          await handleRunnerPayout(job)
          break
        case JOB_ORGANIZER_PAYOUT:
          await handleOrganizerPayout(job)
          break
        case JOB_REFUND:
          await handleRefund(job)
          break
        case JOB_RECONCILE:
          await handleReconcile(job)
          break
        default:
          console.warn(`[Worker] Unknown job: ${job.name}`)
      }
    },
    // prefix MUST match the producers (getOrderQueue uses getQueuePrefix()).
    // Without this, a set TEST_REDIS_PREFIX leaves the worker consuming 'bull:'
    // while every job is enqueued under that prefix — the worker goes deaf to
    // all jobs (payouts, refunds, timeouts). They must always align.
    { connection, prefix: getQueuePrefix(), concurrency: 5 }
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

  // ── Recurring reconciliation sweep (~60s) ────────────────────────────────
  // Attached to the SAME queue/connection as a BullMQ repeatable job. The fixed
  // jobId + repeat key means re-running the worker never stacks duplicate
  // schedulers. Pattern E stays detect-and-alert unless RECONCILER_PATTERN_E_ENABLED.
  const schedulerQueue = new Queue(ORDER_QUEUE_NAME, { connection, prefix: getQueuePrefix() })
  schedulerQueue
    .add(JOB_RECONCILE, { eventId: '__reconcile__' } as JobData, {
      repeat: { every: 60_000 },
      jobId: 'reconcile-sweep',
      removeOnComplete: 50,
      removeOnFail: 100,
    })
    .then(() => console.log('[Worker] Reconciliation sweep scheduled (every 60s)'))
    .catch(e => console.error('[Worker] Failed to schedule reconciliation sweep:', e))

  console.log(`[Worker] Listening on queue: ${ORDER_QUEUE_NAME}`)
  console.log(`[Worker] Handlers: ${[
    JOB_UNACCEPTED, JOB_UNCOLLECTED, JOB_UNDELIVERABLE,
    JOB_HIDE_VENDOR, JOB_INCIDENT_REFUND, JOB_ESCALATE_DISPUTE,
    JOB_POST_EVENT_REPORT, JOB_BULK_REFUND,
    JOB_VENDOR_PAYOUT, JOB_RUNNER_PAYOUT, JOB_ORGANIZER_PAYOUT, JOB_REFUND, JOB_RECONCILE,
  ].join(', ')}`)

  return worker
}
