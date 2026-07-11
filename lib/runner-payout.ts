/**
 * Runner payout — Part B Phase B2.
 *
 * PAYS THE LEDGER. The amount transferred to a runner is RunnerEarning.amountCents
 * VERBATIM (runnerShare + tip, proven correct to the cent in Part A). This module
 * NEVER recomputes the payout amount from order fields — that would be a second
 * source of truth. The only recompute that exists here is an INDEPENDENT CHECK
 * (planRunnerPayout returns it) used by the shadow sweep to prove the stored
 * ledger has not drifted from Part A's formula — it is never what gets paid.
 *
 * SHADOW-FIRST: this file currently only PLANS (pure read, no writes, no Stripe
 * transfers). The real transfer (transfers.create + status→paid + Payout record)
 * is enabled after the shadow sweep is reviewed. There is deliberately no
 * transfers.create in this module yet.
 *
 * Money model (locked):
 *   - The delivery/curbside fee + tip were charged to the customer and RETAINED
 *     in the platform balance during the vendor payout (process-payout.ts keeps
 *     deliveryCents + tipCents). B2 moves the runner's accrued slice out of that
 *     balance to the runner — no new Stripe fee (already absorbed by vendors).
 *   - Hold-if-unconnected = the unpaid ledger row itself. An unconnected runner's
 *     earning stays status='tracked'; the reconciler pays it when they connect.
 *     There is NO separate hold table for runners (unlike vendors).
 */

import { db } from './db'
import { stripe } from './stripe'
import { splitRunnerFee } from './payout-split'
import { PayoutNotSettledError, PayoutReconciliationError } from './process-payout'
import { REFUND_WINDOW_MS } from './constants'
import { logger } from './logger'

export type RunnerPayoutOutcome = 'pay' | 'hold' | 'blocked' | 'already_paid' | 'no_earning'
export type RunnerHoldReason = 'unconnected' | 'non_positive'
/**
 * C1 — why the ADMIN GATE refused. Distinct from a hold: a hold is "can't pay yet"
 * (the reconciler will retry and eventually pay); a block is "admin says no" and
 * only an admin can lift it. reconcileRunnerPayouts filters status:'tracked', so
 * held/cancelled rows are excluded there too — but this gate is the AUTHORITATIVE
 * one, because every path to transfers.create passes through processRunnerPayout.
 */
export type RunnerBlockReason = 'admin_hold' | 'admin_cancelled' | 'payouts_frozen'

export interface RunnerPayoutDecision {
  orderId: string
  eventId: string | null
  runnerId: string | null
  outcome: RunnerPayoutOutcome
  holdReason: RunnerHoldReason | null
  /** C1 — set only when outcome === 'blocked'. */
  blockReason: RunnerBlockReason | null
  /** What we WOULD transfer — RunnerEarning.amountCents verbatim. null if no earning. */
  ledgerAmountCents: number | null
  /** Independent recompute (runnerShare + tip) — a DRIFT CHECK only, never paid. */
  recomputeCents: number | null
  /** ledgerAmountCents === recomputeCents. null when there's no earning to check. */
  ledgerMatchesRecompute: boolean | null
  /** Runner has a verified Connect account (DB mirror, same flag vendors use). */
  connected: boolean
  /** The charge the fee/tip sits on — source_transaction for the real transfer. */
  chargeId: string | null
  /** earning.status ('tracked' | 'paid'); null if no earning. */
  earningStatus: string | null
  /** When the earning accrued (on DELIVERED) — the refund-window clock start. */
  accruedAt: Date | null
}

/**
 * Decide what a runner payout for this order WOULD do. Pure read — no writes, no
 * Stripe calls, no money moves. Returns the full decision for the shadow sweep
 * and (later) the real executor to act on.
 */
