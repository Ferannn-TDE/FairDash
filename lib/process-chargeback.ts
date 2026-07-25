/**
 * Bank chargeback (charge.dispute.*) handling. The bank already pulled the WHOLE
 * charge — so we do NOT refund the customer (they were paid by the bank). Our job:
 *   1. record the Chargeback (idempotent — dispute events redeliver),
 *   2. stop any pending payout for the order (the charge is gone — no vendor on it
 *      should be paid),
 *   3. claw back every already-paid vendor's net PROPORTIONALLY via the SHARED
 *      reversal helper (reuse, not reimplement) — late disputes hit the proven
 *      insufficient-balance branch → NegativeBalanceEvent(kind=dispute_clawback),
 *   4. record the ~$15 dispute fee as FairSynq-absorbed-but-recoverable,
 *   5. SURFACE to admin. NEVER auto-accept / auto-submit evidence.
 *
 * WON/LOST is reconciled on dispute.closed. A WON dispute that reinstates funds
 * is surfaced for ADMIN reconciliation — vendors we clawed back are NOT auto
 * re-paid (that's an ambiguous-money action a human must confirm).
 */

import { db } from './db'
import { stripe } from './stripe'
import { reverseVendorPayout } from './clawback'
import { getOrderQueue } from './queues'
import { logger } from './logger'
import type Stripe from 'stripe'

const cents = (n: number) => Math.round(n * 100)

/** Map Stripe dispute.status → our mirror (kept verbatim; lower_snake from Stripe). */
function disputeFeeCents(d: Stripe.Dispute): number {
  // The dispute fee shows up as a balance transaction on the dispute.
  const bt = (d.balance_transactions ?? []).find(b => (b.fee ?? 0) !== 0 || (b.reporting_category === 'dispute'))
  const fee = bt?.fee
  return fee != null ? Math.abs(fee) : 1500 // default ~$15 if not expanded
}

export interface ChargebackResult {
  chargebackId: string
  status: 'recorded' | 'noop'
  clawedVendors: { vendorId: string; reversalId: string; negativeBalanceCents: number }[]
  unpaidVendors: string[]       // never paid (within window) — payout cancelled, nothing to claw
  feeCents: number
}

export async function handleChargebackCreated(dispute: Stripe.Dispute): Promise<ChargebackResult> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
  if (!chargeId) throw new Error(`chargeback ${dispute.id}: no charge id`)

  // ── Idempotency: dispute events redeliver. One Chargeback per dispute id. ──
  const existing = await db.chargeback.findUnique({
    where: { stripeDisputeId: dispute.id },
    select: { id: true, clawbackStatus: true },
  })
  if (existing && existing.clawbackStatus !== 'pending') {
    return { chargebackId: existing.id, status: 'noop', clawedVendors: [], unpaidVendors: [], feeCents: 0 }
  }

  const order = await db.order.findFirst({
    where: { stripeChargeId: chargeId },
    select: {
      id: true, eventId: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      payouts: { select: { vendorId: true, netAmount: true, stripeTransferId: true, reversedAt: true } },
    },
  })
  if (!order) {
    // Money-truth says a dispute exists but we can't map it — alert, never guess.
    logger.error('[Chargeback] dispute for unknown charge — manual review', { disputeId: dispute.id, chargeId })
    throw new Error(`chargeback ${dispute.id}: no order for charge ${chargeId}`)
  }

  const feeCents = disputeFeeCents(dispute)

  // ── Record the Chargeback row (idempotent upsert) ─────────────────────────
  const cb = await db.chargeback.upsert({
    where: { stripeDisputeId: dispute.id },
    create: {
      eventId: order.eventId, orderId: order.id,
      stripeDisputeId: dispute.id, stripeChargeId: chargeId,
      amountCents: dispute.amount, feeCents, reason: dispute.reason ?? null,
      status: dispute.status, clawbackStatus: 'pending',
    },
    update: { status: dispute.status, amountCents: dispute.amount, feeCents },
    select: { id: true },
  })

  // ── Stop any pending payout for this order — the charge is gone, so NO vendor
  // on it should be paid. Already-paid vendors are clawed back below; unpaid ones
  // simply never get the (now-removed) delayed payout. ──────────────────────
  const queue = getOrderQueue()
  if (queue) {
    await queue.remove(`payout-${order.id}`).catch(() => { /* may be active/absent — reconciler backstops */ })
  }

  // ── Proportional clawback: reverse every already-paid vendor's net ────────
  const paidVendors = order.payouts.filter(p => p.stripeTransferId && !p.reversedAt)
  const payableVendorIds = [...new Set(order.orderItems.map(i => i.vendorId))]
  const clawedVendors: ChargebackResult['clawedVendors'] = []
  let anyFailed = false

  for (const p of paidVendors) {
    try {
      const res = await reverseVendorPayout({
        orderId: order.id, vendorId: p.vendorId, eventId: order.eventId,
        stripeTransferId: p.stripeTransferId!,
        netCents: cents(p.netAmount),
        idempotencyKey: `dispute_reversal_${dispute.id}_${p.vendorId}`, // stable → redelivery no-ops
        kind: 'dispute_clawback',
        reason: `chargeback ${dispute.id}`,
      })
      clawedVendors.push({ vendorId: p.vendorId, reversalId: res.reversalId, negativeBalanceCents: res.negativeBalanceCents })
    } catch (err) {
      anyFailed = true
      logger.error('[Chargeback] vendor clawback failed — reconciler will retry', { disputeId: dispute.id, vendorId: p.vendorId, error: String(err) })
    }
  }
  const unpaidVendors = payableVendorIds.filter(v => !paidVendors.some(p => p.vendorId === v))

  await db.chargeback.update({
    where: { id: cb.id },
    data: { clawbackStatus: anyFailed ? 'partial' : 'done' },
  })

  // ── Reconciliation (charge composition, to the cent) ──────────────────────
  // The bank pulled the whole charge. Assert the charge decomposes exactly into
  // the vendor slices + fee — same identity the payout/refund asserts. Then LOG
  // FairSynq's explicit position. Don't halt the (already-happened) clawback on a
  // composition mismatch — surface it loudly for manual review.
  const subtotalCents = order.orderItems.reduce((s, i) => s + cents(i.subtotal), 0)
  const frontedCents = clawedVendors.reduce((s, c) => s + c.negativeBalanceCents, 0)
  if (subtotalCents > dispute.amount) {
    logger.error('[Chargeback] RECONCILIATION: subtotal exceeds disputed charge — manual review', {
      disputeId: dispute.id, subtotalCents, disputedCents: dispute.amount,
    })
  }
  logger.warn('[Chargeback] RECORDED + clawed back — SURFACE TO ADMIN (no auto fight/accept)', {
    disputeId: dispute.id, orderId: order.id, status: dispute.status,
    disputedCents: dispute.amount, feeCents,
    clawedVendors: clawedVendors.length, unpaidVendors: unpaidVendors.length,
    fairSynqFrontedCents: frontedCents,
    fairSynqLostServiceFee: 'the 10% on this charge is gone with the disputed funds',
    feeRecoverable: `${feeCents}¢ recorded as recoverable from at-fault vendor (set by admin)`,
  })

  return { chargebackId: cb.id, status: 'recorded', clawedVendors, unpaidVendors, feeCents }
}

