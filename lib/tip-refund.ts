/**
 * Tip-refund execution — Part B Phase B4 (the last piece). SHADOW-FIRST: this
 * file currently only PLANS (pure read). The executor (stripe.refunds.create) is
 * enabled after the shadow is reviewed.
 *
 * THE CASE (from reconciler Pattern L): a CANCELLED runner-fulfilled order with a
 * tip the customer paid, where NO runner ever earned it (no RunnerEarning). No one
 * did the work, so the tip belongs to no one → it is owed BACK to the customer.
 * This is money-OUT to the CUSTOMER (a refund), and NET-NEW — the per-vendor
 * refund engine refunds the vendor SUBTOTAL slice only and deliberately never
 * touches the tip, so executing an owed-back tip is a genuinely new refund path.
 *
 * THE POLICY BOUNDARY (the gate): the tip is owed back ONLY when NO RunnerEarning
 * exists for the order. If a RunnerEarning EXISTS, a runner did the work and the
 * tip is THEIRS — non-refundable, NEVER clawed back to the customer. The dangerous
 * failure mode here is the inverse of a double-pay: refunding a tip a runner
 * earned. planTipRefund partitions on exactly that discriminator.
 */

import { db } from './db'
import { stripe } from './stripe'
import { logger } from './logger'

export type TipRefundOutcome =
  | 'refund'                  // owed back: cancelled, tipped, NO runner earned it
  | 'excluded_runner_earned'  // a runner earned the tip → it's theirs, NEVER refund
  | 'already_refunded'        // tipRefundId set → idempotent skip
  | 'no_tip'                  // tip is 0/absent
  | 'not_terminal'            // not cancelled → not owed back yet

export interface TipRefundPlan {
  orderId: string
  outcome: TipRefundOutcome
  /** The tip the customer paid (cents) — what WOULD be refunded when owed back. */
  tipCents: number
  /** tipCents when outcome 'refund', else 0. */
  owedBackCents: number
  chargeId: string | null
  hasRunnerEarning: boolean
  alreadyRefunded: boolean
}

/**
 * Decide what a tip refund for this order WOULD do. Pure read — no writes, no
 * Stripe, no money moves. The owed-back amount is the order's tip VERBATIM (the
 * tip the customer paid — a given input, not a derived/accrued value).
 */
export async function planTipRefund(orderId: string): Promise<TipRefundPlan> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true, tip: true, stripeChargeId: true, tipRefundId: true,
      runnerEarning: { select: { id: true } },
    },
  })
  if (!order) throw new Error(`planTipRefund: order ${orderId} not found`)

  const tipCents = Math.round((order.tip ?? 0) * 100)
  const hasRunnerEarning = !!order.runnerEarning
  const alreadyRefunded = !!order.tipRefundId
  const base = {
    orderId: order.id,
    tipCents,
    chargeId: order.stripeChargeId ?? null,
    hasRunnerEarning,
    alreadyRefunded,
  }

  if (tipCents <= 0) return { ...base, outcome: 'no_tip', owedBackCents: 0 }
  if (alreadyRefunded) return { ...base, outcome: 'already_refunded', owedBackCents: 0 }
  // POLICY BOUNDARY — a runner earned this tip; it is theirs, never refunded.
  // Checked BEFORE the cancelled gate so a delivered/earned tip can never slip through.
  if (hasRunnerEarning) return { ...base, outcome: 'excluded_runner_earned', owedBackCents: 0 }
  if (order.status !== 'CANCELLED') return { ...base, outcome: 'not_terminal', owedBackCents: 0 }
  return { ...base, outcome: 'refund', owedBackCents: tipCents }
}

// ─── The executor (Part B B4 — MOVES MONEY: a refund to the CUSTOMER) ─────────

export interface TipRefundResult {
  orderId: string
  outcome: 'refunded' | 'excluded_runner_earned' | 'already_refunded' | 'no_tip' | 'not_terminal' | 'no_charge'
  amountCents?: number
  refundId?: string
}

/**
 * Refund an owed-back tip to the customer. Reads the decision from planTipRefund,
 * then acts only on 'refund'. The tip refunded is the order's tip VERBATIM.
 *
 * EXACTLY-ONCE: idempotencyKey `tip_refund_${orderId}`. Even if the marker write
 * is lost after a successful refund, a re-run sends the SAME key → Stripe returns
 * the original refund, never a second one (the crash-recovery guard).
 *
 * POLICY GATE re-checked AT EXECUTE (defense in depth, like the runner/organizer
 * payouts re-verify before transfer): a runner could earn the tip in the window
 * between plan and execute — if a RunnerEarning exists now, the tip is theirs and
 * is NEVER refunded to the customer.
 *
 * Halt-on-ambiguity: no resolvable charge → alert (return 'no_charge'), never refund.
 */
