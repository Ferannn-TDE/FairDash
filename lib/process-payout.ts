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
 *
 * C1 — ADMIN GATE. This executor is the ONE place a vendor transfer can happen, so
 * it is where admin control is enforced. Every path that can pay a vendor (the
 * delayed job, the inline fallback, reconciler patterns B and D) funnels through
 * here, which means no enqueue path can route around an admin hold. The gate reads
 * VendorEarning.status ('held'/'cancelled') and Vendor.payoutsFrozenAt and produces
 * outcome 'blocked' — distinct from 'hold', because a blocked slice must NOT get a
 * PayoutHold row (that table means "waiting to be paid once the vendor connects",
 * and reconciler Pattern D exists to DRAIN it — writing an admin hold there would
 * make the reconciler pay it out on the next sweep).
 */

import { db } from './db'
import { stripe } from './stripe'
import { splitStripeFee } from './payout-split'
import { logger } from './logger'

/** Why the admin gate refused to pay a slice. Never gets a PayoutHold row. */
export type PayoutBlockReason = 'admin_hold' | 'admin_cancelled' | 'payouts_frozen'

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
  // C1 — slices the ADMIN GATE refused (held / cancelled / frozen). No transfer, no
  // PayoutHold row; the money stays in the platform balance under admin control.
  blocked: { vendorId: string; sliceCents: number; reason: PayoutBlockReason }[]
}

/**
 * C1 — accrue the vendor's HELD CLAIM on an order (the hold anchor).
 *
 * Runners and organizers accrue an earnings row the moment they earn; vendors did
 * not, so there was no row for an admin to hold between checkout and payout. This
 * creates it. Idempotent (upsert on orderId+vendorId), so it is safe to call from
 * the completion side-effect AND defensively from the executor (self-heals orders
 * that predate this table, and any accrual that got dropped).
 *
 * subtotalCents is the vendor's claim BEFORE the Stripe fee share, which is not
 * knowable until settlement. It is deliberately NOT what gets paid — the executor
 * still computes the authoritative net from the real settled fee and stamps it back.
 * Never overwrites a paid/held/cancelled row's status.
 */
export async function accrueVendorEarnings(orderId: string): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, eventId: true, orderItems: { select: { vendorId: true, subtotal: true } } },
  })
  if (!order) return 0

  const subtotals: Record<string, number> = {}
  for (const item of order.orderItems) {
    subtotals[item.vendorId] = (subtotals[item.vendorId] ?? 0) + Math.round(item.subtotal * 100)
  }

  let accrued = 0
  for (const [vendorId, subtotalCents] of Object.entries(subtotals)) {
    await db.vendorEarning.upsert({
      where: { orderId_vendorId: { orderId, vendorId } },
      create: { eventId: order.eventId, orderId, vendorId, subtotalCents, status: 'accrued' },
      // Refresh the claim amount only. status is NOT touched — an admin hold, a
      // cancel, or a completed payout must survive re-accrual.
      update: { subtotalCents },
    })
    accrued++
  }
  return accrued
}

