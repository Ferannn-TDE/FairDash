/**
 * Reconciliation sweep — the periodic backstop (Bucket B from the leak audit).
 *
 * PRINCIPLE: Stripe = money-truth, DB = state-truth, Firebase = projection.
 * This sweep COMPARES money-truth against state-truth and repairs IDEMPOTENTLY
 * by calling the EXISTING proven functions. It ORCHESTRATES; it never
 * reimplements placement/payout/timeout/money logic. A reconciler with its own
 * copy of money math is a leak generator — so every repair here routes through:
 *
 *   placePaidOrder()       — convergent, idempotent placement      (Patterns A,B,F)
 *   enqueueOrderPayout()   — idempotent payout enqueue → worker     (Patterns C,D)
 *   JOB_UNACCEPTED enqueue — the SAME accept-timeout handler        (Pattern E)
 *
 * GUARDRAILS:
 *   - IDEMPOTENT: a second consecutive run changes nothing (all repairs dedupe).
 *   - BOUNDED: recent-time-window + per-pattern row cap + Stripe pagination cap.
 *   - NEVER act on ambiguous money: if a repair would move money and we cannot
 *     be CERTAIN it wasn't already paid, we DON'T — we alert. Under-pay-and-alert
 *     beats over-pay-silently.
 *   - OBSERVABLE: returns a per-run summary {scanned, repaired-by-pattern,
 *     alerted, ambiguousSkipped} and logs it.
 *   - BACKSTOP, NOT PRIMARY: non-zero repairs mean a real-time path is leaking —
 *     surfaced as backstopWarnings, never silently papered over.
 *
 * WORKER-DOWN CAVEAT: this sweep runs ON the worker, so it cannot self-heal
 * "the worker is down." Monitoring the worker process is a separate deploy-time
 * concern (e.g. Render health checks / external uptime monitor).
 */

import { OrderStatus } from '@prisma/client'
import { db } from './db'
import { stripe } from './stripe'
import { placePaidOrder } from './place-order'
import { enqueueOrderPayout } from './order-side-effects'
import { refundVendorPortion } from './process-refund'
import { retryChargebackClawback } from './process-chargeback'
import { splitRunnerFee } from './payout-split'
import { reconcileRunnerPayouts } from './runner-payout'
import { reconcileOrganizerPayouts } from './organizer-payout'
import { reconcileTipRefunds } from './tip-refund'
import { getOrderQueue, JOB_UNACCEPTED } from './queues'
import { enqueueJobSafely } from './queue-safe'
import { VENDOR_ACCEPT_TIMEOUT_MS, REFUND_WINDOW_MS, CURBSIDE_WAIT_TIMEOUT_MS } from './constants'
import { logger } from './logger'
import { deriveMasterStatus, canAdvance, reconcileMasterStatus, type MasterStatus, type FulfillmentType } from './reconcile-order-status'

// ─── Tunables (all overridable per-run) ─────────────────────────────────────

export interface SweepOptions {
  /** If true: detect + log only, no repairs of ANY pattern. */
  dryRun?: boolean
  /** DB-pattern lookback (B,C,E) and PENDING_PAYMENT age floor for F. Hours. */
  windowHours?: number
  /** Stripe PaymentIntent list lookback for Pattern A. Hours. */
  stripeWindowHours?: number
  /** Max rows acted on per pattern per run (bound). */
  maxPerPattern?: number
  /** Max Stripe list pages for Pattern A (each page ≤100 PIs). */
  maxStripePages?: number
  /** Age (hours) a PENDING_PAYMENT order must exceed before Pattern F touches it. */
  pendingStaleHours?: number
  /**
   * Pattern E ACTS (enqueues real cancel+refund) only when true. Default false:
   * the recurring sweep only DETECTS + ALERTS which orders it WOULD cancel, so
   * its debut can never nuke test orders. Flip via RECONCILER_PATTERN_E_ENABLED.
   */
  patternEEnabled?: boolean
  /**
   * Pattern N (drift backstop) REPAIRS (calls the aggregator to heal a status that
   * diverged from per-vendor truth) only when true. Default false: the recurring
   * sweep DETECTS + ALERTS drift so its debut can never auto-move money via the
   * aggregator's side-effects. Flip via RECONCILER_BACKSTOP_ENABLED. On a converged
   * board drift should be ~0 — the alert is the early-warning that a new code path
   * started writing status outside the aggregator.
   */
  backstopEnabled?: boolean
}

const DEFAULTS = {
  windowHours: 24,
  stripeWindowHours: 6,
  maxPerPattern: 100,
  maxStripePages: 5,
  pendingStaleHours: 2,
}

export interface SweepSummary {
  startedAt: string
  finishedAt: string
  durationMs: number
  dryRun: boolean
  patternEEnabled: boolean
  backstopEnabled: boolean
  scanned: {
    stripePIs: number
    completedOrders: number
    activeOrders: number
    pendingOrders: number
    unresolvedHolds: number
  }
  /** Counts of orders/holds actually repaired (or, in dryRun, that WOULD be). */
  repaired: { A: number; B: number; C: number; D: number; E: number; F: number; G: number; H: number; I: number; J: number; K: number; L: number; M: number; N: number; O: number; P: number; Q: number; R: number; S: number }
  /** Order/PI ids touched per pattern (for the human-readable log). */
  details: {
    A: string[]; B: string[]; C: string[]; D: string[]; E: string[]; F: string[]; G: string[]; H: string[]; I: string[]; J: string[]; K: string[]; L: string[]; M: string[]; N: string[]; O: string[]; P: string[]; Q: string[]; R: string[]; S: string[]
  }
  /** Unrepairable-by-design — needs a human. Money is safe; we just can't auto-fix. */
  alerted: string[]
  /** Money repairs we refused because we couldn't be certain it wasn't already paid. */
  ambiguousSkipped: number
  /** Non-zero repairs ⇒ a real-time path is leaking. Surfaced, never hidden. */
  backstopWarnings: string[]
}

// Post-placement, non-terminal states an order can sit in (Pattern B).
const ACTIVE_STATES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.RUNNER_COLLECTED,
]

