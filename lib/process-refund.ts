/**
 * Per-vendor refund engine. The SINGLE place customer refunds (and vendor
 * transfer reversals) happen — mirrors lib/process-payout.ts. Every refund path
 * in the app (customer pre-acceptance cancel, organizer/admin refund, approved
 * customer request, reconciler retry) routes through refundVendorPortion(). No
 * other code may call stripe.refunds.create / transfers.createReversal.
 *
 * Money model (locked):
 *   - The customer is returned this vendor's SUBTOTAL SLICE ONLY. The 10%
 *     service fee is NEVER refunded (decision B) — FairSynq keeps it.
 *   - Stripe does NOT return its processing fee on a refund. FairSynq eats that
 *     (the refunded vendor's proportional Stripe-fee share). Tracked, not recovered.
 *   - The slice is derived exactly as the payout does: Σ orderItems.subtotal for
 *     the vendor, in integer cents.
 *
 * Two cases, decided by whether the vendor's DELAYED payout has fired yet:
 *   CASE 1 — payout NOT yet sent (within the refund window, the common case):
 *     Refund the customer their slice. No reversal — the money never left the
 *     platform balance. The vendor is marked REFUNDED so the still-pending
 *     delayed order-payout skips them and pays everyone else (see process-payout).
 *   CASE 2 — payout already sent (past the window, rare):
 *     Refund the customer their slice AND reverse the vendor's transfer. If the
 *     vendor's connected balance is insufficient the reversal still completes
 *     (losses_collector: 'application') — FairSynq fronts it; we record a
 *     NegativeBalanceEvent so the debt is chased, never silently absorbed. The
 *     customer is ALWAYS refunded regardless of the vendor's balance.
 *
 * Guards: customer-side money identity must hold (subtotal+fee==total) or we
 * HALT (never refund ambiguous money). Idempotent: Refund row @unique(order,
 * vendor) + Stripe idempotency keys refund_{order}_{vendor} / reversal_{...}.
 * Re-running a completed refund is a no-op.
 */

import { db } from './db'
import { stripe } from './stripe'
import { splitStripeFee } from './payout-split'
import { reverseVendorPayout } from './clawback'
import { logger } from './logger'
import type { MoneyActor } from './admin-money'

/** Best-effort map of the free-form `actor` string to a MoneyActor, for the accrual-reversal
 *  audit. Callers with a clear actor pass `moneyActor` explicitly (organizer/admin refunds);
 *  this only covers the fallbacks — all of which are no-accrual or unambiguously typed. */
export function deriveMoneyActor(actor?: string): MoneyActor {
  if (actor === 'reconciler') return { id: 'reconciler', type: 'reconciler' }
  if (!actor || actor === 'system' || actor.startsWith('vendor:')) return { id: 'system', type: 'system' }
  return { id: actor, type: 'system' } // a bare id from a path that didn't set moneyActor — record as system
}

/** Thrown when the order's money identity doesn't hold — refund halted, no money moves. */
export class RefundReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefundReconciliationError'
  }
}

export interface RefundVendorInput {
  orderId: string
  vendorId: string
  reason?: string
  actor?: string // id of who initiated (admin/organizer/customer/system)
  /**
   * WHO acted, for the accrual-reversal audit (refund-AFTER-accrual). If a refund lands on a
   * portion that was already accrued, the accrual is a phantom and gets reversed here — the
   * audit must name the real actor. Callers with a clear actor pass it (organizer refund →
   * that organizer; admin → admin); otherwise the string `actor` is mapped best-effort. The
   * reverser is idempotent + refuses payable rows, so this is always safe to run.
   */
  moneyActor?: import('./admin-money').MoneyActor
  /**
   * Whether to set this vendor's VendorOrderStatus to REFUNDED (default true).
   * The vendor-decline path passes false: a declined portion stays DECLINED (its
   * accurate terminal state, relied on by history/analytics) — the refund is the
   * money consequence, recorded via the Refund row, not a status change. The
   * money behaviour (customer refund, reversal, reconciliation) is identical
   * either way; only the portion's status label differs.
   */
  markVendorStatus?: boolean
  /**
   * Deliberate, logged, reconciled fee waiver (default false). When true the
   * refund ALSO returns this vendor's share of the 10% service fee — used by
   * genuine "the event broke, refund everyone in full" paths (incident /
   * emergency). Reconciliation records the waived 10% as an explicit
   * waived-revenue line, never a leak.
   */
  waiveFee?: boolean
  /**
   * Arbitrary partial-refund amount in cents (e.g. in-app dispute PARTIAL_REFUND).
   * Still scoped to this vendor and routed through the engine — never raw Stripe.
   * Must be > 0 and <= the vendor's refundable (slice, or slice+feeShare when
   * waiveFee). An amount that can't be attributed to a single vendor's slice is
   * ill-defined in a marketplace and is REJECTED, not guessed.
   */
  amountCentsOverride?: number
}

