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

import { TERMINAL_STATUSES, COMPLETED_STATUSES } from './order-status'
import type { OrderStatus as PrismaOrderStatus } from '@prisma/client'

export type MasterStatus =
  | 'PENDING_PAYMENT' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'RUNNER_COLLECTED' | 'COMPLETED' | 'DELIVERED'
  | 'CANCELLED' | 'UNCOLLECTED' | 'UNDELIVERABLE'

export type FulfillmentType = 'BOOTH_PICKUP' | 'CURBSIDE' | 'HOME_DELIVERY'

// Per-vendor portion statuses (VendorOrderStatus.status is a free String column).
type VendorStatus =
  | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED'
  | 'DECLINED' | 'REFUNDED' | 'CANCELLED'

// ─── Rank tables ─────────────────────────────────────────────────────────────
// MASTER_RANK drives the monotonicity guard used in the WRITE phase (Phase 1+):
// the aggregator only ADVANCES master (rank must strictly increase), so a late
// vendor write can never regress DELIVERED → READY. Terminal OVERRIDES are
// absorbing — they apply from any non-terminal state and are never re-derived.
// COMPLETED and DELIVERED share rank 6 and are mutually exclusive by arm.

export const MASTER_RANK: Record<MasterStatus, number> = {
  PENDING_PAYMENT:  0,
  PLACED:           1,
  ACCEPTED:         2,
  PREPARING:        3,
  READY:            4,
  RUNNER_COLLECTED: 5,
  COMPLETED:        6, // booth terminal-success
  DELIVERED:        6, // delivery terminal-success (mutually exclusive with COMPLETED)
  // Terminal overrides — absorbing, not part of the forward ladder:
  CANCELLED:        99,
  UNCOLLECTED:      99,
  UNDELIVERABLE:    99,
}

// Terminal SUCCESS states (reachable by derivation).
const TERMINAL_SUCCESS = new Set<MasterStatus>(COMPLETED_STATUSES as readonly string[] as MasterStatus[])

// Terminal OVERRIDE states — externally/time-driven, NOT derivable from
// per-vendor truth. The reader treats a stored override the derivation can't
// reproduce as BENIGN (the write phase preserves it via a terminalOverride input).
const TERMINAL_OVERRIDE = new Set<MasterStatus>(['CANCELLED', 'UNCOLLECTED', 'UNDELIVERABLE'])

const ALL_TERMINAL = new Set<string>(TERMINAL_STATUSES as readonly string[])

