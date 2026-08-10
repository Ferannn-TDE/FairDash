// ─────────────────────────────────────────────────────────────────────────────
// Order-status aggregator — PHASE 0: PURE READER (NO WRITE AUTHORITY)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module derives what the master Order.status SHOULD be from the only
// source of truth that actually moves during fulfillment:
//
//     { VendorOrderStatus rows } + fulfillmentType + runner overlay
//
// In Phase 0 it WRITES NOTHING. `shadowReconcile()` reads an order, computes the
// derived status, classifies any divergence from the stored master, and logs it.
// The divergence log is the bug map: delivery/curbside orders stuck at PLACED
// that derive to READY are the known vendor→runner handoff bug.
//
// The derivation is a PURE FUNCTION (deriveMasterStatus) so it is:
//   • idempotent + convergent — same inputs always yield the same status; it
//     re-derives from per-vendor truth every call rather than gating on a
//     one-shot transition (the placePaidOrder discipline).
//   • unit-testable with no DB (see scripts/shadow-derive-matrix.ts).
//
// Fulfillment arms (branch per-ORDER on that order's own fulfillmentType):
//   • BOOTH_PICKUP            → vendor-driven completion (tops out at COMPLETED)
//   • CURBSIDE | HOME_DELIVERY → runner-driven completion (vendor base tops out
//                                at READY; completion is the runner overlay)
//   CURBSIDE IS ON THE DELIVERY ARM — it uses a runner, so it derives like
//   HOME_DELIVERY, never like BOOTH_PICKUP. (Matches the runner-feed filter,
//   which surfaces [HOME_DELIVERY, CURBSIDE].)
// ─────────────────────────────────────────────────────────────────────────────

import type { OrderStatus as PrismaOrderStatus } from '@prisma/client'

// ─── The pure derivation lives in ./order-derive ─────────────────────────────
//
// It was moved out VERBATIM (no logic change) so lib/order-view.ts — which runs in
// the BROWSER — can share the delivery-arm clamp with this writer instead of
// re-implementing it. This file reaches ./db, ./queues and ./firebase-sync through
// dynamic imports, so a 'use client' module importing it would pull Prisma, BullMQ
// and firebase-admin into the client bundle.
//
// Everything is RE-EXPORTED here, so every existing importer of
// '@/lib/reconcile-order-status' (the reconciler, the phase shadows, the guards)
// keeps working unchanged. New server-side callers may import from either; the
// client MUST import from './order-derive'.
import {
  deriveMasterStatus,
  canAdvance,
  classifyDivergence,
  vendorLaneClosePlan,
  type MasterStatus,
  type FulfillmentType,
  type Divergence,
} from './order-derive'

export {
  deriveMasterStatus,
  canAdvance,
  classifyDivergence,
  vendorLaneClosePlan,
  isFailedVendorLane,
  isDeliveryArm,
  MASTER_RANK,
} from './order-derive'
export type {
  MasterStatus,
  FulfillmentType,
  LaneClosingTarget,
  DeriveInput,
  DeriveResult,
  Divergence,
} from './order-derive'

// ─── Shadow reader (DB wrapper) — READS + LOGS, WRITES NOTHING ───────────────
// Optional live sweep. Kept dependency-light so the pure core above runs with
// no DB. Import db lazily so unit harnesses never pull in Prisma.

export interface ShadowResult {
  orderId: string
  fulfillmentType: FulfillmentType
  stored: MasterStatus
  derived: MasterStatus | 'SKIP'
  divergence: Divergence
  reason: string
}