export interface RefundVendorResult {
  status: 'refunded' | 'noop'
  case: 1 | 2 | null
  orderId: string
  vendorId: string
  sliceCents: number
  stripeRefundId: string | null
  stripeReversalId: string | null
  /** Stripe fee FairSynq absorbs on this refunded slice (not recovered). */
  absorbedStripeFeeCents: number
  negativeBalanceCents: number // > 0 if FairSynq fronted a clawback (CASE 2)
}

const cents = (n: number) => Math.round(n * 100)

export async function refundVendorPortion(input: RefundVendorInput): Promise<RefundVendorResult> {
  const { orderId, vendorId, reason, actor } = input
  const markVendorStatus = input.markVendorStatus ?? true
  const waiveFee = input.waiveFee ?? false

  // ── Idempotency: already fully refunded? ──────────────────────────────────
  const existing = await db.refund.findUnique({
    where: { orderId_vendorId: { orderId, vendorId } },
    select: { status: true, amountCents: true, stripeRefundId: true, stripeReversalId: true },
  })
  if (existing?.status === 'COMPLETED') {
    return {
      status: 'noop', case: null, orderId, vendorId,
      sliceCents: existing.amountCents,
      stripeRefundId: existing.stripeRefundId, stripeReversalId: existing.stripeReversalId,
      absorbedStripeFeeCents: 0, negativeBalanceCents: 0,
    }
  }

  // ── Load order money-truth ────────────────────────────────────────────────
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, eventId: true, voidedAt: true,
      total: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, tip: true,
      stripeChargeId: true, stripePaymentIntentId: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      payouts: { select: { vendorId: true, netAmount: true, stripeTransferId: true, reversedAt: true } },
      // Second CASE-2 signal — see the CASE decision below.
      vendorEarnings: { select: { vendorId: true, status: true } },
    },
  })
  if (!order) throw new Error(`refundVendorPortion: order ${orderId} not found`)
  if (order.voidedAt) throw new Error(`refundVendorPortion: order ${orderId} is voided (out of model) — not refundable`)

  // Per-vendor subtotal slices (integer cents) — authoritative, from the DB.
  const vendorSubtotalsCents: Record<string, number> = {}
  for (const it of order.orderItems) {
    vendorSubtotalsCents[it.vendorId] = (vendorSubtotalsCents[it.vendorId] ?? 0) + cents(it.subtotal)
  }
  const sliceCents = vendorSubtotalsCents[vendorId] ?? 0
  if (sliceCents <= 0) {
    throw new Error(`refundVendorPortion: vendor ${vendorId} has no positive slice on order ${orderId}`)
  }

  // ── Reconciliation guard: customer-side identity must hold ────────────────
  // (subtotal + serviceFee + delivery + serviceCharge + tip === charge). Same guard
  // as the payout. If it fails, the order's money is ambiguous — HALT, never refund.
  // NOTE: this engine refunds vendor SUBTOTAL slices only — it never refunds the
  // tip (tip is non-refundable once a runner earned it; the no-runner case is
  // handled at cancel time). tipCents appears here solely to satisfy the identity.
  const totalSubtotalCents = Object.values(vendorSubtotalsCents).reduce((s, c) => s + c, 0)
  const serviceFeeCents = cents(order.fairSynqFee)
  const deliveryCents = cents(order.deliveryFee ?? 0)
  const serviceChargeCents = cents(order.serviceCharge ?? 0)
  const tipCents = cents(order.tip ?? 0)
  const totalCents = cents(order.total)
  const customerSide = totalSubtotalCents + serviceFeeCents + deliveryCents + serviceChargeCents + tipCents
  if (customerSide !== totalCents) {
    throw new RefundReconciliationError(
      `order ${orderId}: customer-side mismatch — charge ${totalCents}¢ ≠ subtotal ${totalSubtotalCents} + ` +
      `serviceFee ${serviceFeeCents} + delivery ${deliveryCents} + serviceCharge ${serviceChargeCents} + tip ${tipCents}. Refund halted.`,
    )
  }

  // ── Refund amount: slice (fee kept) or slice + waived fee share (waiveFee) ─
  // The 10% service fee allocation per vendor uses the same exact split as the
  // payout (largest-remainder), so summing waiveFee refunds across all vendors
  // returns subtotal + serviceFee == the whole charge, to the cent.
  const waivedFeeCents = waiveFee
    ? (splitStripeFee(vendorSubtotalsCents, serviceFeeCents).find(l => l.vendorId === vendorId)?.feeShareCents ?? 0)
    : 0
  const refundableCents = sliceCents + waivedFeeCents
  let refundAmountCents = refundableCents
  if (input.amountCentsOverride != null) {
    const ov = input.amountCentsOverride
    if (!Number.isInteger(ov) || ov <= 0 || ov > refundableCents) {
      throw new RefundReconciliationError(
        `order ${orderId} vendor ${vendorId}: partial override ${ov}¢ is out of range (must be 1..${refundableCents}¢ — this vendor's refundable). Rejected.`,
      )
    }
    refundAmountCents = ov
  }

  // ── Resolve charge id (for the refund + the real Stripe fee read) ─────────
  let chargeId = order.stripeChargeId ?? null
  if (!chargeId && order.stripePaymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ['latest_charge'] })
    const ch = pi.latest_charge
    if (ch && typeof ch === 'object' && 'id' in ch) chargeId = ch.id as string
  }
  if (!chargeId) throw new RefundReconciliationError(`order ${orderId}: no charge to refund against`)

  // Observability: this vendor's proportional share of the REAL settled Stripe
  // fee — the amount FairSynq eats on this refund (Stripe never returns its fee).
  let absorbedStripeFeeCents = 0
  try {
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
    const bt = charge.balance_transaction
    if (bt && typeof bt === 'object' && bt.fee != null) {
      const line = splitStripeFee(vendorSubtotalsCents, bt.fee).find(l => l.vendorId === vendorId)
      absorbedStripeFeeCents = line?.feeShareCents ?? 0
    }
  } catch { /* fee read is observability only; never blocks the customer refund */ }

  // ── Decide CASE: did this vendor's payout already fire? ───────────────────
  // A non-reversed Payout row with a transfer id = the vendor was paid → CASE 2.
  //
  // ⚠️ THIS NARROWS THE RACE BY NOTHING, AND THAT IS DELIBERATE. Both signals below are
  // written AFTER the Stripe transfer (process-payout.ts:406 transfer → :420 Payout row →
  // :445 earning='paid'), so a refund landing in the ~500ms between the transfer and the
  // Payout row still reads CASE 1: it refunds the customer and leaves the transfer standing.
  // Customer and vendor both hold the money.
  //
  // The earning check is added anyway because it costs nothing and catches the wider tail
  // (Payout row written, earning lagging, or vice versa). It is NOT the fix.
  //
  // WHY NOT CLOSE IT HERE: closing it properly needs the earning RESERVED before the Stripe
  // call, which means a new 'paying' status — and that vocabulary ripples through
  // computeLedgerBreakdown (a 'paying' row silently drops out of payable),
  // classifyVendorSlice, and Patterns C/D/S/T. A row stuck in 'paying' after a crash would
  // be invisible to every reader, which is worse than the window. The clean fix is a
  // nullable Payout.stripeTransferId + a pre-transfer pending row; that is a migration and
  // it is deferred post-fair (CURRENT_STATE §7).
  //
  // WHAT ACTUALLY CLOSES IT: reconciler Pattern X, which detects a non-reversed transfer
  // coexisting with a completed CASE-1 refund and ALERTS a human with both ids and the
  // dollar amount. Detected reliably beats made-impossible-by-a-rushed-state-machine.
  const paidRow = order.payouts.find(p => p.vendorId === vendorId && p.stripeTransferId && !p.reversedAt)
  const earningPaid = order.vendorEarnings.some(e => e.vendorId === vendorId && e.status === 'paid')
  const refundCase: 1 | 2 = (paidRow || earningPaid) ? 2 : 1

  // ── Open/refresh the Refund row (PENDING) — idempotent ────────────────────
  await db.refund.upsert({
    where: { orderId_vendorId: { orderId, vendorId } },
    create: {
      eventId: order.eventId, orderId, vendorId,
      amountCents: refundAmountCents, reason: reason ?? null, status: 'PENDING', createdBy: actor ?? null,
    },
    update: { amountCents: refundAmountCents, reason: reason ?? null, status: 'PENDING' },
  })

  // ── 1) Refund the customer (BOTH cases). Amount = slice (fee kept) unless
  // waiveFee adds the fee share, or an explicit partial override was given. ──
  let stripeRefundId: string
  try {
    const refund = await stripe.refunds.create(
      {
        charge: chargeId,
        amount: refundAmountCents,
        metadata: { orderId, vendorId, reason: reason ?? 'vendor_portion_refund', waiveFee: String(waiveFee) },
      },
      { idempotencyKey: `refund_${orderId}_${vendorId}` },
    )
    stripeRefundId = refund.id
  } catch (err) {
    await db.refund.update({
      where: { orderId_vendorId: { orderId, vendorId } },
      data: { status: 'FAILED' },
    }).catch(() => {})
    logger.error('[Refund] customer refund failed', { orderId, vendorId, error: String(err) })
    throw err
  }

  // ── 2) CASE 2 only: reverse the vendor's transfer to claw it back ─────────
  // Reuses the shared clawback helper (same machinery the chargeback flow uses).
  let stripeReversalId: string | null = null
  let negativeBalanceCents = 0
  if (refundCase === 2 && paidRow) {
    try {
      const res = await reverseVendorPayout({
        orderId, vendorId, eventId: order.eventId,
        stripeTransferId: paidRow.stripeTransferId!,
        netCents: cents(paidRow.netAmount), // exactly what the vendor received
        idempotencyKey: `reversal_${orderId}_${vendorId}`,
        kind: 'refund_reversal',
        reason: reason ?? 'vendor_portion_refund',
      })
      stripeReversalId = res.reversalId
      negativeBalanceCents = res.negativeBalanceCents
    } catch (err) {
      // Customer is already refunded — do NOT roll that back. Record the failed
      // reversal loudly so the clawback is chased manually; never leave it silent.
      await db.refund.update({
        where: { orderId_vendorId: { orderId, vendorId } },
        data: { status: 'FAILED', stripeRefundId },
      }).catch(() => {})
      logger.error('[Refund] CASE 2 reversal FAILED after customer refunded — manual clawback needed', {
        orderId, vendorId, transferId: paidRow.stripeTransferId, error: String(err),
      })
      throw err
    }
  }

  // ── Mark the vendor portion REFUNDED (unless caller opts out) + complete row ─
  await db.$transaction([
    ...(markVendorStatus
      ? [db.vendorOrderStatus.updateMany({ where: { orderId, vendorId }, data: { status: 'REFUNDED' } })]
      : []),
    db.refund.update({
      where: { orderId_vendorId: { orderId, vendorId } },
      data: { status: 'COMPLETED', stripeRefundId, stripeReversalId },
    }),
    db.orderEvent.create({
      data: {
        orderId, eventType: 'refund_completed', actorId: actor ?? null,
        actorRole: 'system',
        metadata: { vendorId, case: refundCase, refundAmountCents, sliceCents, waivedFeeCents, stripeRefundId, stripeReversalId, absorbedStripeFeeCents, negativeBalanceCents },
      },
    }),
  ])

  // ── REFUND-AFTER-ACCRUAL: reverse any phantom accrual for this portion ─────────
  // The one chokepoint every refund funnels through, so hooking here covers all in-app doors
  // (organizer/admin/customer/dispute/reconciler). If this portion was already accrued (a
  // refund landing AFTER completion accrued it), that accrual is now owed nothing → reverse it,
  // attributed to the real actor. Idempotent + refuses payable rows (safe if there's nothing to
  // reverse — the pre-completion refund/decline case). Fail-soft: reconciler Pattern T is the
  // 60s race net, so a failure here is a latency hit, never a correctness hole. Dynamic import
  // keeps the module graph acyclic.
  try {
    const { reverseAccrualForRefundedPortion } = await import('./reverse-accrual')
    const moneyActor = input.moneyActor ?? deriveMoneyActor(actor)
    await reverseAccrualForRefundedPortion({
      orderId, vendorId, actor: moneyActor,
      reason: `accrual reversed at refund time — portion refunded${reason ? ` (${reason})` : ''}`,
    })
  } catch (err) {
    logger.error('[Refund] accrual reversal failed — Pattern T backstops within 60s', { orderId, vendorId, error: String(err) })
  }

  // Reconciliation log (to the cent). FairSynq keeps its 10% UNLESS waiveFee, in
  // which case the waived fee is an explicit, accounted waived-revenue line (not
  // a leak). In CASE 2 the vendor's net was clawed back (any shortfall = the
  // recorded negative-balance debt).
  logger.info('[Refund] reconciled', {
    orderId, vendorId, case: refundCase,
    customerRefundedCents: refundAmountCents,
    sliceCents,
    waivedFeeCents,                                  // > 0 only when waiveFee — deliberate waived revenue
    serviceFeeKept: waiveFee ? `WAIVED ${waivedFeeCents}¢ (deliberate)` : 'kept (10% not refunded)',
    absorbedStripeFeeCents,
    // paidRow may be ABSENT on a CASE 2 reached via the earning alone (earning='paid' with no
    // Payout row — the crash-window shape Pattern X hunts). `paidRow!` would throw here, so it
    // is guarded: no Payout row means we reversed nothing, and Pattern X owns the follow-up.
    reversedVendorNetCents: refundCase === 2 && paidRow ? cents(paidRow.netAmount) : 0,
    negativeBalanceCents,
  })

  return {
    status: 'refunded', case: refundCase, orderId, vendorId,
    sliceCents: refundAmountCents,                   // amount actually returned to the customer
    stripeRefundId, stripeReversalId, absorbedStripeFeeCents, negativeBalanceCents,
  }
}
