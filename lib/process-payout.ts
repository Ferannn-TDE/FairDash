/**
 * Per-vendor payout for separate charges & transfers.
 *
 * Runs at FULFILLMENT (order COMPLETED/DELIVERED), enqueued from the status
 * route. This is the SINGLE place transfer/fee math lives — placePaidOrder does
 * order creation only.
 *
 * Money model (locked):
 *   - Customer paid subtotal + 10% service fee.
 *   - FairSynq keeps the 10% CLEAN (Stripe fee does NOT touch it).
 *   - Vendors absorb the Stripe fee: each vendor gets subtotalSlice − feeShare,
 *     feeShare = proportional share of the REAL settled Stripe fee.
 *   - FairSynq's cut is the platform-balance remainder; it is never transferred.
 *
 * Correctness guarantees:
 *   - Fee read from the SETTLED balance_transaction (retry if not ready).
 *   - Integer-cent split that reconciles to the cent (lib/payout-split).
 *   - One idempotent transfer per (order, vendor) — retries never double-pay.
 *   - Reconciliation assertion BEFORE any transfer; on failure, halt (no money
 *     moves) and surface for manual review.
 *   - Unconnected / zero-or-negative vendors are HELD (logged, not paid); their
 *     slice stays in the platform balance and is still counted in the split so
 *     FairSynq's 10% stays exact.
 */

import { db } from './db'
import { stripe } from './stripe'
import { splitStripeFee } from './payout-split'
import { logger } from './logger'

/** Thrown when the money identity doesn't hold — payout is halted, no transfers. */
export class PayoutReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutReconciliationError'
  }
}

/** Thrown when the charge/fee isn't settled yet — caller should RETRY. */
export class PayoutNotSettledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutNotSettledError'
  }
}

export interface PayoutResult {
  orderId: string
  stripeFeeCents: number
  transfers: { vendorId: string; amountCents: number; transferId: string }[]
  held: { vendorId: string; sliceCents: number; reason: 'unconnected' | 'non_positive' }[]
  // Vendors who DECLINED — never paid, never held; their slice is the customer's
  // refund (handled by the decline/refund flow, not here).
  skippedDeclined: { vendorId: string; sliceCents: number }[]
}