// Per-vendor progress ladder (failed portions are filtered out before this).
const VENDOR_PROGRESS: Record<string, number> = {
  PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY: 3, COMPLETED: 4,
}
const PROGRESS_TO_STATUS: MasterStatus[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']

// A vendor portion is "out" (doesn't gate the order's progress) once it fails.
const FAILED_VENDOR = new Set<VendorStatus>(['DECLINED', 'REFUNDED', 'CANCELLED'])

const DELIVERY_ARM = new Set<FulfillmentType>(['HOME_DELIVERY', 'CURBSIDE'])

// ─── Derivation inputs ───────────────────────────────────────────────────────

export interface DeriveInput {
  fulfillmentType: FulfillmentType
  vendorStatuses: { status: string }[]
  // Runner overlay (delivery arm only): set by the runner's claim / deliver
  // transitions. The derivation reads them but never writes them.
  runnerId?: string | null
  deliveryProofPath?: string | null // present once the runner confirms delivery
  voided?: boolean                 // voidedAt set → excluded from the model
}

export interface DeriveResult {
  derived: MasterStatus | 'SKIP'
  arm: 'booth' | 'delivery' | 'none'
  reason: string
}

// ─── The pure derivation ─────────────────────────────────────────────────────

export function deriveMasterStatus(input: DeriveInput): DeriveResult {
  if (input.voided) {
    return { derived: 'SKIP', arm: 'none', reason: 'order is voided (out of model)' }
  }

  const rows = input.vendorStatuses.map(v => v.status as VendorStatus)

  // No per-vendor truth exists → the aggregator has NO JURISDICTION and abstains.
  // (Genuinely pre-placement PENDING_PAYMENT is owned by placement/W2, not here;
  // legacy/pre-migration rowless orders must never be re-derived. Live sweep
  // proved deriving PENDING_PAYMENT here mis-flags real PLACED/terminal orders.)
  if (rows.length === 0) {
    return { derived: 'SKIP', arm: 'none', reason: 'no VendorOrderStatus rows — abstain (no jurisdiction)' }
  }

  const active = rows.filter(s => !FAILED_VENDOR.has(s))

  // No active portions remain — every portion is declined / refunded / cancelled.
  if (active.length === 0) {
    // CANCELLED is only safe when every portion was DECLINED (genuinely never
    // fulfilled). A REFUNDED portion is a MONEY event, NOT a fulfillment-failure:
    // it may have been COMPLETED/DELIVERED first (post-fulfillment refund,
    // chargeback, incident). REFUNDED overwrote the prior fulfillment state, so
    // it's lossy — we cannot tell cancelled-refund from completed-then-refund.
    // Money-truth lives in Refund rows; the fulfillment aggregator must NOT
    // fabricate CANCELLED from refund state. Abstain. (Live sweep caught this:
    // a COMPLETED order with all portions refunded was deriving CANCELLED, and
    // the write guard WOULD have advanced two PLACED ones to CANCELLED.)
    const anyRefunded = rows.some(s => s === 'REFUNDED')
    if (anyRefunded) {
      return { derived: 'SKIP', arm: 'none', reason: 'all portions terminal incl. REFUNDED — abstain (lossy money state)' }
    }
    return { derived: 'CANCELLED', arm: 'none', reason: 'all vendor portions DECLINED — never fulfilled' }
  }

  const isDelivery = DELIVERY_ARM.has(input.fulfillmentType)
  const arm = isDelivery ? 'delivery' : 'booth'

  // Vendor-derived base = the MINIMUM progress across active portions. "All ready
  // → READY"; "one still preparing → PREPARING" falls out of the min.
  const minProgress = Math.min(...active.map(s => VENDOR_PROGRESS[s] ?? 0))
  const base = PROGRESS_TO_STATUS[minProgress]

  if (!isDelivery) {
    // BOOTH_PICKUP — vendor-driven completion; base may reach COMPLETED.
    return { derived: base, arm, reason: `booth: min vendor progress = ${base}` }
  }

  // DELIVERY arm — vendor base tops out at READY. A vendor portion marked
  // COMPLETED on a delivery order means "handed to runner", NOT order-complete;
  // it clamps to READY and the runner overlay decides the rest.
  const clampedRank = Math.min(MASTER_RANK[base], MASTER_RANK.READY)

  if (clampedRank < MASTER_RANK.READY) {
    const status = (MASTER_RANK.ACCEPTED === clampedRank ? 'ACCEPTED'
      : MASTER_RANK.PREPARING === clampedRank ? 'PREPARING'
      : 'PLACED') as MasterStatus
    return { derived: status, arm, reason: `delivery: not all ready (min = ${status})` }
  }

  // All active portions are READY (or COMPLETED→clamped). Runner overlay decides.
  if (input.deliveryProofPath) {
    return { derived: 'DELIVERED', arm, reason: 'delivery: runner confirmed (photo present)' }
  }
  if (input.runnerId) {
    return { derived: 'RUNNER_COLLECTED', arm, reason: 'delivery: claimed by runner, not yet delivered' }
  }
  return { derived: 'READY', arm, reason: 'delivery: all vendors ready, awaiting runner claim' }
}

// ─── Monotonicity guard (spec for the WRITE phase; shown now for review) ──────
// In Phase 1+ the aggregator applies the derived status ONLY when this allows it,
// as a status-conditional update. Never regress; never touch a terminal order;
// terminal overrides may absorb a non-terminal order.

export function canAdvance(stored: MasterStatus, derived: MasterStatus): boolean {
  if (stored === derived) return false                 // no-op
  if (ALL_TERMINAL.has(stored)) return false           // terminal is absorbing — never leave it
  if (TERMINAL_OVERRIDE.has(derived)) return true      // override may apply from any non-terminal
  return MASTER_RANK[derived] > MASTER_RANK[stored]    // otherwise: strictly forward only
}

// ─── Divergence classification (the Phase 0 report) ──────────────────────────

export type Divergence =
  | 'MATCH'
  | 'UNDER_ADVANCED'   // stored lags behind truth — the BUG class (handoff etc.)
  | 'BENIGN_OVERRIDE'  // stored is a terminal override derivation can't see — expected
  | 'REGRESSION_RISK'  // derivation wants to move backward — MUST be empty
  | 'UNEXPECTED'       // anything else — investigate

export function classifyDivergence(stored: MasterStatus, derived: MasterStatus | 'SKIP'): Divergence {
  if (derived === 'SKIP') return 'MATCH' // voided orders are excluded
  if (stored === derived) return 'MATCH'

  // Stored is an externally-set terminal the derivation legitimately cannot
  // reproduce from per-vendor truth (payment-fail cancel, no-show timeout, …).
  if (TERMINAL_OVERRIDE.has(stored) && !TERMINAL_OVERRIDE.has(derived)) return 'BENIGN_OVERRIDE'

  const rs = MASTER_RANK[stored]
  const rd = MASTER_RANK[derived]

  // Both on the forward ladder (ranks < 99): compare position.
  if (rs < 99 && rd < 99) {
    if (rd > rs) return 'UNDER_ADVANCED'
    if (rd < rs) return 'REGRESSION_RISK'
  }
  return 'UNEXPECTED'
}

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