export async function processOrderPayout(orderId: string): Promise<PayoutResult> {
  // C1 — make sure the hold anchor exists before we decide anything. Self-healing:
  // legacy orders (pre-VendorEarning) get their rows here, so the admin gate below
  // is never silently skipped for want of a row.
  await accrueVendorEarnings(orderId)

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
  const [vendors, statuses, earnings] = await Promise.all([
    db.vendor.findMany({
      where: { id: { in: vendorIds } },
      // C1: payoutsFrozenAt — the vendor-wide admin kill-switch.
      select: { id: true, stripeAccountId: true, stripeVerified: true, payoutsFrozenAt: true },
    }),
    db.vendorOrderStatus.findMany({
      where: { orderId },
      select: { vendorId: true, status: true },
    }),
    // C1: the hold anchor — accrued above, so a row exists for every payable vendor.
    db.vendorEarning.findMany({
      where: { orderId },
      select: { id: true, vendorId: true, status: true },
    }),
  ])
  const vendorMap = new Map(vendors.map(v => [v.id, v]))
  const statusMap = new Map(statuses.map(s => [s.vendorId, s.status]))
  const earningMap = new Map(earnings.map(e => [e.vendorId, e]))

  // Decide outcome per vendor BEFORE moving any money.
  //   pay     — connected, completed, positive slice → transfer
  //   hold    — completed but unconnected / non-positive → persist a PayoutHold
  //             (a WAITING ROOM: reconciler Pattern D drains it when they connect)
  //   skip    — DECLINED/REFUNDED → never paid, never held; their slice is the
  //             customer's refund, owned by the decline/refund flow (not here)
  //   blocked — C1 ADMIN GATE: held / cancelled / frozen. No transfer AND no
  //             PayoutHold row — a blocked slice must never land in the waiting
  //             room, or Pattern D would pay it out on the next sweep.
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
    const earning = earningMap.get(line.vendorId)

    let outcome: 'pay' | 'hold' | 'skip' | 'blocked'
    let heldReason: 'unconnected' | 'non_positive' | null = null
    let blockedReason: PayoutBlockReason | null = null

    // Customer's money first — a refunded/declined slice is never the vendor's to
    // hold or block; it already belongs back to the customer.
    if (declined) outcome = 'skip'
    // ── C1 ADMIN GATE ────────────────────────────────────────────────────────
    else if (earning?.status === 'cancelled') { outcome = 'blocked'; blockedReason = 'admin_cancelled' }
    else if (earning?.status === 'held')      { outcome = 'blocked'; blockedReason = 'admin_hold' }
    else if (v?.payoutsFrozenAt)              { outcome = 'blocked'; blockedReason = 'payouts_frozen' }
    // ── end gate ─────────────────────────────────────────────────────────────
    else if (!connected) { outcome = 'hold'; heldReason = 'unconnected' }
    else if (line.transferCents <= 0) { outcome = 'hold'; heldReason = 'non_positive' }
    else outcome = 'pay'

    return {
      ...line,
      stripeAccountId: v?.stripeAccountId ?? null,
      earningId: earning?.id ?? null,
      outcome,
      heldReason,
      blockedReason,
    }
  })

  const sentCents    = plan.filter(p => p.outcome === 'pay').reduce((s, p) => s + p.transferCents, 0)
  const heldCents    = plan.filter(p => p.outcome === 'hold').reduce((s, p) => s + p.transferCents, 0)
  const skippedCents = plan.filter(p => p.outcome === 'skip').reduce((s, p) => s + p.transferCents, 0)
  const blockedCents = plan.filter(p => p.outcome === 'blocked').reduce((s, p) => s + p.transferCents, 0)

  // ── Reconciliation 2: payout side ─────────────────────────────────────────
  //   Σ(sent) + Σ(held) + Σ(blocked) + Σ(skipped/declined→refundable) + serviceFee
  //     + delivery + serviceCharge + tip + stripeFee === charge
  //   tip is platform-held-owed-to-runner (like delivery/serviceCharge: retained,
  //   not transferred in this phase). Runner/organizer payouts are Part B.
  //   blocked is retained in the platform balance under admin control — it MUST be
  //   in the identity, or an admin hold would look like money that vanished.
  const payoutSide = sentCents + heldCents + blockedCents + skippedCents + serviceFeeCents + deliveryCents + serviceChargeCents + tipCents + stripeFeeCents
  if (payoutSide !== totalCents) {
    throw new PayoutReconciliationError(
      `order ${orderId}: payout-side mismatch — ${payoutSide}¢ ≠ charge ${totalCents}¢ (sent ${sentCents}, held ${heldCents}, blocked ${blockedCents}, skipped ${skippedCents}, serviceFee ${serviceFeeCents}, delivery ${deliveryCents}, serviceCharge ${serviceChargeCents}, tip ${tipCents}, stripeFee ${stripeFeeCents})`,
    )
  }

  // ── Apply (idempotent per order+vendor) ───────────────────────────────────
  const result: PayoutResult = { orderId, stripeFeeCents, transfers: [], held: [], skippedDeclined: [], blocked: [] }

  for (const p of plan) {
    if (p.outcome === 'blocked') {
      // NO transfer, NO PayoutHold row. The VendorEarning row (status held/cancelled)
      // or the vendor's freeze flag IS the hold; the money stays in the platform
      // balance where the admin can release or cancel it.
      logger.warn('[Payout] vendor slice BLOCKED by admin gate — no transfer', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.blockedReason,
      })
      result.blocked.push({ vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.blockedReason! })
      continue
    }

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

    // C1 — close out the ledger row with the AUTHORITATIVE numbers (the accrual only
    // ever held the provisional subtotal; the real fee share is known only now).
    // Conditional on not-already-paid, mirroring the runner executor's concurrency
    // guard. Invariant this establishes: status='paid' ⟺ stripeTransferId set.
    await db.vendorEarning.updateMany({
      where: { orderId, vendorId: p.vendorId, status: { not: 'paid' } },
      data: {
        status: 'paid',
        feeShareCents: p.feeShareCents,
        netCents: p.transferCents,
        stripeTransferId: transfer.id,
        paidAt: new Date(),
      },
    })

    result.transfers.push({ vendorId: p.vendorId, amountCents: p.transferCents, transferId: transfer.id })
  }

  logger.info('[Payout] order paid out', {
    orderId,
    stripeFeeCents,
    transfers: result.transfers.length,
    held: result.held.length,
    blocked: result.blocked.length,
    skippedDeclined: result.skippedDeclined.length,
  })
  return result
}