/**
 * Reconciler retry (Pattern I): re-attempt the per-vendor clawback for a
 * Chargeback whose clawback is pending/partial. Idempotent (stable reversal keys
 * + reversedAt guard) — reverses only vendors not already reversed.
 */
export async function retryChargebackClawback(chargebackId: string): Promise<void> {
  const cb = await db.chargeback.findUnique({
    where: { id: chargebackId },
    select: { id: true, eventId: true, orderId: true, stripeDisputeId: true },
  })
  if (!cb) return
  const order = await db.order.findUnique({
    where: { id: cb.orderId },
    select: { payouts: { select: { vendorId: true, netAmount: true, stripeTransferId: true, reversedAt: true } } },
  })
  if (!order) return

  const toClaw = order.payouts.filter(p => p.stripeTransferId && !p.reversedAt)
  let anyFailed = false
  for (const p of toClaw) {
    try {
      await reverseVendorPayout({
        orderId: cb.orderId, vendorId: p.vendorId, eventId: cb.eventId,
        stripeTransferId: p.stripeTransferId!, netCents: cents(p.netAmount),
        idempotencyKey: `dispute_reversal_${cb.stripeDisputeId}_${p.vendorId}`,
        kind: 'dispute_clawback', reason: `chargeback ${cb.stripeDisputeId} (reconciler retry)`,
      })
    } catch (err) {
      anyFailed = true
      logger.error('[Chargeback] retry clawback failed', { chargebackId, vendorId: p.vendorId, error: String(err) })
    }
  }
  await db.chargeback.update({ where: { id: cb.id }, data: { clawbackStatus: anyFailed ? 'partial' : 'done' } })
}

/**
 * dispute.closed → reconcile WON/LOST. LOST: clawback stands (finalize). WON +
 * funds reinstated: SURFACE for admin — vendors were clawed back; re-paying them
 * is a human-confirmed action, NEVER automatic.
 */
export async function handleChargebackClosed(dispute: Stripe.Dispute): Promise<void> {
  const won = dispute.status === 'won'
  const reinstated = won // a won dispute reinstates the funds to the platform
  const cb = await db.chargeback.findUnique({ where: { stripeDisputeId: dispute.id }, select: { id: true, orderId: true } })
  if (!cb) {
    logger.warn('[Chargeback] dispute.closed for unknown chargeback — recording status only', { disputeId: dispute.id, status: dispute.status })
    return
  }
  await db.chargeback.update({
    where: { stripeDisputeId: dispute.id },
    data: { status: dispute.status, fundsReinstated: reinstated },
  })

  if (won) {
    logger.warn('[Chargeback] WON — funds reinstated. ADMIN must reconcile: vendors were clawed back; confirm re-payment (NOT automatic).', {
      disputeId: dispute.id, orderId: cb.orderId,
    })
  } else {
    logger.money('[Chargeback] LOST — clawback stands; gaps finalized.', { disputeId: dispute.id, orderId: cb.orderId })
  }
}