export async function planRunnerPayout(orderId: string): Promise<RunnerPayoutDecision> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      eventId: true,
      deliveryFee: true,
      tip: true,
      stripeChargeId: true,
      runnerEarning: {
        select: { runnerId: true, amountCents: true, status: true, createdAt: true },
      },
      event: { select: { fulfillmentConfig: { select: { runnerFeePercent: true } } } },
    },
  })
  if (!order) throw new Error(`planRunnerPayout: order ${orderId} not found`)

  const earning = order.runnerEarning
  const base = {
    orderId: order.id,
    eventId: order.eventId,
    chargeId: order.stripeChargeId ?? null,
  }

  if (!earning) {
    return {
      ...base, runnerId: null, outcome: 'no_earning', holdReason: null, blockReason: null,
      ledgerAmountCents: null, recomputeCents: null, ledgerMatchesRecompute: null,
      connected: false, earningStatus: null, accruedAt: null,
    }
  }

  // Independent recompute — DRIFT CHECK ONLY. This is NOT what gets paid; it
  // proves the stored ledger still equals Part A's formula (runnerShare + tip).
  const feeCents = Math.round((order.deliveryFee ?? 0) * 100)
  const tipCents = Math.round((order.tip ?? 0) * 100)
  const pct = order.event?.fulfillmentConfig?.runnerFeePercent ?? 0
  const { runnerShareCents } = splitRunnerFee(feeCents, pct)
  const recomputeCents = runnerShareCents + tipCents

  // The runner (Connect status via DB mirror — same flag vendors use).
  // C1: payoutsFrozenAt — the runner-wide admin kill-switch.
  const runner = await db.runner.findUnique({
    where: { id: earning.runnerId },
    select: { stripeAccountId: true, stripeVerified: true, payoutsFrozenAt: true },
  })
  const connected = !!(runner?.stripeAccountId && runner.stripeVerified)

  const ledgerAmountCents = earning.amountCents
  const common = {
    ...base,
    runnerId: earning.runnerId,
    ledgerAmountCents,
    recomputeCents,
    ledgerMatchesRecompute: ledgerAmountCents === recomputeCents,
    connected,
    earningStatus: earning.status,
    accruedAt: earning.createdAt,
    blockReason: null as RunnerBlockReason | null,
  }

  // Idempotency front line: a paid row is never touched again.
  if (earning.status === 'paid') {
    return { ...common, outcome: 'already_paid', holdReason: null }
  }
  // ── C1 ADMIN GATE — checked BEFORE connectivity, so an admin can hold a runner
  // who isn't connected yet (otherwise the hold would be invisible until they
  // onboarded, and then race the pay-on-connect reconciler).
  if (earning.status === 'cancelled') {
    return { ...common, outcome: 'blocked', holdReason: null, blockReason: 'admin_cancelled' }
  }
  if (earning.status === 'held') {
    return { ...common, outcome: 'blocked', holdReason: null, blockReason: 'admin_hold' }
  }
  if (runner?.payoutsFrozenAt) {
    return { ...common, outcome: 'blocked', holdReason: null, blockReason: 'payouts_frozen' }
  }
  // ── end gate ──────────────────────────────────────────────────────────────────
  // Hold-if-unconnected: leave the ledger row as the hold; reconciler pays on connect.
  if (!connected) {
    return { ...common, outcome: 'hold', holdReason: 'unconnected' }
  }
  // Defensive: a zero/negative earning is held, never a $0 transfer.
  if (ledgerAmountCents <= 0) {
    return { ...common, outcome: 'hold', holdReason: 'non_positive' }
  }
  return { ...common, outcome: 'pay', holdReason: null }
}

// ─── The executor (Part B B2 — MOVES MONEY) ──────────────────────────────────

export interface RunnerPayoutResult {
  orderId: string
  outcome: 'paid' | 'held' | 'blocked' | 'already_paid' | 'no_earning'
  amountCents?: number
  transferId?: string
  reason?: string
}