export async function processOrderPayout(orderId: string): Promise<PayoutResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      eventId: true,
      subtotal: true,
      fairSynqFee: true,
      deliveryFee: true,
      serviceCharge: true,
      tip: true,
      total: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
    },
  })
  if (!order) throw new Error(`processOrderPayout: order ${orderId} not found`)

  // ── Resolve the charge id (needed for source_transaction + fee read) ──────
  let chargeId = order.stripeChargeId ?? null
  if (!chargeId && order.stripePaymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = pi.latest_charge
    if (charge && typeof charge === 'object' && 'id' in charge) {
      chargeId = charge.id as string
      await db.order.update({ where: { id: orderId }, data: { stripeChargeId: chargeId } }).catch(() => {})
    }
  }
  if (!chargeId) throw new PayoutNotSettledError(`order ${orderId}: no charge yet`)

  // ── Read the REAL settled Stripe fee from the balance transaction ─────────
  const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
  const bt = charge.balance_transaction
  if (!bt || typeof bt !== 'object' || bt.fee == null) {
    // Balance transaction lags after payment_intent.succeeded — retry, never guess.
    throw new PayoutNotSettledError(`order ${orderId}: balance transaction not settled yet`)
  }
  const stripeFeeCents = bt.fee
  const transferGroup = charge.transfer_group ?? `order_${orderId}`

  // ── Per-vendor subtotals (integer cents, from the DB — authoritative) ─────
  const vendorSubtotalsCents: Record<string, number> = {}
  for (const item of order.orderItems) {
    vendorSubtotalsCents[item.vendorId] =
      (vendorSubtotalsCents[item.vendorId] ?? 0) + Math.round(item.subtotal * 100)
  }
  const totalSubtotalCents = Object.values(vendorSubtotalsCents).reduce((s, c) => s + c, 0)

  const totalCents = Math.round(order.total * 100)
  const serviceFeeCents = Math.round(order.fairSynqFee * 100)
  const deliveryCents = Math.round((order.deliveryFee ?? 0) * 100)
  const serviceChargeCents = Math.round((order.serviceCharge ?? 0) * 100)
  // Tip: platform-held but OWED to the runner (a liability, NOT FairSynq revenue).
  // Part of the charge, so it MUST appear in both identity sides.
  const tipCents = Math.round((order.tip ?? 0) * 100)

  // ── Reconciliation 1: customer side (no money moved yet) ──────────────────
  const customerSide = totalSubtotalCents + serviceFeeCents + deliveryCents + serviceChargeCents + tipCents
  if (customerSide !== totalCents) {
    throw new PayoutReconciliationError(
      `order ${orderId}: customer-side mismatch — charge ${totalCents}¢ ≠ subtotal ${totalSubtotalCents} + serviceFee ${serviceFeeCents} + delivery ${deliveryCents} + serviceCharge ${serviceChargeCents} + tip ${tipCents}`,
    )
  }

  // ── Proportional fee split (Σ feeShare === stripeFee exactly) ─────────────
  const lines = splitStripeFee(vendorSubtotalsCents, stripeFeeCents)

  const vendorIds = lines.map(l => l.vendorId)
  const [vendors, statuses] = await Promise.all([
    db.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, stripeAccountId: true, stripeVerified: true },
    }),
    db.vendorOrderStatus.findMany({
      where: { orderId },
      select: { vendorId: true, status: true },
    }),
  ])
  const vendorMap = new Map(vendors.map(v => [v.id, v]))
  const statusMap = new Map(statuses.map(s => [s.vendorId, s.status]))

  // Decide outcome per vendor BEFORE moving any money.
  //   pay  — connected, completed, positive slice → transfer
  //   hold — completed but unconnected / non-positive → persist a PayoutHold
  //   skip — DECLINED → never paid, never held; their slice is the customer's
  //          refund, owned by the decline/refund flow (not here)
  const plan = lines.map(line => {
    const v = vendorMap.get(line.vendorId)
    const connected = !!(v?.stripeAccountId && v.stripeVerified)
    // DECLINED or REFUNDED → never pay. Their slice is the customer's refund,
    // owned by the decline/refund flow (lib/process-refund.ts), not here. This is
    // the defense-in-depth for a CASE 1 refund: a vendor refunded within the
    // window is marked REFUNDED, so when this DELAYED payout finally fires it
    // skips them and still pays every other vendor on the cart.
    const status = statusMap.get(line.vendorId)
    const declined = status === 'DECLINED' || status === 'REFUNDED'
    let outcome: 'pay' | 'hold' | 'skip'
    let heldReason: 'unconnected' | 'non_positive' | null = null
    if (declined) outcome = 'skip'
    else if (!connected) { outcome = 'hold'; heldReason = 'unconnected' }
    else if (line.transferCents <= 0) { outcome = 'hold'; heldReason = 'non_positive' }
    else outcome = 'pay'
    return { ...line, stripeAccountId: v?.stripeAccountId ?? null, outcome, heldReason }
  })

  const sentCents    = plan.filter(p => p.outcome === 'pay').reduce((s, p) => s + p.transferCents, 0)
  const heldCents    = plan.filter(p => p.outcome === 'hold').reduce((s, p) => s + p.transferCents, 0)
  const skippedCents = plan.filter(p => p.outcome === 'skip').reduce((s, p) => s + p.transferCents, 0)

  // ── Reconciliation 2: payout side ─────────────────────────────────────────
  //   Σ(sent) + Σ(held) + Σ(skipped/declined→refundable) + serviceFee
  //     + delivery + serviceCharge + tip + stripeFee === charge
  //   tip is platform-held-owed-to-runner (like delivery/serviceCharge: retained,
  //   not transferred in this phase). Runner/organizer payouts are Part B.
  const payoutSide = sentCents + heldCents + skippedCents + serviceFeeCents + deliveryCents + serviceChargeCents + tipCents + stripeFeeCents
  if (payoutSide !== totalCents) {
    throw new PayoutReconciliationError(
      `order ${orderId}: payout-side mismatch — ${payoutSide}¢ ≠ charge ${totalCents}¢ (sent ${sentCents}, held ${heldCents}, skipped ${skippedCents}, serviceFee ${serviceFeeCents}, delivery ${deliveryCents}, serviceCharge ${serviceChargeCents}, tip ${tipCents}, stripeFee ${stripeFeeCents})`,
    )
  }

  // ── Apply (idempotent per order+vendor) ───────────────────────────────────
  const result: PayoutResult = { orderId, stripeFeeCents, transfers: [], held: [], skippedDeclined: [] }

  for (const p of plan) {
    if (p.outcome === 'skip') {
      logger.warn('[Payout] vendor slice SKIPPED — declined (refund owned by decline flow)', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents,
      })
      result.skippedDeclined.push({ vendorId: p.vendorId, sliceCents: p.transferCents })
      continue
    }

    if (p.outcome === 'hold') {
      // Persist the hold so the reconciler can pay it once the vendor connects.
      await db.payoutHold.upsert({
        where: { orderId_vendorId: { orderId, vendorId: p.vendorId } },
        create: {
          eventId: order.eventId, orderId, vendorId: p.vendorId,
          amountCents: p.transferCents, reason: p.heldReason!, resolved: false,
        },
        update: { amountCents: p.transferCents, reason: p.heldReason! },
      })
      logger.warn('[Payout] vendor slice HELD (persisted, not transferred)', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.heldReason,
      })
      result.held.push({ vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.heldReason! })
      continue
    }

    const transfer = await stripe.transfers.create(
      {
        amount: p.transferCents,
        currency: 'usd',
        destination: p.stripeAccountId!,
        source_transaction: chargeId,
        transfer_group: transferGroup,
        metadata: { orderId, vendorId: p.vendorId },
      },
      { idempotencyKey: `payout_${orderId}_${p.vendorId}` },
    )

    // Record/refresh the payout row, keyed by the (idempotent) transfer id.
    await db.payout.upsert({
      where: { stripeTransferId: transfer.id },
      create: {
        eventId: order.eventId,
        orderId,                              // ← reconciliation link
        vendorId: p.vendorId,
        grossAmount: p.subtotalCents / 100,   // vendor's subtotal slice
        fairSynqFee: p.feeShareCents / 100,   // Stripe fee share withheld from this transfer
        netAmount: p.transferCents / 100,     // amount actually transferred
        stripeTransferId: transfer.id,
        stripeStatus: 'pending',
        processedAt: new Date(),
      },
      update: {},
    })

    // If this vendor had a prior hold (paid now after connecting), resolve it.
    await db.payoutHold.updateMany({
      where: { orderId, vendorId: p.vendorId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    })

    result.transfers.push({ vendorId: p.vendorId, amountCents: p.transferCents, transferId: transfer.id })
  }

  logger.info('[Payout] order paid out', {
    orderId,
    stripeFeeCents,
    transfers: result.transfers.length,
    held: result.held.length,
    skippedDeclined: result.skippedDeclined.length,
  })
  return result
}