// Terminal-complete states a payout is owed against (Pattern C).
const COMPLETE_STATES: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.DELIVERED]

// ─── Sweep ───────────────────────────────────────────────────────────────────

export async function runReconciliationSweep(opts: SweepOptions = {}): Promise<SweepSummary> {
  const dryRun = opts.dryRun ?? false
  const windowHours = opts.windowHours ?? DEFAULTS.windowHours
  const stripeWindowHours = opts.stripeWindowHours ?? DEFAULTS.stripeWindowHours
  const maxPerPattern = opts.maxPerPattern ?? DEFAULTS.maxPerPattern
  const maxStripePages = opts.maxStripePages ?? DEFAULTS.maxStripePages
  const pendingStaleHours = opts.pendingStaleHours ?? DEFAULTS.pendingStaleHours
  const patternEEnabled =
    opts.patternEEnabled ?? (process.env.RECONCILER_PATTERN_E_ENABLED === 'true')
  const backstopEnabled =
    opts.backstopEnabled ?? (process.env.RECONCILER_BACKSTOP_ENABLED === 'true')

  const startedAt = new Date()
  const windowStart = new Date(startedAt.getTime() - windowHours * 3600_000)

  const sum: SweepSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: '',
    durationMs: 0,
    dryRun,
    patternEEnabled,
    backstopEnabled,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0 },
    details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [] },
    alerted: [],
    ambiguousSkipped: 0,
    backstopWarnings: [],
  }

  try {
    await patternA(sum, { stripeWindowHours, maxStripePages, dryRun })
    await patternB(sum, { windowStart, maxPerPattern, dryRun })
    // S BEFORE C/D — ORDER IS LOAD-BEARING. Pattern S restores a missing VendorEarning
    // (the admin's hold target). Patterns C and D PAY unpaid orders. If S ran after
    // them, C would pay the money out — and incidentally materialise the row via the
    // executor's re-accrual — before S could restore anything holdable. The row would
    // reappear at the exact moment it stopped being useful, which is the failure this
    // pattern exists to prevent. Restore the hold target FIRST, then pay.
    await patternS(sum, { windowStart, maxPerPattern, dryRun })
    await patternC(sum, { windowStart, maxPerPattern, dryRun })
    await patternD(sum, { maxPerPattern, dryRun })
    await patternE(sum, { windowStart, maxPerPattern, dryRun, patternEEnabled })
    await patternF(sum, { pendingStaleHours, maxPerPattern, dryRun })
    await patternG(sum, { maxPerPattern, dryRun })
    await patternH(sum, { windowStart, maxPerPattern, dryRun })
    await patternI(sum, { maxPerPattern, dryRun })
    await patternJ(sum, { maxPerPattern })
    await patternK(sum, { maxPerPattern })
    await patternL(sum, { windowStart, maxPerPattern })
    await patternM(sum, { maxPerPattern })
    await patternN(sum, { maxPerPattern, backstopEnabled })
    await patternO(sum, { maxPerPattern })
    await patternP(sum, { maxPerPattern, dryRun })
    await patternQ(sum, { maxPerPattern, dryRun })
    await patternR(sum, { maxPerPattern, dryRun })
  } catch (err) {
    logger.error('[Reconciler] Sweep aborted mid-run', { error: String(err) })
    sum.alerted.push(`SWEEP ABORTED: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Backstop signal: any repair means a primary path leaked. Surface it.
  const totalRepaired = Object.values(sum.repaired).reduce((a, b) => a + b, 0)
  if (!dryRun && totalRepaired > 0) {
    for (const [pat, n] of Object.entries(sum.repaired)) {
      if (n > 0) sum.backstopWarnings.push(
        `Pattern ${pat} repaired ${n} — a real-time path is leaking; investigate, don't rely on the sweep.`,
      )
    }
  }

  const finishedAt = new Date()
  sum.finishedAt = finishedAt.toISOString()
  sum.durationMs = finishedAt.getTime() - startedAt.getTime()

  logger.info('[Reconciler] sweep complete', {
    dryRun,
    patternEEnabled,
    scanned: sum.scanned,
    repaired: sum.repaired,
    alerted: sum.alerted.length,
    ambiguousSkipped: sum.ambiguousSkipped,
    durationMs: sum.durationMs,
  })
  if (sum.alerted.length) logger.warn('[Reconciler] ALERTS (human review)', { alerted: sum.alerted })
  if (sum.backstopWarnings.length) logger.warn('[Reconciler] BACKSTOP WARNINGS', { backstopWarnings: sum.backstopWarnings })

  return sum
}