/**
 * Pay a runner their accrued earning for one delivered order. Reads the decision
 * from planRunnerPayout (proven read), then acts:
 *   - already_paid → skip BEFORE Stripe (idempotency short-circuit)
 *   - hold         → no transfer, status stays 'tracked' (the ledger IS the hold)
 *   - pay          → one idempotent transfer of amountCents VERBATIM, then mark
 *                    the ledger row paid + stamp the transfer id (the record)
 *
 * EXACTLY-ONCE: idempotencyKey `runner_payout_${orderId}`. Even if the status
 * write is lost after a successful transfer, a re-run sends the SAME key — Stripe
 * returns the original transfer, never a second one. A double-paid runner is real
 * money lost; this is the guard.
 *
 * Error discipline (reused from the vendor payout, exactly):
 *   - PayoutReconciliationError → ledger drifted from Part A's formula → HALT
 *     (caller maps to UnrecoverableError; no money moves on ambiguity).
 *   - PayoutNotSettledError     → no charge yet → caller RETRIES.
 */
export async function processRunnerPayout(orderId: string): Promise<RunnerPayoutResult> {
  const plan = await planRunnerPayout(orderId)

  if (plan.outcome === 'no_earning') return { orderId, outcome: 'no_earning' }

  if (plan.outcome === 'already_paid') {
    // Short-circuit BEFORE Stripe — the first idempotency guard.
    logger.info('[RunnerPayout] already paid — skip (no Stripe call)', { orderId })
    return { orderId, outcome: 'already_paid' }
  }

  if (plan.outcome === 'blocked') {
    // C1 ADMIN GATE — no transfer. The ledger row (status held/cancelled) or the
    // runner's freeze flag holds the money in the platform balance. Only an admin
    // lifts this; no reconciler sweep can pay it.
    logger.warn('[RunnerPayout] BLOCKED by admin gate — no transfer', {
      orderId, runnerId: plan.runnerId, reason: plan.blockReason, amountCents: plan.ledgerAmountCents,
    })
    return { orderId, outcome: 'blocked', reason: plan.blockReason ?? 'blocked', amountCents: plan.ledgerAmountCents ?? 0 }
  }

  if (plan.outcome === 'hold') {
    // The unpaid ledger row IS the hold — leave status 'tracked', pay on connect.
    logger.warn('[RunnerPayout] HELD (ledger row is the hold)', {
      orderId, runnerId: plan.runnerId, reason: plan.holdReason, amountCents: plan.ledgerAmountCents,
    })
    return { orderId, outcome: 'held', reason: plan.holdReason ?? 'hold', amountCents: plan.ledgerAmountCents ?? 0 }
  }

  // ── outcome === 'pay' ────────────────────────────────────────────────────────
  const amountCents = plan.ledgerAmountCents as number

  // RECONCILIATION GUARD — the ledger must still equal Part A's formula. A drift
  // is ambiguity: HALT, move no money, surface for review (never guess an amount).
  if (plan.ledgerMatchesRecompute === false) {
    throw new PayoutReconciliationError(
      `order ${orderId}: RunnerEarning ${amountCents}¢ ≠ recompute ${plan.recomputeCents}¢ — ledger drift, halting (no money moves)`,
    )
  }

  // Resolve the charge for source_transaction (the fee/tip sits on it).
  let chargeId = plan.chargeId
  if (!chargeId) {
    const ord = await db.order.findUnique({ where: { id: orderId }, select: { stripePaymentIntentId: true } })
    if (ord?.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(ord.stripePaymentIntentId, { expand: ['latest_charge'] })
      const ch = pi.latest_charge
      if (ch && typeof ch === 'object' && 'id' in ch) chargeId = ch.id as string
    }
  }
  if (!chargeId) throw new PayoutNotSettledError(`order ${orderId}: no charge yet for runner payout`)

  // Re-read the destination at execute time (connection could have dropped since
  // plan). If gone → hold, never error.
  const runner = await db.runner.findUnique({
    where: { id: plan.runnerId as string },
    select: { stripeAccountId: true, stripeVerified: true, payoutsFrozenAt: true },
  })

  // C1 — re-check the gate at EXECUTE time. An admin freeze/hold landing between
  // plan and transfer must still win; otherwise a long-running job could pay money
  // the admin froze seconds earlier. Cheap read, closes the race.
  if (runner?.payoutsFrozenAt) {
    logger.warn('[RunnerPayout] runner FROZEN at execute — no transfer', { orderId, runnerId: plan.runnerId })
    return { orderId, outcome: 'blocked', reason: 'payouts_frozen', amountCents }
  }
  const fresh = await db.runnerEarning.findUnique({ where: { orderId }, select: { status: true } })
  if (fresh?.status === 'held' || fresh?.status === 'cancelled') {
    logger.warn('[RunnerPayout] earning held/cancelled at execute — no transfer', {
      orderId, runnerId: plan.runnerId, status: fresh.status,
    })
    return {
      orderId, outcome: 'blocked', amountCents,
      reason: fresh.status === 'cancelled' ? 'admin_cancelled' : 'admin_hold',
    }
  }

  if (!(runner?.stripeAccountId && runner.stripeVerified)) {
    logger.warn('[RunnerPayout] runner unconnected at execute — holding', { orderId, runnerId: plan.runnerId })
    return { orderId, outcome: 'held', reason: 'unconnected', amountCents }
  }

  // Pay the ledger VERBATIM. Exactly-once via the idempotency key.
  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: 'usd',
      destination: runner.stripeAccountId,
      source_transaction: chargeId,
      transfer_group: `order_${orderId}`,
      metadata: { orderId, runnerId: plan.runnerId as string, kind: 'runner_payout' },
    },
    { idempotencyKey: `runner_payout_${orderId}` },
  )

  // The ledger row IS the payout record: mark paid + stamp the transfer id.
  // Conditional on not-already-paid for concurrency safety.
  await db.runnerEarning.updateMany({
    where: { orderId, status: { not: 'paid' } },
    data: { status: 'paid', stripeTransferId: transfer.id, paidAt: new Date() },
  })

  logger.info('[RunnerPayout] paid', { orderId, runnerId: plan.runnerId, amountCents, transferId: transfer.id })
  return { orderId, outcome: 'paid', amountCents, transferId: transfer.id }
}

