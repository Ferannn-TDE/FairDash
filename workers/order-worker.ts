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
  VENDOR_DID_NOT_ACCEPT_REASON,
} from '../lib/constants'
import { processOrderPayout, PayoutReconciliationError, PayoutTerminalError } from '../lib/process-payout'
import { processRunnerPayout } from '../lib/runner-payout'
import { processEventOrganizerPayout } from '../lib/organizer-payout'
import { refundVendorPortion } from '../lib/process-refund'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'
import { recordPayoutFailure as recordPayoutFailureShared, describeFailureCause } from '../lib/payout-failure-marker'
import { payoutFailureFinality } from '../lib/payout-failure-finality'
import { WORKER_COMMIT } from '../lib/health'

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
 * Fires VENDOR_ACCEPT_TIMEOUT_MS after an order is PLACED (see lib/constants.ts).
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
  // A RECEIPT IS WHAT MOVED, NOT WHAT WAS PLANNED. The audit below used to write
  // `refundAmount: order.total` — the whole order, fee included — while the engine refunds only
  // the vendor SUBTOTAL slice and KEEPS the fee. On order cmsawszw70008edtcv6giekll that audit
  // claimed $29.19 against an actual $12.00 refund: a money trail overstating itself by $17.19,
  // in the exact row a human reads when reconstructing an incident. So the amount is accumulated
  // from what refundVendorPortion RETURNED (sliceCents = the amount actually returned to the
  // customer), matching the incident path at :337/:355 which already does this.
  let refundedCents = 0
  if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
    const items = await prisma.orderItem.findMany({ where: { orderId }, select: { vendorId: true } })
    for (const vid of [...new Set(items.map(i => i.vendorId))]) {
      try {
        const r = await refundVendorPortion({ orderId, vendorId: vid, reason: 'vendor_did_not_accept', actor: 'system:accept-timeout' })
        refundedCents += r.sliceCents
      } catch (err) {
        // A failed slice contributes NOTHING to the receipt — the reconciler retries it, and the
        // audit must not claim money that did not move.
        console.error(`[Worker] accept-timeout per-vendor refund failed (reconciler will retry) order ${orderId} vendor ${vid}:`, err)
      }
    }
  }

  // Status via the aggregator (asserted timeout override, behind canAdvance — the
  // TOCTOU re-fire is refused). Reconcile FIRST so a retry's top guard (status ===
  // PLACED) short-circuits and never duplicates the audit rows below.
  await reconcileMasterStatus(orderId, {
    timeout: { status: 'CANCELLED', by: 'system', reason: VENDOR_DID_NOT_ACCEPT_REASON },
  })

  await prisma.$transaction([
    prisma.cancellation.upsert({
      where: { orderId },
      // Pure audit (who/when/why). Refund truth lives in Refund rows — the
      // deprecated refundIssued/refundAmount are no longer written.
      create: {
        orderId,
        vendorId: order.vendorId,
        reason: VENDOR_DID_NOT_ACCEPT_REASON,
      },
      update: { reason: VENDOR_DID_NOT_ACCEPT_REASON },
    }),
    prisma.orderEvent.create({
      data: {
        orderId,
        eventType: 'cancelled',
        actorId: null,
        actorRole: 'system',
        metadata: { reason: VENDOR_DID_NOT_ACCEPT_REASON, refundAmount: refundedCents / 100 },
      },
    }),
  ])

  await updateOrderInFirebase(eventId, vendorId, orderId, order.customerId, {
    status: 'CANCELLED',
    cancellationReason: VENDOR_DID_NOT_ACCEPT_REASON,
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
      // Same receipt rule as the accept-timeout path above: the audit reports what the engine
      // RETURNED, never order.total. This path waives the fee, so the slice and the order total
      // differ by a different amount again — one more reason not to infer the receipt.
      let refundedCents = 0
      if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
        const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { vendorId: true } })
        for (const vid of [...new Set(items.map(i => i.vendorId))]) {
          try {
            const r = await refundVendorPortion({ orderId: order.id, vendorId: vid, reason: 'emergency_event_cancel', actor: 'system:emergency', waiveFee: true, markVendorStatus: false })
            refundedCents += r.sliceCents
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
          // Pure audit (who/when/why). Refund truth lives in Refund rows — the
          // deprecated refundIssued/refundAmount are no longer written.
          create: {
            orderId: order.id,
            vendorId: order.vendorId,
            reason: 'Event cancelled by operator',
          },
          update: { reason: 'Event cancelled by operator' },
        }),
        prisma.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: 'cancelled',
            actorRole: 'system',
            metadata: { reason: 'emergency_event_cancel', eventId, refundAmount: refundedCents / 100 },
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
    // TERMINAL Stripe refusal (deleted destination, revoked connection, bad credentials).
    // Rides the SAME seam as the reconciliation halt rather than opening a second path to
    // the durable marker: UnrecoverableError reaches the finality gate below, which writes
    // the marker + PAYOUT_FAILED audit exactly as an exhausted retry would — just sooner,
    // without burning 3 attempts on a destination that will never resolve.
    if (err instanceof PayoutTerminalError) {
      console.error(`[Worker] TERMINAL STRIPE FAILURE (vendor payout): ${err.message}`)
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
    // TERMINAL Stripe refusal (deleted destination, revoked connection, bad credentials).
    // Rides the SAME seam as the reconciliation halt rather than opening a second path to
    // the durable marker: UnrecoverableError reaches the finality gate below, which writes
    // the marker + PAYOUT_FAILED audit exactly as an exhausted retry would — just sooner,
    // without burning 3 attempts on a destination that will never resolve.
    if (err instanceof PayoutTerminalError) {
      console.error(`[Worker] TERMINAL STRIPE FAILURE (runner payout): ${err.message}`)
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
    // TERMINAL Stripe refusal (deleted destination, revoked connection, bad credentials).
    // Rides the SAME seam as the reconciliation halt rather than opening a second path to
    // the durable marker: UnrecoverableError reaches the finality gate below, which writes
    // the marker + PAYOUT_FAILED audit exactly as an exhausted retry would — just sooner,
    // without burning 3 attempts on a destination that will never resolve.
    if (err instanceof PayoutTerminalError) {
      console.error(`[Worker] TERMINAL STRIPE FAILURE (organizer payout): ${err.message}`)
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
 * Worker-path adapter over lib/payout-failure-marker. The MARKER LOGIC lives there so the
 * reconciler's Pattern P/Q loops can write the same marker — they could not before, because
 * this function took a BullMQ Job and was not exported, which is exactly why eight days of
 * reconciler-side failures left nothing durable behind.
 *
 * `err` is threaded through so the CAUSE (classified verdict + Stripe type/code/message) is
 * captured, not just the mechanism. "halted unrecoverably" described both eight-day failures
 * and distinguished neither.
 */
async function recordPayoutFailure(job: Job<JobData>, finality?: string, err?: unknown) {
  const actor = { id: `worker:${job.name}:${job.id}`, type: 'system' as const }
  const attempts = finality ?? `${job.attemptsMade} attempt(s)`
  const cause = err === undefined ? undefined : describeFailureCause(err)

  if (job.name === JOB_RUNNER_PAYOUT && job.data.orderId) {
    await recordPayoutFailureShared({ leg: 'runner', orderId: job.data.orderId, actor, finality: attempts, cause })
  } else if (job.name === JOB_ORGANIZER_PAYOUT && job.data.eventId) {
    await recordPayoutFailureShared({ leg: 'organizer', eventId: job.data.eventId, actor, finality: attempts, cause })
  } else if (job.name === JOB_VENDOR_PAYOUT && job.data.orderId) {
    await recordPayoutFailureShared({ leg: 'vendor', orderId: job.data.orderId, actor, finality: attempts, cause })
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
/**
 * SELF-OVERLAP GUARD — a sweep must never run concurrently with itself.
 *
 * WHY IT CAN: the worker runs at `concurrency: 5`, and BullMQ 5.76.8 schedules the NEXT
 * repeat when the current job is PICKED UP, not when it finishes (`worker.js:539-547`,
 * `jobScheduler.upsertJobScheduler` on the fetch path). So a sweep that outruns its 60s
 * interval meets its own successor with four free concurrency slots — BullMQ does not skip it.
 * Two reconcilers on the same rows has never been exercised, and the monotonic fixed-point
 * guarantees were never designed under it.
 *
 * WHY NOT `concurrency: 1`: that is worker-wide in this version (no per-job-name concurrency —
 * checked `interfaces/worker-options.d.ts`), and would serialise all 13 handlers behind the
 * ~14s sweep. Payouts and timeouts would queue behind reconciliation. Wrong trade.
 *
 * SCOPE — an in-process flag, honest about its limit: it makes self-overlap impossible within
 * ONE worker process, which is the deployment today (a single Railway service). It would NOT
 * hold across replicas; scaling the worker horizontally requires promoting this to a Redis
 * lock (SET NX PX) before it is safe. Named here so that change is not made unknowingly.
 *
 * Skips rather than queues: a delayed duplicate sweep has no value — the next tick is 60s away
 * and will see the same state. The skip is logged, never silent.
 */
let sweepInFlight = false

async function handleReconcile(_job: Job<JobData>) {
  if (sweepInFlight) {
    console.warn(
      '[Worker] reconcile-sweep SKIPPED — the previous sweep is still running. ' +
      'The sweep is exceeding its 60s interval; profile it (CURRENT_STATE §6).',
    )
    return
  }
  sweepInFlight = true
  const startedAt = Date.now()
  try {
    await runReconciliationSweep()
  } finally {
    sweepInFlight = false
    const ms = Date.now() - startedAt
    if (ms > 60_000) {
      console.error(`[Worker] reconcile-sweep took ${ms}ms — LONGER THAN ITS 60s INTERVAL. Overlap is being prevented by the guard, meaning sweeps are now being dropped.`)
    }
  }
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
    if (!job) return

    // ── GATE ON FINALITY, NOT ON THE ATTEMPT COUNT ───────────────────────────────────────
    // An attempt-count gate silently skipped the MOST serious failure class. BullMQ 5.76.8
    // fails an UnrecoverableError job WITHOUT exhausting attempts: `shouldRetryJob`
    // (job.js:483) returns [false, 0] the moment it sees one, never touching attemptsMade,
    // and job.js:549 then increments it exactly once. So a PayoutReconciliationError on the
    // first try arrives here with attemptsMade = 1 against opts.attempts = 3 — `1 >= 3` is
    // false, and BOTH the payoutStatus='FAILED' write below AND recordPayoutFailure were
    // skipped. The marker path was INVERTED: a transient network blip that burned all three
    // retries got a durable marker, while a ledger drift — a money-identity break, the
    // loudest thing this system can produce — got a log line that scrolls off Railway and
    // nothing else. It also skipped the PAYOUT_FAILED audit, which is the failed-since
    // timestamp Pattern U reads, so the stuck-money reader was blind to it too.
    //
    // Never fired in prod only because the runner/organizer legs had never executed. The
    // worker is live now, so it is reachable for the first time.
    //
    // `err.name` is checked ALONGSIDE instanceof deliberately — it mirrors BullMQ's own test
    // (job.js:486) and survives a duplicated bullmq module instance, where instanceof across
    // two copies of the class silently returns false and would restore the exact bug.
    // ONE definition, in lib/payout-failure-finality.ts, so this decision is provable without
    // booting a worker (this module constructs Prisma/Stripe/Firebase/Redis at import).
    // `finality` is honest text for the audit reason: an unrecoverable halt did NOT exhaust
    // anything, and "exhausted after 1 attempt(s)" in a money audit would be false on its face.
    const { final, finality } = payoutFailureFinality(err, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts,
    })
    const isPayout =
      job.name === JOB_VENDOR_PAYOUT || job.name === JOB_RUNNER_PAYOUT || job.name === JOB_ORGANIZER_PAYOUT
    if (!final || !isPayout) return

    // Vendor's order-level durable marker (unchanged). Runner/organizer markers + the
    // honest-actor PAYOUT_FAILED audit for ALL THREE live in recordPayoutFailure, so every
    // permanently-failed payout is both durably distinguishable AND read by Pattern U.
    if (job.name === JOB_VENDOR_PAYOUT && job.data.orderId) {
      await prisma.order.update({
        where: { id: job.data.orderId },
        data: { payoutStatus: 'FAILED' },
      }).catch(e => console.error('[Worker] Failed to set payoutStatus=FAILED:', e))
      console.error(`[Worker] Payout permanently FAILED for order ${job.data.orderId} — manual intervention required`)
    }
    await recordPayoutFailure(job, finality, err)
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

  // ── THE BOOT SEAM ────────────────────────────────────────────────────────────────────────
  // console.WARN, not log: Railway runs NODE_ENV=production, where the Next compiler strips
  // console.log/info call sites and logger.info is a hard no-op. Every line above this one is
  // console.log, which is why the last push could not be confirmed from the logs — a redeploy
  // restarts the process, but there was no surviving line to look for, so continuous sweeps
  // with no visible gap were indistinguishable from "never deployed".
  //
  // This is the seam. One line, at boot, carrying the SHA — so "did the worker pick up that
  // push?" is answerable by scrolling, and by `curl /api/health | jq .checks.worker.commit`.
  console.warn('[Worker] boot', { commit: WORKER_COMMIT, queue: ORDER_QUEUE_NAME, pid: process.pid })

  console.log(`[Worker] Listening on queue: ${ORDER_QUEUE_NAME}`)
  console.log(`[Worker] Handlers: ${[
    JOB_UNACCEPTED, JOB_UNCOLLECTED, JOB_UNDELIVERABLE,
    JOB_HIDE_VENDOR, JOB_INCIDENT_REFUND, JOB_ESCALATE_DISPUTE,
    JOB_POST_EVENT_REPORT, JOB_BULK_REFUND,
    JOB_VENDOR_PAYOUT, JOB_RUNNER_PAYOUT, JOB_ORGANIZER_PAYOUT, JOB_REFUND, JOB_RECONCILE,
  ].join(', ')}`)

  return worker
}