export async function shadowReconcile(orderId: string): Promise<ShadowResult> {
  const { db } = await import('./db')
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true, fulfillmentType: true,
      runnerId: true, deliveryProofPath: true, voidedAt: true,
      vendorOrderStatuses: { select: { status: true } },
    },
  })
  if (!order) throw new Error(`Order ${orderId} not found`)

  const result = deriveMasterStatus({
    fulfillmentType: order.fulfillmentType as FulfillmentType,
    vendorStatuses: order.vendorOrderStatuses,
    runnerId: order.runnerId,
    deliveryProofPath: order.deliveryProofPath,
    voided: order.voidedAt != null,
  })

  const divergence = classifyDivergence(order.status as MasterStatus, result.derived)

  // PURE READER: log only. No write, no enqueue, no Firebase.
  if (divergence !== 'MATCH') {
    // eslint-disable-next-line no-console
    console.log(`[shadow] order=${order.id} type=${order.fulfillmentType} stored=${order.status} derived=${result.derived} → ${divergence} (${result.reason})`)
  }

  return {
    orderId: order.id,
    fulfillmentType: order.fulfillmentType as FulfillmentType,
    stored: order.status as MasterStatus,
    derived: result.derived,
    divergence,
    reason: result.reason,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE AUTHORITY — reconcileMasterStatus (Phase 1: READY · Phase 2: COMPLETED/CANCELLED)
// ─────────────────────────────────────────────────────────────────────────────
//
// The single owner of the master transitions the aggregator governs. It derives
// the master status from per-vendor truth + fulfillment + runner overlay, then —
// behind canAdvance — applies ONE of:
//   • READY      (Phase 1) — all active vendors ready. Fix for the delivery
//                handoff (runner feed matches READY) + booth-honesty mid-flight.
//   • COMPLETED  (Phase 2) — BOOTH_PICKUP, all active vendors completed. Delivery
//                NEVER completes here (it clamps to READY; completion is the
//                runner's DELIVERED in W3). Owns the DELAYED payout enqueue.
//   • CANCELLED  (Phase 2) — all portions DECLINED. Per-vendor refunds are NOT
//                fired here: they already ran per-decline in W4. Owns status +
//                Firebase only.
// Intermediate (ACCEPTED/PREPARING) and runner-overlay (RUNNER_COLLECTED/
// DELIVERED) states are NOT written here — abstained (owned by W3 / later phases).
//
// Discipline (placePaidOrder): each apply is a monotonic, status-conditional
// updateMany keyed on the set of strictly-lower, non-terminal stored states, so
// it can never regress a collected/delivered/terminal order and is race-safe
// (exactly the still-eligible row flips; concurrent calls no-op). Idempotent.

// The master transitions the aggregator can apply.
type WriteTarget = 'READY' | 'RUNNER_COLLECTED' | 'COMPLETED' | 'DELIVERED' | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'

// From which stored states each target may be written (monotonic; mirrors canAdvance).
// For the asserted timeouts the from-set is INTENTIONALLY narrower than canAdvance
// would allow — it preserves the worker's semantics (uncollected/undeliverable
// only from READY; never resurrect a collected/delivered order).
const WRITE_GUARD: Record<WriteTarget, readonly string[]> = {
  READY:            ['PLACED', 'ACCEPTED', 'PREPARING'],
  RUNNER_COLLECTED: ['READY'],
  COMPLETED:        ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'], // RUNNER_COLLECTED excluded: a collected delivery never derives COMPLETED
  DELIVERED:        ['READY', 'RUNNER_COLLECTED'],
  CANCELLED:        ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED'],
  UNCOLLECTED:      ['READY'],
  UNDELIVERABLE:    ['READY'],
}

// W5's exact cancel rule: every portion terminal AND none completed.
function allTerminalNoneCompleted(rows: string[]): boolean {
  if (rows.length === 0) return false
  const terminal = new Set(['DECLINED', 'REFUNDED', 'CANCELLED', 'COMPLETED'])
  return rows.every(s => terminal.has(s)) && rows.every(s => s !== 'COMPLETED')
}

export interface ReconcileResult {
  wrote: boolean
  orderId: string
  from?: MasterStatus
  to?: MasterStatus
  reason: string
}

// Caller-asserted intent the status-only derivation cannot have.
export interface ReconcileOpts {
  // A customer/operator cancellation. Supplies the intent that lets the aggregator
  // apply CANCELLED on an all-terminal-none-completed order (where pure derivation
  // abstains on refunds). Cancel-only — never promotes mid-cancel.
  cancel?: { by: string; reason?: string }
  // A worker timeout / operator action — time-driven, no column to derive from, so
  // it's asserted. Applied as a terminal override behind canAdvance (which refuses
  // a re-fire on an already-advanced order — the TOCTOU fix). For 'CANCELLED'
  // (accept-timeout / bulk-cancel) by/reason set the attribution.
  timeout?: { status: 'UNCOLLECTED' | 'UNDELIVERABLE' | 'CANCELLED'; by?: string; reason?: string }
}

// revalidateTag only works inside a request/render context. Calling the
// aggregator from W4 (a route) is fine; future reconciler/worker callers are
// not — so wrap it to no-op there (cache refreshes naturally) instead of throwing.
async function safeRevalidateTag(tag: string): Promise<void> {
  try {
    const { revalidateTag } = await import('next/cache')
    ;(revalidateTag as (t: string, p?: string) => void)(tag, 'default')
  } catch {
    /* not in a request/render scope — ignore */
  }
}

export async function reconcileMasterStatus(orderId: string, opts?: ReconcileOpts): Promise<ReconcileResult> {
  const { db } = await import('./db')

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true, fulfillmentType: true, eventId: true,
      vendorId: true, customerId: true, runnerId: true,
      deliveryProofPath: true, voidedAt: true, deliveryFee: true, tip: true,
      vendorOrderStatuses: { select: { status: true, vendorId: true } },
    },
  })
  if (!order) return { wrote: false, orderId, reason: 'order not found' }

  const stored = order.status as MasterStatus
  const rows = order.vendorOrderStatuses.map(v => v.status)
  const { derived } = deriveMasterStatus({
    fulfillmentType: order.fulfillmentType as FulfillmentType,
    vendorStatuses: order.vendorOrderStatuses,
    runnerId: order.runnerId,
    deliveryProofPath: order.deliveryProofPath,
    voided: order.voidedAt != null,
  })

  // Two ways to reach a target master status:
  //   • DERIVED — pure function of persistent columns: per-vendor truth (READY /
  //     COMPLETED / CANCELLED-from-all-DECLINED) AND the runner overlay
  //     (RUNNER_COLLECTED from runnerId, DELIVERED from deliveryProofPath). The
  //     runner transitions are DERIVED, not asserted — the aggregator reads the
  //     columns W3 writes (claim → runnerId, deliver → photo), same shape as W4.
  //   • ASSERTED — the caller supplies intent no column can hold:
  //       opts.cancel  — customer/operator cancel (cancel-ONLY: never promotes;
  //                      applies CANCELLED iff all-terminal-none-completed).
  //       opts.timeout — worker time/operator event (UNCOLLECTED / UNDELIVERABLE /
  //                      CANCELLED) as a terminal override.
  //   Every target still passes through canAdvance (monotonic) + WRITE_GUARD
  //   (race-safe status-conditional flip).
  const DERIVED_OK: MasterStatus[] = ['READY', 'RUNNER_COLLECTED', 'COMPLETED', 'DELIVERED', 'CANCELLED']
  let target: WriteTarget | null
  if (opts?.timeout) {
    target = opts.timeout.status
  } else if (opts?.cancel) {
    target = allTerminalNoneCompleted(rows) ? 'CANCELLED' : null
  } else {
    target = derived !== 'SKIP' && DERIVED_OK.includes(derived) ? derived as WriteTarget : null
  }
  if (!target) {
    return {
      wrote: false, orderId, from: stored,
      reason: opts?.cancel
        ? 'cancel: order not all-terminal-none-completed — master unchanged'
        : `derived ${derived} — not an aggregator-owned transition`,
    }
  }
  if (!canAdvance(stored, target)) {
    // The monotonic guard. This is what REFUSES: a cancel on an already-COMPLETED
    // order (W5 bug), a runner claim landing after UNDELIVERABLE fired (W3
    // resurrection race), and a worker timeout re-firing on an advanced order (W7
    // TOCTOU). canAdvance(<terminal>, anything) === false.
    return { wrote: false, orderId, from: stored, reason: `guard blocks ${stored}→${target} (not a forward move)` }
  }

  const cancelBy = opts?.cancel?.by ?? opts?.timeout?.by ?? 'vendor'
  const cancelReason = opts?.cancel?.reason ?? opts?.timeout?.reason
  const tsPatch: Record<string, unknown> =
    target === 'READY'       ? { readyAt: new Date() }
  : target === 'COMPLETED'   ? { completedAt: new Date() }
  : target === 'UNCOLLECTED' ? { uncollectedAt: new Date() }
  : target === 'CANCELLED'   ? { cancelledAt: new Date(), cancelledBy: cancelBy, ...(cancelReason ? { cancellationReason: cancelReason } : {}) }
  :                            {} // RUNNER_COLLECTED (dispatchedAt set by the claim), DELIVERED (photo is the proof), UNDELIVERABLE

  // Monotonic, race-safe flip: only a still-eligible row matches.
  const res = await db.order.updateMany({
    where: { id: order.id, status: { in: WRITE_GUARD[target] as unknown as PrismaOrderStatus[] } },
    data: { status: target as PrismaOrderStatus, ...tsPatch },
  })
  if (res.count === 0) {
    return { wrote: false, orderId, from: stored, reason: 'lost race / already advanced — no-op' }
  }

  // ── Side-effects the transition owns (best-effort; never throw) ────────────
  if (target === 'READY') {
    // Arm the dormant timeout (UNDELIVERABLE for home delivery, UNCOLLECTED for
    // curbside + booth) — mirrors the status route's READY side-effect.
    try {
      const { getOrderQueue, JOB_UNDELIVERABLE, JOB_UNCOLLECTED } = await import('./queues')
      const { enqueueJobSafely } = await import('./queue-safe')
      const { CURBSIDE_WAIT_TIMEOUT_MS } = await import('./constants')
      const queue = getOrderQueue()
      if (queue) {
        const jobName = order.fulfillmentType === 'HOME_DELIVERY' ? JOB_UNDELIVERABLE : JOB_UNCOLLECTED
        await enqueueJobSafely({
          queue, name: jobName,
          data: { orderId: order.id, vendorId: order.vendorId, eventId: order.eventId },
          jobId: `${jobName}-${order.id}`, delay: CURBSIDE_WAIT_TIMEOUT_MS, priority: 'normal',
        })
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reconcileMasterStatus] timeout-arm failed (non-fatal)', { orderId: order.id, error: String(err) })
    }
  }

  if (target === 'COMPLETED' || target === 'DELIVERED') {
    // C1 — RECORD the vendors' accrued claims. Sits HERE, beside the runner/organizer
    // accrual below, because this is the one place that owns lifecycle → money. All
    // three payee types now accrue in the same file, at the same moment, in the same
    // idempotent-upsert shape.
    //
    // WHY IT MUST BE AT COMPLETION AND NOT AT THE EXECUTOR: the payout fires
    // REFUND_WINDOW_MS later. The row is the admin's per-order HOLD TARGET, so it has
    // to exist DURING that window — a row that first appears at payout time appears at
    // the exact moment it stops being useful. (The executor re-accrues defensively too,
    // but that is a self-heal for the payout, not a substitute for the window.)
    //
    // FAIL-SOFT FOR MONEY, LOUD FOR VISIBILITY: a failure here must never block
    // completion or the payout — the executor's re-accrual still pays the vendor. What
    // it DOES cost is the in-window hold + visibility, which is a real capability loss,
    // so the failure is logged at ERROR with the affected vendors and REPAIRED by
    // reconciler Pattern S (which re-accrues, restoring the window, rather than merely
    // alerting like Pattern L does for runners).
    try {
      const { accrueVendorEarnings } = await import('./process-payout')
      await accrueVendorEarnings(order.id)
    } catch (err) {
      const { logger } = await import('./logger')
      logger.error(
        '[reconcileMasterStatus] VENDOR ACCRUAL FAILED — in-window admin hold/visibility LOST for this order until Pattern S repairs it. Payout is NOT at risk (executor re-accrues).',
        {
          orderId: order.id,
          eventId: order.eventId,
          vendorIds: [...new Set(order.vendorOrderStatuses.map(v => v.vendorId))],
          error: String(err),
        },
      )
    }

    // CRITICAL money move — DELAYED payout enqueue behind the refund window. This
    // MUST fire on completion/delivery or the order finishes without ever paying
    // out (the original leak). Idempotent: enqueueOrderPayout dedups by jobId. The
    // worker pays each connected vendor, holds unconnected, SKIPS REFUNDED — so a
    // [COMPLETED,REFUNDED] order pays only the completed portion.
    try {
      const { enqueueOrderPayout } = await import('./order-side-effects')
      const { REFUND_WINDOW_MS } = await import('./constants')
      const ok = await enqueueOrderPayout({ orderId: order.id, eventId: order.eventId, delayMs: REFUND_WINDOW_MS })
      if (!ok) {
        const { logger } = await import('./logger')
        logger.error('[reconcileMasterStatus] CRITICAL: delayed payout enqueue dropped on completion', { orderId: order.id })
      }
    } catch (err) {
      const { logger } = await import('./logger')
      logger.error('[reconcileMasterStatus] CRITICAL: payout enqueue threw on completion', { orderId: order.id, error: String(err) })
    }
    // Bust each order-vendor's analytics caches (W4 only busted the caller's).
    const vendorIds = [...new Set(order.vendorOrderStatuses.map(v => v.vendorId))]
    for (const vid of vendorIds) {
      await safeRevalidateTag(`analytics-${vid}`)
      await safeRevalidateTag(`stats-${vid}`)
      await safeRevalidateTag(`revenue-${vid}`)
    }
  }

  // ── Vendor VOS advance on DELIVERED — closes the delivery-order under-report ──
  // A delivery order's vendor portions stay at READY forever (the vendor marks READY, the
  // runner delivers, the vendor never marks COMPLETED). Every VOS-join reader — vendor
  // analytics, dashboard "today revenue", the Firebase stats push — filters VOS IN
  // (COMPLETED, DELIVERED), so a delivered order is DROPPED from the vendor's own revenue
  // view even though they were PAID (accrual is VOS-independent). Advancing the vendor's
  // READY portions to COMPLETED on DELIVERED makes those readers count it.
  //
  // COMPLETED, not DELIVERED: 'DELIVERED' is not a VendorStatus and would derive PLACED via
  // VENDOR_PROGRESS. Safe by construction — the delivery arm CLAMPS a vendor COMPLETED to
  // READY, then the runner overlay (proof → DELIVERED) wins, so the next derive returns
  // DELIVERED and canAdvance(DELIVERED,DELIVERED) is a no-op: a converging fixed point, never
  // a flip to COMPLETED, never oscillation. Idempotent (only READY portions move).
  //
  // ⚠️ STRICT ORDERING — this MUST ship BEFORE gating the vendor "Mark Picked Up" action.
  // Today a vendor clicking that (mis-framed) button is the ONLY thing advancing VOS for
  // delivery orders; gating it first, or shipping the gate alone, converts a partial
  // under-report into a UNIVERSAL silent one (every delivery order, forever).
  //
  // TODO(collectedAt): DELIVERED is a PROXY. The honest trigger is COLLECTION (runner takes
  // the food ⇒ vendor's work is done), but "collect" is not a server event yet (claim ==
  // collect today). When Commit 2 adds collectedAt, MOVE this advance to that transition.
  if (target === 'DELIVERED') {
    try {
      await db.vendorOrderStatus.updateMany({
        where: { orderId: order.id, status: 'READY' },
        data: { status: 'COMPLETED' },
      })
    } catch (err) {
      const { logger } = await import('./logger')
      logger.error('[reconcileMasterStatus] vendor VOS advance on DELIVERED failed (non-fatal; analytics under-reports this order until a re-derive repairs it)', { orderId: order.id, error: String(err) })
    }
  }

  // ── The same close, for the terminal OVERRIDES ───────────────────────────────────────────────
  // Sibling of the DELIVERED branch above, and the reason this one exists: DELIVERED was the ONLY
  // target that closed the vendor lane, so the three asserted terminals (undeliverable /
  // uncollected / operator cancel) advanced the master and left the vendor's row untouched —
  // stranding the order in a live queue and leaving it quoting "pending" take-home for money
  // nobody would ever receive. See vendorLaneClosePlan for WHICH value each case closes to and
  // why that choice is a money decision.
  //
  // Non-fatal like its sibling: the master transition is the money-relevant write and must not be
  // rolled back by a lane-close failure. The reconciler's dangling-lane sweep re-attempts it, and
  // the failure is loud so it is not merely lost.
  if (target === 'UNDELIVERABLE' || target === 'UNCOLLECTED' || target === 'CANCELLED') {
    for (const { from, to } of vendorLaneClosePlan(target)) {
      try {
        await db.vendorOrderStatus.updateMany({
          where: { orderId: order.id, status: { in: from as unknown as string[] } },
          data: { status: to },
        })
      } catch (err) {
        const { logger } = await import('./logger')
        logger.error('[reconcileMasterStatus] vendor lane close failed (non-fatal; the order stays in the vendor queue and keeps quoting pending take-home until repaired)',
          { orderId: order.id, target, from, to, error: String(err) })
      }
    }
  }

  if (target === 'DELIVERED' && order.runnerId && ((order.deliveryFee ?? 0) > 0 || (order.tip ?? 0) > 0)) {
    // CRITICAL money move (Phase 4) — RECORD runner + organizer earnings. The
    // runner-fulfilled fee (delivery OR curbside, in deliveryFee) splits
    // runner/organizer by runnerFeePercent (sums exactly via splitRunnerFee); the
    // tip is 100% the runner's. A delivery finishing without accruing these is the
    // leak class. Idempotent via orderId @unique — never double-records. This is
    // where Part A economics (splits + tips) connect to the lifecycle.
    try {
      const { splitRunnerFee } = await import('./payout-split')
      const ev = await db.event.findUnique({
        where: { id: order.eventId },
        select: { organizerId: true, fulfillmentConfig: { select: { runnerFeePercent: true } } },
      })
      const runnerPct = ev?.fulfillmentConfig?.runnerFeePercent ?? 0
      const feeCents = Math.round((order.deliveryFee ?? 0) * 100)
      const tipCents = Math.round((order.tip ?? 0) * 100)
      const { runnerShareCents, organizerShareCents } = splitRunnerFee(feeCents, runnerPct)

      await db.runnerEarning.upsert({
        where: { orderId: order.id },
        create: { eventId: order.eventId, orderId: order.id, runnerId: order.runnerId, amountCents: runnerShareCents + tipCents, status: 'tracked' },
        update: {}, // idempotent — never double-record
      })
      if (organizerShareCents > 0) {
        await db.organizerEarning.upsert({
          where: { orderId: order.id },
          create: {
            eventId: order.eventId, orderId: order.id, organizerId: ev?.organizerId ?? null,
            amountCents: organizerShareCents,
            source: order.fulfillmentType === 'CURBSIDE' ? 'curbside_fee_share' : 'delivery_fee_share',
            status: 'accrued',
          },
          update: {}, // idempotent
        })
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reconcileMasterStatus] earning accrual failed (non-fatal; reconciler Pattern L alerts)', { orderId: order.id, error: String(err) })
    }

    // Part B B2 — DELAYED runner payout enqueue, behind the refund window (mirror
    // the vendor payout exactly: pay AFTER the window so in-window refunds resolve
    // pre-transfer). Idempotent (jobId + Stripe key). A dropped enqueue is caught
    // by reconcileRunnerPayouts (Pattern P) once the window closes. The earning
    // accrued just above is the hold if the runner isn't connected yet.
    try {
      const { enqueueRunnerPayout } = await import('./order-side-effects')
      const { REFUND_WINDOW_MS } = await import('./constants')
      await enqueueRunnerPayout({ orderId: order.id, eventId: order.eventId, delayMs: REFUND_WINDOW_MS })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reconcileMasterStatus] runner payout enqueue failed (non-fatal; reconciler Pattern P backstops)', { orderId: order.id, error: String(err) })
    }
  }

  // Firebase push (both nodes) so the customer tracker AND the vendor dashboard see
  // the master status. The runner feed polls Postgres, but the dashboards subscribe
  // to Firebase. Idempotent fire-and-forget — harmless alongside W4/W7's own pushes.
  try {
    const { fireAndForgetFirebaseUpdate } = await import('./firebase-sync')
    const now = Date.now()
    fireAndForgetFirebaseUpdate(`fairs/${order.eventId}/orders/${order.vendorId}/${order.id}`, { status: target, updatedAt: now }, { orderId: order.id })
    fireAndForgetFirebaseUpdate(`fairs/${order.eventId}/customerOrders/${order.customerId}/${order.id}`, { status: target, updatedAt: now }, { orderId: order.id })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reconcileMasterStatus] firebase push failed (non-fatal)', { orderId: order.id, error: String(err) })
  }

  const how = opts?.timeout ? 'asserted timeout/override'
    : opts?.cancel ? 'caller cancel intent'
    : `derived from ${target === 'RUNNER_COLLECTED' || target === 'DELIVERED' ? 'runner state' : 'vendor truth'}`
  return { wrote: true, orderId, from: stored, to: target as MasterStatus, reason: `wrote ${target} (${how})` }
}