// ─── Reconciler: pay-when-connected + window backstop (mirror vendor C/D) ─────

export interface RunnerReconcileSummary {
  scanned: number
  paid: number
  held: number
  blocked: number
  alreadyPaid: number
  alerts: string[]
}

/**
 * Pays every eligible runner earning: status='tracked', runner connected, refund
 * window closed, order live. This is BOTH the post-window backstop (a DELIVERED
 * enqueue that dropped) AND the pay-when-a-held-runner-connects mechanism (an
 * unconnected runner's earning held in the ledger, paid here once they onboard).
 * Routes through processRunnerPayout (idempotent) — never reimplements payout.
 */
export async function reconcileRunnerPayouts(opts?: { maxPerRun?: number }): Promise<RunnerReconcileSummary> {
  const max = opts?.maxPerRun ?? 200
  const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)

  const eligible = await db.runnerEarning.findMany({
    where: {
      status: 'tracked', // C1: 'held'/'cancelled' are excluded here by construction —
                         // but processRunnerPayout's gate is the authoritative stop.
      createdAt: { lt: windowClosedBefore }, // window CLOSED — never pay in-window
      order: { voidedAt: null },
      runner: { stripeVerified: true, stripeAccountId: { not: null }, payoutsFrozenAt: null },
    },
    select: { orderId: true },
    take: max,
  })

  const summary: RunnerReconcileSummary = { scanned: eligible.length, paid: 0, held: 0, blocked: 0, alreadyPaid: 0, alerts: [] }
  for (const e of eligible) {
    try {
      const r = await processRunnerPayout(e.orderId)
      if (r.outcome === 'paid') summary.paid++
      else if (r.outcome === 'held') summary.held++
      else if (r.outcome === 'blocked') summary.blocked++
      else if (r.outcome === 'already_paid') summary.alreadyPaid++
    } catch (err) {
      summary.alerts.push(`runner payout failed for ${e.orderId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Integrity assertion: paid ⟺ has a transfer id. A paid row without one is a
  // record-less payout (leak) — surface, never silently absorb.
  const paidNoRecord = await db.runnerEarning.count({ where: { status: 'paid', stripeTransferId: null } })
  if (paidNoRecord > 0) {
    summary.alerts.push(`${paidNoRecord} RunnerEarning marked paid but NO transfer id — record-less payout, investigate`)
  }
  return summary
}