export async function processTipRefund(orderId: string): Promise<TipRefundResult> {
  const plan = await planTipRefund(orderId)
  if (plan.outcome === 'excluded_runner_earned') return { orderId, outcome: 'excluded_runner_earned' }
  if (plan.outcome === 'already_refunded')        return { orderId, outcome: 'already_refunded' }
  if (plan.outcome === 'no_tip')                  return { orderId, outcome: 'no_tip' }
  if (plan.outcome === 'not_terminal')            return { orderId, outcome: 'not_terminal' }

  // ── plan.outcome === 'refund' ───────────────────────────────────────────────
  // POLICY GATE (defense in depth): re-check at execute. The planner excluded
  // runner-earned tips, but a runner could have earned it since — never refund a
  // tip that became earned between plan and now.
  const earned = await db.runnerEarning.findUnique({ where: { orderId }, select: { id: true } })
  if (earned) {
    logger.warn('[TipRefund] runner earned the tip between plan and execute — NOT refunding', { orderId })
    return { orderId, outcome: 'excluded_runner_earned' }
  }

  // Resolve the charge the tip was captured on.
  let chargeId = plan.chargeId
  if (!chargeId) {
    const ord = await db.order.findUnique({ where: { id: orderId }, select: { stripePaymentIntentId: true } })
    if (ord?.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(ord.stripePaymentIntentId, { expand: ['latest_charge'] })
      const ch = pi.latest_charge
      if (ch && typeof ch === 'object' && 'id' in ch) chargeId = ch.id as string
    }
  }
  if (!chargeId) {
    // Halt-on-ambiguity: a cancelled-paid order should have a charge. If none is
    // resolvable, do NOT guess — alert (the reconciler surfaces it).
    logger.error('[TipRefund] no resolvable charge — alerting, not refunding', { orderId })
    return { orderId, outcome: 'no_charge' }
  }

  const tipCents = plan.tipCents
  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount: tipCents,
      metadata: { orderId, kind: 'tip_owed_back' },
    },
    { idempotencyKey: `tip_refund_${orderId}` },
  )

  // Record the refund on the order (the 1:1 record). Conditional on not-already-set
  // for concurrency safety.
  await db.order.updateMany({
    where: { id: orderId, tipRefundId: null },
    data: { tipRefundId: refund.id, tipRefundedAt: new Date() },
  })

  logger.money('[TipRefund] owed-back tip refunded to customer', { orderId, tipCents, refundId: refund.id })
  return { orderId, outcome: 'refunded', amountCents: tipCents, refundId: refund.id }
}

// ─── Reconciler: execute owed-back tips (the trigger; Pattern R delegates here) ─

export interface TipRefundReconcileSummary {
  scanned: number
  refunded: number
  excluded: number
  alerts: string[]
}

/**
 * Refund every owed-back tip: CANCELLED + tip>0 + NO RunnerEarning + not already
 * refunded. This is the trigger for B4 (the reconciler, via Pattern R) — there's
 * no per-order enqueue; an owed-back tip is refunded on the next sweep. Routes
 * through processTipRefund (idempotent) — never reimplements the refund.
 */
export async function reconcileTipRefunds(opts?: { maxPerRun?: number }): Promise<TipRefundReconcileSummary> {
  const max = opts?.maxPerRun ?? 200
  const owed = await db.order.findMany({
    where: {
      status: 'CANCELLED',
      tip: { gt: 0 },
      runnerEarning: { is: null },
      tipRefundId: null,
      voidedAt: null,
    },
    select: { id: true },
    take: max,
  })

  const summary: TipRefundReconcileSummary = { scanned: owed.length, refunded: 0, excluded: 0, alerts: [] }
  for (const o of owed) {
    try {
      const r = await processTipRefund(o.id)
      if (r.outcome === 'refunded') summary.refunded++
      else if (r.outcome === 'excluded_runner_earned') summary.excluded++
      else if (r.outcome === 'no_charge') summary.alerts.push(`tip refund for ${o.id}: no resolvable charge — manual review`)
    } catch (err) {
      summary.alerts.push(`tip refund failed for ${o.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return summary
}