// ─── PATTERN A — Paid in Stripe, not fully placed (boundary 1) ───────────────
// List recent SUCCEEDED PIs that are OURS (metadata marker). For each, find the
// order by PI id. If missing → ALERT (cannot reconstruct without reimplementing
// placement). If PENDING_PAYMENT or PLACED-with-0-vendor-rows → placePaidOrder
// converges it. Catches money-in-Stripe with no/half order even if BOTH the
// client confirm AND the webhook failed.
async function patternA(
  sum: SweepSummary,
  o: { stripeWindowHours: number; maxStripePages: number; dryRun: boolean },
) {
  if (!process.env.STRIPE_SECRET_KEY) {
    sum.alerted.push('Pattern A skipped — STRIPE_SECRET_KEY unset')
    return
  }
  const createdGte = Math.floor((Date.now() - o.stripeWindowHours * 3600_000) / 1000)

  let startingAfter: string | undefined
  for (let page = 0; page < o.maxStripePages; page++) {
    const res = await stripe.paymentIntents.list({
      created: { gte: createdGte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const pi of res.data) {
      // OUR-platform marker: our checkout always stamps eventId + customerId.
      // Filtering on it ignores unrelated charges on the same Stripe account.
      const isOurs = !!(pi.metadata?.eventId && pi.metadata?.customerId)
      if (!isOurs || pi.status !== 'succeeded') continue
      sum.scanned.stripePIs++

      const order = await db.order.findFirst({
        where: { stripePaymentIntentId: pi.id, voidedAt: null },
        select: {
          id: true, status: true,
          _count: { select: { vendorOrderStatuses: true } },
        },
      })

      if (!order) {
        // Money exists in Stripe but no order row at all. We will NOT reconstruct
        // the order from metadata (that reimplements placement). Flag for a human.
        sum.alerted.push(`Pattern A: succeeded PI ${pi.id} has NO order row — human review (place or refund manually)`)
        continue
      }

      const needsPlacement =
        order.status === OrderStatus.PENDING_PAYMENT ||
        (order.status === OrderStatus.PLACED && order._count.vendorOrderStatuses === 0)
      if (!needsPlacement) continue

      if (o.dryRun) { sum.repaired.A++; sum.details.A.push(order.id); continue }

      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : undefined
      const r = await placePaidOrder(order.id, chargeId)
      if (r.placed) { sum.repaired.A++; sum.details.A.push(order.id) }
    }
    if (!res.has_more) break
    startingAfter = res.data[res.data.length - 1]?.id
  }
}

// ─── PATTERN B — Active order, 0 vendor rows (boundary 2) ────────────────────
// An order at PLACED+ with zero VendorOrderStatus rows is invisible to vendors.
// placePaidOrder converges (creates the rows, re-pushes Firebase, schedules the
// accept-timeout). Idempotent.
async function patternB(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const candidates = await db.order.findMany({
    where: {
      status: { in: ACTIVE_STATES },
      placedAt: { gte: o.windowStart },
      vendorOrderStatuses: { none: {} },
      voidedAt: null,
    },
    select: { id: true },
    orderBy: { placedAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.activeOrders += candidates.length

  for (const c of candidates) {
    if (o.dryRun) { sum.repaired.B++; sum.details.B.push(c.id); continue }
    const r = await placePaidOrder(c.id)
    if (r.placed) { sum.repaired.B++; sum.details.B.push(c.id) }
  }
}

// ─── PATTERN C — COMPLETED without payout (boundary 4, the critical one) ─────
// For each terminal-complete order, every PAYABLE vendor must be covered by a
// Payout row, a PayoutHold, or a DECLINED status. A vendor covered by none was
// never paid → the enqueue dropped (worker/Redis down). enqueueOrderPayout is
// idempotent (jobId dedup + Stripe per-order+vendor idempotency keys + Payout
// upsert), so re-running can never double-pay — but we still gate detection so
// covered orders are never re-enqueued needlessly.
async function patternC(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  // WINDOW BOUNDARY (decision C2): payout fires at completedAt + REFUND_WINDOW_MS.
  // Pattern C must ONLY flag orders whose window has CLOSED — otherwise it would
  // pay every order immediately and defeat the refund window. The band is:
  //   windowStart (boundedness lower bound) ≤ completedAt < now − REFUND_WINDOW_MS
  // i.e. completed long enough ago that the delayed payout should already have
  // fired, but recent enough to still be in scan range.
  const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
  const orders = await db.order.findMany({
    where: {
      status: { in: COMPLETE_STATES },
      completedAt: { gte: o.windowStart, lt: windowClosedBefore },
      voidedAt: null,
    },
    select: {
      id: true, eventId: true,
      total: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, tip: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      payouts: { select: { vendorId: true } },
      payoutHolds: { select: { vendorId: true } },
      refunds: { select: { vendorId: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
      // C1: admin-gated slices. An admin hold writes NO PayoutHold row (that table is
      // the "pay me when I connect" waiting room that Pattern D drains), so without
      // this the gap check below would see a held vendor as an unpaid gap and
      // re-enqueue the payout on EVERY sweep.
      vendorEarnings: { select: { vendorId: true, status: true } },
    },
    orderBy: { completedAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.completedOrders += orders.length

  for (const ord of orders) {
    const payableVendors = new Set(ord.orderItems.map(i => i.vendorId))
    const paid = new Set(ord.payouts.map(p => p.vendorId))
    const held = new Set(ord.payoutHolds.map(h => h.vendorId))
    const refunded = new Set(ord.refunds.map(r => r.vendorId))
    const declined = new Set(
      ord.vendorOrderStatuses
        .filter(s => s.status === 'DECLINED' || s.status === 'REFUNDED')
        .map(s => s.vendorId),
    )
    // C1 — admin-blocked vendors. NOT a gap: the money is deliberately parked in the
    // platform balance. This is an ANTI-CHURN optimisation only; correctness does not
    // depend on it, because processOrderPayout's gate refuses these slices even if
    // this pattern does enqueue them. Belt (gate) and braces (this).
    const adminBlocked = new Set(
      ord.vendorEarnings
        .filter(e => e.status === 'held' || e.status === 'cancelled')
        .map(e => e.vendorId),
    )

    // A gap = a payable vendor with no payout, no hold, not admin-blocked, not
    // declined, NOT refunded. (A refunded vendor must never be paid — their slice
    // went back to the customer.)
    const gap = [...payableVendors].some(
      v => !paid.has(v) && !held.has(v) && !adminBlocked.has(v) && !declined.has(v) && !refunded.has(v),
    )
    if (!gap) continue

    // Pre-flight the SAME customer-side money identity processOrderPayout asserts
    // first. If it doesn't hold (e.g. total omits the service fee — malformed
    // data), the payout would HALT and never settle. Re-enqueuing it every sweep
    // is futile noise, so we DON'T act on this ambiguous money — we ALERT it for
    // a human. Under-pay-and-flag beats churning an unreconcilable order forever.
    const subtotalCents = ord.orderItems.reduce((s, i) => s + Math.round(i.subtotal * 100), 0)
    const customerSide = subtotalCents
      + Math.round(ord.fairSynqFee * 100)
      + Math.round((ord.deliveryFee ?? 0) * 100)
      + Math.round((ord.serviceCharge ?? 0) * 100)
      + Math.round((ord.tip ?? 0) * 100)
    const totalCents = Math.round(ord.total * 100)
    if (customerSide !== totalCents) {
      sum.ambiguousSkipped++
      sum.alerted.push(
        `Pattern C: order ${ord.id} has an UNRECONCILABLE money identity ` +
        `(charge ${totalCents}¢ ≠ subtotal ${subtotalCents} + fee ${Math.round(ord.fairSynqFee * 100)} ` +
        `+ delivery ${Math.round((ord.deliveryFee ?? 0) * 100)} + serviceCharge ${Math.round((ord.serviceCharge ?? 0) * 100)} ` +
        `+ tip ${Math.round((ord.tip ?? 0) * 100)}) ` +
        `— payout would halt; manual review (do NOT auto-pay)`,
      )
      continue
    }

    if (o.dryRun) { sum.repaired.C++; sum.details.C.push(ord.id); continue }
    // enqueueOrderPayout → worker runs processOrderPayout (proven, idempotent).
    const ok = await enqueueOrderPayout({ orderId: ord.id, eventId: ord.eventId })
    if (ok) { sum.repaired.C++; sum.details.C.push(ord.id) }
    else { sum.alerted.push(`Pattern C: payout enqueue DROPPED for order ${ord.id} — Redis/queue down`) }
  }
}

// ─── PATTERN D — Unresolved hold for a now-verified vendor (boundary 4b) ─────
// A held slice whose vendor has since completed Stripe onboarding can now be
// paid. enqueueOrderPayout → worker pays the connected vendor and resolves the
// hold (processOrderPayout marks resolved on a successful transfer).
async function patternD(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  const holds = await db.payoutHold.findMany({
    where: {
      resolved: false,
      // C1: a frozen vendor's holds are NOT drained. Anti-churn only — an admin hold
      // never lands in this table in the first place, and processOrderPayout's gate
      // is the authoritative stop either way.
      vendor: { stripeVerified: true, stripeAccountId: { not: null }, payoutsFrozenAt: null },
      order: { voidedAt: null },
    },
    select: { orderId: true, eventId: true, vendorId: true },
    take: o.maxPerPattern,
  })
  sum.scanned.unresolvedHolds += holds.length

  // One enqueue per order (a single payout run covers all that order's holds).
  const seen = new Set<string>()
  for (const h of holds) {
    if (seen.has(h.orderId)) continue
    seen.add(h.orderId)
    if (o.dryRun) { sum.repaired.D++; sum.details.D.push(h.orderId); continue }
    const ok = await enqueueOrderPayout({ orderId: h.orderId, eventId: h.eventId })
    if (ok) { sum.repaired.D++; sum.details.D.push(h.orderId) }
    else { sum.alerted.push(`Pattern D: payout enqueue DROPPED for held order ${h.orderId} — Redis/queue down`) }
  }
}

// ─── PATTERN E — Stuck PLACED past the accept window (boundary 3b) ───────────
// An order PLACED longer than the accept window with NO vendor action means the
// accept-timeout never fired (worker/Redis down at enqueue time). Re-enqueuing
// JOB_UNACCEPTED runs the EXACT SAME handler that the real-time path uses (it
// re-checks status===PLACED and cancels+refunds). DANGEROUS: it moves money, so
// it ACTS only when patternEEnabled; otherwise it ALERTS the orders it WOULD act
// on — the log-only first pass that protects test orders on debut.
async function patternE(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean; patternEEnabled: boolean },
) {
  const cutoff = new Date(Date.now() - VENDOR_ACCEPT_TIMEOUT_MS)
  const candidates = await db.order.findMany({
    where: {
      status: OrderStatus.PLACED,
      placedAt: { gte: o.windowStart, lt: cutoff },
      // No vendor has moved off PLACED (no acceptance/decline/progress anywhere).
      vendorOrderStatuses: { none: { status: { not: 'PLACED' } } },
      voidedAt: null,
    },
    select: { id: true, eventId: true, vendorId: true, placedAt: true },
    orderBy: { placedAt: 'asc' },
    take: o.maxPerPattern,
  })

  if (!o.patternEEnabled || o.dryRun) {
    // Log-only: surface exactly which orders WOULD be cancelled+refunded.
    for (const c of candidates) {
      sum.details.E.push(c.id)
      sum.alerted.push(
        `Pattern E (LOG-ONLY): order ${c.id} PLACED since ${c.placedAt.toISOString()} would be auto-cancelled+refunded` +
        `${o.patternEEnabled ? ' (dryRun)' : ' (set RECONCILER_PATTERN_E_ENABLED=true to act)'}`,
      )
    }
    return
  }

  const queue = getOrderQueue()
  if (!queue) {
    if (candidates.length) sum.alerted.push(`Pattern E: ${candidates.length} stuck order(s) but queue unavailable`)
    return
  }
  for (const c of candidates) {
    // Reuse the real-time accept-timeout job; jobId dedupes against any still-
    // pending original. delay:0 fires it now.
    const r = await enqueueJobSafely({
      queue,
      name: JOB_UNACCEPTED,
      data: { orderId: c.id, vendorId: c.vendorId, eventId: c.eventId },
      jobId: `unaccepted-${c.id}`,
      delay: 0,
      priority: 'normal',
    })
    if (r !== 'dropped') { sum.repaired.E++; sum.details.E.push(c.id) }
    else { sum.alerted.push(`Pattern E: accept-timeout enqueue DROPPED for order ${c.id}`) }
  }
}

// ─── PATTERN F — Stale PENDING_PAYMENT (boundary 5) ──────────────────────────
// A PENDING_PAYMENT order older than the stale floor is either a paid order
// whose placement was missed, or an abandoned/declined checkout. Ask Stripe:
//   succeeded                → placePaidOrder (dedupes with Pattern A)
//   canceled / no PI          → phantom: delete the unpaid row (no money moved)
//   anything else (ambiguous) → leave + count ambiguousSkipped (never delete a
//                               checkout that might still complete)
async function patternF(
  sum: SweepSummary,
  o: { pendingStaleHours: number; maxPerPattern: number; dryRun: boolean },
) {
  const cutoff = new Date(Date.now() - o.pendingStaleHours * 3600_000)
  const candidates = await db.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, createdAt: { lt: cutoff }, voidedAt: null },
    select: { id: true, stripePaymentIntentId: true },
    orderBy: { createdAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.pendingOrders += candidates.length

  for (const c of candidates) {
    let piStatus: string | 'missing' = 'missing'
    if (process.env.STRIPE_SECRET_KEY && c.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(c.stripePaymentIntentId)
        piStatus = pi.status
        if (pi.status === 'succeeded') {
          if (o.dryRun) { sum.repaired.F++; sum.details.F.push(c.id); continue }
          const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : undefined
          const r = await placePaidOrder(c.id, chargeId)
          if (r.placed) { sum.repaired.F++; sum.details.F.push(c.id) }
          continue
        }
      } catch {
        piStatus = 'missing' // PI not retrievable → never really charged
      }
    }

    // Safe to clean up ONLY when we're certain no money is at stake.
    const isPhantom = piStatus === 'canceled' || piStatus === 'missing'
    if (!isPhantom) { sum.ambiguousSkipped++; continue } // requires_payment_method / processing → leave

    if (o.dryRun) { sum.repaired.F++; sum.details.F.push(c.id); continue }
    await db.$transaction([
      db.vendorOrderStatus.deleteMany({ where: { orderId: c.id } }),
      db.orderItem.deleteMany({ where: { orderId: c.id } }),
      db.order.deleteMany({ where: { id: c.id, status: OrderStatus.PENDING_PAYMENT } }),
    ])
    sum.repaired.F++; sum.details.F.push(c.id)
  }
}

// ─── PATTERN G — Refund PENDING/FAILED past a threshold (refund backstop) ────
// A Refund row stuck PENDING/FAILED means refundVendorPortion started but didn't
// finish (Stripe hiccup, crash mid-flight). Re-run it — it's idempotent (Stripe
// idempotency keys + Refund-row upsert), so a partially-done refund converges and
// a done one is a no-op. Reuses the engine, never reimplements refund logic.
async function patternG(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  // Small grace period so we don't race a refund that's completing right now.
  const cutoff = new Date(Date.now() - 2 * 60 * 1000) // 2 min
  const stuck = await db.refund.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      updatedAt: { lt: cutoff },
      order: { voidedAt: null },
    },
    select: { orderId: true, vendorId: true, reason: true },
    take: o.maxPerPattern,
  })

  for (const r of stuck) {
    if (o.dryRun) { sum.repaired.G++; sum.details.G.push(`${r.orderId}:${r.vendorId}`); continue }
    try {
      const res = await refundVendorPortion({
        orderId: r.orderId, vendorId: r.vendorId,
        reason: r.reason ?? 'reconciler retry', actor: 'reconciler',
      })
      if (res.status === 'refunded' || res.status === 'noop') {
        sum.repaired.G++; sum.details.G.push(`${r.orderId}:${r.vendorId}`)
      }
    } catch (err) {
      // Reconciliation halt or Stripe error — never silently pass; flag it.
      sum.alerted.push(`Pattern G: refund retry FAILED for ${r.orderId}:${r.vendorId} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN H — Vendor portion marked REFUNDED but no completed refund ──────
// A VendorOrderStatus='REFUNDED' with no COMPLETED Refund row = a half-done state
// (status flipped but the money record never settled). Re-run the engine to make
// the Stripe refund real, or surface it if it can't reconcile. Bounded by window.
async function patternH(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const rows = await db.vendorOrderStatus.findMany({
    where: {
      status: 'REFUNDED',
      updatedAt: { gte: o.windowStart },
      order: { voidedAt: null },
    },
    select: { orderId: true, vendorId: true },
    take: o.maxPerPattern,
  })
  if (rows.length === 0) return

  // Which (order,vendor) already have a COMPLETED refund? Those are fine.
  const completed = await db.refund.findMany({
    where: { status: 'COMPLETED', orderId: { in: rows.map(r => r.orderId) } },
    select: { orderId: true, vendorId: true },
  })
  const done = new Set(completed.map(c => `${c.orderId}:${c.vendorId}`))

  for (const r of rows) {
    if (done.has(`${r.orderId}:${r.vendorId}`)) continue // money already settled
    if (o.dryRun) { sum.repaired.H++; sum.details.H.push(`${r.orderId}:${r.vendorId}`); continue }
    try {
      const res = await refundVendorPortion({
        orderId: r.orderId, vendorId: r.vendorId, reason: 'reconciler repair (REFUNDED w/o refund)', actor: 'reconciler',
      })
      if (res.status === 'refunded' || res.status === 'noop') {
        sum.repaired.H++; sum.details.H.push(`${r.orderId}:${r.vendorId}`)
      }
    } catch (err) {
      sum.alerted.push(`Pattern H: repair FAILED for ${r.orderId}:${r.vendorId} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN I — Chargeback clawback not fully done → retry ──────────────────
// A Chargeback whose clawback is pending/partial (a vendor reversal failed at
// dispute time). Re-run via the shared retry (idempotent — reverses only the
// not-yet-reversed paid vendors).
async function patternI(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  const stuck = await db.chargeback.findMany({
    where: { clawbackStatus: { in: ['pending', 'partial'] } },
    select: { id: true, orderId: true },
    take: o.maxPerPattern,
  })
  for (const cb of stuck) {
    if (o.dryRun) { sum.repaired.I++; sum.details.I.push(cb.id); continue }
    try {
      await retryChargebackClawback(cb.id)
      sum.repaired.I++; sum.details.I.push(cb.id)
    } catch (err) {
      sum.alerted.push(`Pattern I: chargeback clawback retry FAILED for ${cb.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN J — Chargeback not yet closed, aging → surface for manual check ─
// The webhook reconciles WON/LOST; this is a backstop if a closed event was
// missed. We do NOT auto-move money — just alert so an admin checks Stripe.
async function patternJ(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000) // 7 days
  const open = await db.chargeback.findMany({
    where: { status: { notIn: ['won', 'lost', 'warning_closed'] }, createdAt: { lt: cutoff } },
    select: { id: true, stripeDisputeId: true },
    take: o.maxPerPattern,
  })
  for (const cb of open) {
    sum.details.J.push(cb.id)
    sum.alerted.push(`Pattern J: chargeback ${cb.stripeDisputeId} unresolved >7d — verify WON/LOST in Stripe (no auto-move)`)
  }
}

// ─── PATTERN K — Unresolved dispute debts → surface (chase) ──────────────────
// Open NegativeBalanceEvents from disputes (clawback gaps FairSynq fronted, or
// the recoverable dispute fee). These are vendor debts — surface, never auto-act.
async function patternK(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const debts = await db.negativeBalanceEvent.findMany({
    where: { status: 'open', kind: { in: ['dispute_clawback', 'dispute_fee'] } },
    select: { id: true, vendorId: true, amountCents: true, kind: true },
    take: o.maxPerPattern,
  })
  let total = 0
  for (const d of debts) {
    total += d.amountCents
    sum.details.K.push(d.id)
  }
  if (debts.length > 0) {
    sum.alerted.push(`Pattern K: ${debts.length} open dispute debt(s) totalling ${total}¢ — vendors owe FairSynq (chase; no auto-deduct)`)
  }
}

// ─── PATTERN L — Earnings decomposition + tip location (Part A) ───────────────
// Asserts the recorded runner/organizer earnings reconcile to the order's fee +
// tip to the cent, and that the tip lands in EXACTLY ONE place: the runner's
// earning when delivered, or owed-back-to-customer when cancelled with no runner.
// Alert-only — never moves money (runner/organizer payouts + tip refunds are a
// later money-flow phase). This is the guard that the tip is never silently kept.
async function patternL(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number },
) {
  // 1. DELIVERED runner-fulfilled orders → earnings must decompose exactly.
  // Window by updatedAt, NOT completedAt: DELIVERED never sets completedAt (only
  // COMPLETED does), so the old completedAt filter silently matched ZERO delivered
  // orders — the earnings-decomposition audit never ran on them. updatedAt is
  // touched on the DELIVERED write, so it's the correct "recently delivered" bound.
  const delivered = await db.order.findMany({
    where: {
      status: OrderStatus.DELIVERED,
      updatedAt: { gte: o.windowStart },
      OR: [{ deliveryFee: { gt: 0 } }, { tip: { gt: 0 } }],
    },
    select: {
      id: true, deliveryFee: true, tip: true,
      runnerEarning: { select: { amountCents: true } },
      organizerEarning: { select: { amountCents: true } },
      event: { select: { fulfillmentConfig: { select: { runnerFeePercent: true } } } },
    },
    take: o.maxPerPattern,
  })
  for (const ord of delivered) {
    const feeCents = Math.round((ord.deliveryFee ?? 0) * 100)
    const tipCents = Math.round((ord.tip ?? 0) * 100)
    const pct = ord.event?.fulfillmentConfig?.runnerFeePercent ?? 0
    const { runnerShareCents, organizerShareCents } = splitRunnerFee(feeCents, pct)
    const expectedRunner = runnerShareCents + tipCents
    const recordedRunner = ord.runnerEarning?.amountCents ?? null
    const recordedOrg = ord.organizerEarning?.amountCents ?? 0

    if (recordedRunner == null) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} DELIVERED with fee/tip but NO RunnerEarning — runner owed ${expectedRunner}¢ unrecorded`)
      continue
    }
    if (recordedRunner !== expectedRunner) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} RunnerEarning ${recordedRunner}¢ ≠ runnerShare ${runnerShareCents} + tip ${tipCents}`)
      continue
    }
    if (recordedOrg !== organizerShareCents) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} OrganizerEarning ${recordedOrg}¢ ≠ organizerShare ${organizerShareCents}`)
    }
  }

  // 2. Tip in limbo: a CANCELLED runner-fulfilled order with a tip but no runner
  //    earned it → the tip is OWED BACK to the customer, never kept by FairSynq.
  //    Surface any such tip so it is never silently retained as revenue.
  // Only alert on the STILL-UNREFUNDED owed-back tips: once Pattern R refunds one
  // (tipRefundId set) it must go quiet (no double-alerting on resolved tips).
  const cancelledTipped = await db.order.findMany({
    where: { status: OrderStatus.CANCELLED, tip: { gt: 0 }, runnerEarning: { is: null }, tipRefundId: null },
    select: { id: true, tip: true },
    take: o.maxPerPattern,
  })
  for (const ord of cancelledTipped) {
    sum.details.L.push(ord.id)
    sum.alerted.push(`Pattern L: cancelled order ${ord.id} has a ${Math.round((ord.tip ?? 0) * 100)}¢ tip but no runner earned it — OWED BACK to customer (Pattern R executes the refund; alert means not yet refunded)`)
  }
}

// ─── PATTERN M — Fully-refunded order whose master is still non-terminal ──────
// The order-status shadow sweep surfaced orders sitting at a non-terminal master
// status (PLACED/ACCEPTED/…) where every vendor portion is terminal AND at least
// one is REFUNDED — i.e. the order is fully refunded but the master status never
// moved off its in-flight value.
//
// The status aggregator (lib/reconcile-order-status.ts) deliberately ABSTAINS on
// these: REFUNDED is a lossy money event — from per-vendor status alone you can't
// tell a cancelled-then-refunded order from a completed-then-refunded one, so the
// status deriver must NOT fabricate CANCELLED. Whether such an order SHOULD be
// terminal is a MONEY judgment that lives in the Refund rows, not the status
// machine — so it belongs here, in the money/reconciler domain.
//
// ALERT-ONLY. We never auto-set CANCELLED (same discipline as Patterns J/K): the
// refund's nature decides the right terminal, and a human/refund-policy owns that
// call. This just guarantees the smell is never silently left as "refunded but
// PLACED".
async function patternM(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const FAILED = new Set(['DECLINED', 'REFUNDED', 'CANCELLED'])

  // Non-terminal master orders, with their per-vendor truth. (voided excluded.)
  const candidates = await db.order.findMany({
    where: { status: { in: ACTIVE_STATES }, voidedAt: null },
    select: { id: true, status: true, vendorOrderStatuses: { select: { status: true } } },
    take: o.maxPerPattern,
  })

  for (const ord of candidates) {
    const rows = ord.vendorOrderStatuses
    if (rows.length === 0) continue // no per-vendor truth — not this pattern's concern
    const allTerminal = rows.every(r => FAILED.has(r.status))
    const anyRefunded = rows.some(r => r.status === 'REFUNDED')
    if (allTerminal && anyRefunded) {
      sum.details.M.push(ord.id)
      sum.alerted.push(
        `Pattern M: order ${ord.id} is fully refunded (portions ${rows.map(r => r.status).join('/')}) ` +
        `but master status is still ${ord.status} — review whether it should be terminal ` +
        `(money judgment; status aggregator abstains, no auto-cancel)`
      )
    }
  }
}

// ─── PATTERN N — Master-status drift backstop (the no-side-door guarantee) ────
// The convergence's final guarantee: master Order.status is now owned by ONE
// function (reconcileMasterStatus), so for any active order the stored status
// should already equal what the aggregator DERIVES from per-vendor truth + the
// runner overlay. If it diverges AND the derivation is a forward (canAdvance)
// move, some path wrote status outside the aggregator — drift. On a converged
// board this should be ZERO; a non-zero count is the early-warning that a new
// writer slipped the net.
//
// REPAIRS only when backstopEnabled (calls the aggregator → which fires real
// side-effects: payout enqueue, earnings accrual). Default ALERT-ONLY — the same
// log-first debut as Pattern E, so it can never auto-move money on first run.
// Asserted/terminal states (UNCOLLECTED/UNDELIVERABLE/cancel) are NOT drift — the
// derivation can't see them, so it abstains and canAdvance refuses; they're skipped.
async function patternN(
  sum: SweepSummary,
  o: { maxPerPattern: number; backstopEnabled: boolean },
) {
  const DERIVED_OK = new Set<MasterStatus>(['READY', 'RUNNER_COLLECTED', 'COMPLETED', 'DELIVERED', 'CANCELLED'])

  const candidates = await db.order.findMany({
    where: { status: { in: ACTIVE_STATES }, voidedAt: null },
    select: {
      id: true, status: true, fulfillmentType: true, runnerId: true,
      deliveryProofPath: true, vendorOrderStatuses: { select: { status: true } },
    },
    take: o.maxPerPattern,
  })

  for (const ord of candidates) {
    if (ord.vendorOrderStatuses.length === 0) continue // no jurisdiction (pre-placement / legacy)
    const stored = ord.status as MasterStatus
    const { derived } = deriveMasterStatus({
      fulfillmentType: ord.fulfillmentType as FulfillmentType,
      vendorStatuses: ord.vendorOrderStatuses,
      runnerId: ord.runnerId,
      deliveryProofPath: ord.deliveryProofPath,
    })
    if (derived === 'SKIP' || !DERIVED_OK.has(derived)) continue // abstain / not derivable
    if (!canAdvance(stored, derived)) continue                   // already at/ahead of derived — no drift
    if (stored === derived) continue

    // Genuine drift: stored lags the derivable truth.
    if (!o.backstopEnabled) {
      sum.details.N.push(ord.id)
      sum.alerted.push(`Pattern N: order ${ord.id} status ${stored} but per-vendor truth derives ${derived} — DRIFT (a writer bypassed the aggregator). ALERT-only; set RECONCILER_BACKSTOP_ENABLED to auto-heal`)
      continue
    }
    try {
      const rec = await reconcileMasterStatus(ord.id) // heal through the single owner (+ its side-effects)
      if (rec.wrote) { sum.repaired.N++; sum.details.N.push(ord.id) }
    } catch (err) {
      sum.alerted.push(`Pattern N: heal FAILED for ${ord.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN O — Stranded READY delivery with no runner → surface ─────────────
// The stranding state Phase 1 created: a delivery/curbside order promoted to
// master READY that no runner ever claimed. The UNDELIVERABLE/UNCOLLECTED timeout
// eventually terminates it, but this surfaces the strand EARLIER (food ready, no
// driver) for ops visibility. ALERT-only — the timeout owns the terminal write.
async function patternO(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const cutoff = new Date(Date.now() - CURBSIDE_WAIT_TIMEOUT_MS)
  const stranded = await db.order.findMany({
    where: {
      status: OrderStatus.READY,
      runnerId: null,
      voidedAt: null,
      fulfillmentType: { in: ['HOME_DELIVERY', 'CURBSIDE'] as never },
      readyAt: { lt: cutoff },
    },
    select: { id: true, fulfillmentType: true, readyAt: true },
    take: o.maxPerPattern,
  })
  for (const ord of stranded) {
    const mins = ord.readyAt ? Math.round((Date.now() - ord.readyAt.getTime()) / 60000) : null
    sum.details.O.push(ord.id)
    sum.alerted.push(`Pattern O: ${ord.fulfillmentType} order ${ord.id} READY ${mins}min with NO runner — stranded delivery (food ready, no driver claimed)`)
  }
}

// ─── PATTERN P — Runner payout backstop + pay-when-connected (Part B B2) ──────
// Pays every eligible runner earning (status='tracked', runner connected, refund
// window closed). This is BOTH the post-window backstop for a dropped DELIVERED
// enqueue (like Pattern C for vendors) AND the pay-when-a-held-runner-connects
// mechanism (like Pattern D — an unconnected runner's earning held in the ledger,
// paid here once they onboard). Delegates to reconcileRunnerPayouts, which routes
// through processRunnerPayout (idempotent — never double-pays, never reimplements
// payout math). dryRun detects-without-paying.
async function patternP(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    // Count what WOULD pay without moving money: tracked + connected + window-closed.
    const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
    const eligible = await db.runnerEarning.findMany({
      where: {
        status: 'tracked',
        createdAt: { lt: windowClosedBefore },
        order: { voidedAt: null },
        runner: { stripeVerified: true, stripeAccountId: { not: null } },
      },
      select: { orderId: true },
      take: o.maxPerPattern,
    })
    for (const e of eligible) { sum.repaired.P++; sum.details.P.push(e.orderId) }
    return
  }

  const res = await reconcileRunnerPayouts({ maxPerRun: o.maxPerPattern })
  sum.repaired.P += res.paid
  for (const a of res.alerts) sum.alerted.push(`Pattern P: ${a}`)
}

// ─── PATTERN Q — Organizer batch payout backstop + pay-when-connected (B3) ────
// Pays each eligible event's organizer batch (accrued + connected + window-closed),
// re-attempts stuck pending batches (crash recovery), and is the pay-when-an-
// organizer-connects mechanism. Delegates to reconcileOrganizerPayouts → routes
// through processEventOrganizerPayout (idempotent; batch-id anchored). dryRun
// counts events that WOULD pay without moving money.
async function patternQ(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
    const accrued = await db.organizerEarning.findMany({
      where: {
        status: 'accrued',
        createdAt: { lt: windowClosedBefore },
        order: { voidedAt: null },
      },
      select: { eventId: true },
      take: o.maxPerPattern * 10,
    })
    const events = [...new Set(accrued.map(a => a.eventId))].slice(0, o.maxPerPattern)
    for (const e of events) { sum.repaired.Q++; sum.details.Q.push(e) }
    return
  }

  const res = await reconcileOrganizerPayouts({ maxPerRun: o.maxPerPattern })
  sum.repaired.Q += res.paid
  for (const a of res.alerts) sum.alerted.push(`Pattern Q: ${a}`)
}

// ─── PATTERN R — Tip-refund execution (Part B B4) — the paying sibling of L ────
// Executes the owed-back tips Pattern L only ALERTED on: a CANCELLED runner-
// fulfilled order with a tip but NO RunnerEarning → the tip is owed back to the
// customer (no one earned it). Delegates to reconcileTipRefunds → routes through
// processTipRefund (idempotent; idempotencyKey tip_refund_${orderId}; policy gate
// re-checked at execute so a runner-earned tip is NEVER refunded). dryRun counts
// what WOULD refund without moving money. Pattern L (narrowed to tipRefundId=null)
// keeps alerting on any R couldn't auto-execute (e.g. no charge).
async function patternR(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    const owed = await db.order.findMany({
      where: {
        status: OrderStatus.CANCELLED, tip: { gt: 0 },
        runnerEarning: { is: null }, tipRefundId: null, voidedAt: null,
      },
      select: { id: true },
      take: o.maxPerPattern,
    })
    for (const ord of owed) { sum.repaired.R++; sum.details.R.push(ord.id) }
    return
  }

  const res = await reconcileTipRefunds({ maxPerRun: o.maxPerPattern })
  sum.repaired.R += res.refunded
  for (const a of res.alerts) sum.alerted.push(`Pattern R: ${a}`)
}

// ─── PATTERN S — Missing VendorEarning accrual (C1 hardening) ─────────────────
// The recovery half of the completion-path vendor accrual.
//
// WHAT IT GUARDS. VendorEarning is accrued in reconcileMasterStatus at
// COMPLETED/DELIVERED. That write is fail-soft ON PURPOSE — it must never block an
// order completing or a vendor being paid. But when it fails, something real IS lost:
// the row is the admin's per-order HOLD TARGET and the money view's source, so a
// missed accrual silently costs the admin the ability to see or hold that payout for
// the whole refund window. The executor's defensive re-accrual eventually pays the
// vendor, but it materialises the row at payout time — i.e. exactly when holding it is
// no longer possible. Relying on that alone is what turns a failed write into silent
// capability loss.
//
// WHY IT REPAIRS RATHER THAN JUST ALERTS. Pattern L (the runner/organizer equivalent)
// only alerts, because reconstructing a runner's split after the fact is ambiguous.
// A vendor's claim is NOT ambiguous — it is Σ their OrderItem subtotals, available
// verbatim from the order. So this pattern re-accrues, restoring the in-window hold
// while the window is still open. Repairing beats alerting when the repair is exact.
//
// MONEY SAFETY. accrueVendorEarnings is an idempotent upsert on (orderId, vendorId)
// and NEVER touches `status`, so re-accruing cannot resurrect an admin-held or
// cancelled row, cannot double-accrue, and cannot un-pay a paid one. A repair here
// creates missing rows and nothing else.
//
// Any repair increments sum.repaired.S, which the sweep turns into a BACKSTOP WARNING
// — the loud signal that the real-time completion path is failing and needs a look.
async function patternS(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const orders = await db.order.findMany({
    where: {
      status: { in: COMPLETE_STATES },
      completedAt: { gte: o.windowStart },
      voidedAt: null,
    },
    select: {
      id: true,
      orderItems: { select: { vendorId: true } },
      vendorEarnings: { select: { vendorId: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
    },
    orderBy: { completedAt: 'asc' },
    take: o.maxPerPattern,
  })

  const { payableVendorIds } = await import('./process-payout')
  for (const ord of orders) {
    // ONE payable definition, shared with accrueVendorEarnings: a REFUNDED/DECLINED/
    // CANCELLED portion is owed NOTHING — counting it here made S write phantom
    // 'accrued' rows for refunded money (and would alert forever once accrual refused).
    const payable = payableVendorIds(ord.orderItems, ord.vendorOrderStatuses)
    const accrued = new Set(ord.vendorEarnings.map(e => e.vendorId))
    const missing = [...payable].filter(v => !accrued.has(v))
    if (missing.length === 0) continue

    sum.details.S.push(ord.id)
    sum.alerted.push(
      `Pattern S: order ${ord.id} completed with ${missing.length} vendor(s) having NO VendorEarning — ` +
      `in-window admin hold/visibility was lost for them (completion-path accrual failed). ` +
      `${o.dryRun ? 'WOULD re-accrue' : 'Re-accrued'}.`,
    )
    if (o.dryRun) { sum.repaired.S += 1; continue } // count consistently with A–C in dryRun

    try {
      const { accrueVendorEarnings } = await import('./process-payout')
      await accrueVendorEarnings(ord.id)
      sum.repaired.S += 1
    } catch (err) {
      sum.alerted.push(
        `Pattern S: order ${ord.id} RE-ACCRUAL FAILED — ${err instanceof Error ? err.message : String(err)}. ` +
        `Payout still safe (executor re-accrues at payout), but the in-window hold cannot be restored.`,
      )
    }
  }
}
