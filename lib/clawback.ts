/**
 * Shared vendor-payout clawback — the ONE place a Stripe transfer reversal
 * happens. Used by both the refund engine (CASE 2: refund after payout fired)
 * and the chargeback flow (bank pulled the charge → claw the vendors back).
 *
 * Reverses the vendor's transfer, converges the dual Payout write paths on the
 * post-reversal truth (reversedAt authoritative), and — if the vendor's balance
 * was insufficient — records the fronted gap in the NegativeBalanceEvent ledger
 * (typed by `kind`). The reversal ALWAYS proceeds (losses_collector:'application');
 * the customer/cardholder is never left short because a vendor lacked funds.
 */

import { db } from './db'
import { stripe } from './stripe'
import { logger } from './logger'

export interface ClawbackInput {
  orderId: string
  vendorId: string
  eventId: string
  stripeTransferId: string
  /** What the vendor received (cents) — the exact amount to reverse. */
  netCents: number
  /** Idempotency key for the reversal (stable per caller so redelivery is a no-op). */
  idempotencyKey: string
  /** Ledger discriminator for any fronted gap. */
  kind: 'refund_reversal' | 'dispute_clawback'
  reason?: string
}

export interface ClawbackResult {
  reversalId: string
  negativeBalanceCents: number // > 0 if FairSynq fronted the clawback
}

export async function reverseVendorPayout(input: ClawbackInput): Promise<ClawbackResult> {
  const { orderId, vendorId, eventId, stripeTransferId, netCents, idempotencyKey, kind, reason } = input

  // Best-effort: detect a clawback that pushes the vendor negative so we can record
  // the debt. The reversal proceeds regardless.
  let negativeBalanceCents = 0
  try {
    const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { stripeAccountId: true } })
    if (vendor?.stripeAccountId) {
      const bal = await stripe.balance.retrieve({}, { stripeAccount: vendor.stripeAccountId })
      const avail = bal.available.find(b => b.currency === 'usd')?.amount ?? 0
      if (avail < netCents) negativeBalanceCents = netCents - avail
    }
  } catch { /* balance probe is best-effort */ }

  const reversal = await stripe.transfers.createReversal(
    stripeTransferId,
    { amount: netCents, metadata: { orderId, vendorId, kind, reason: reason ?? kind } },
    { idempotencyKey },
  )

  // Converge the dual Payout write paths: reversedAt is authoritative truth.
  await db.payout.updateMany({
    where: { orderId, vendorId },
    data: { reversedAt: new Date(), stripeReversalId: reversal.id, stripeStatus: 'reversed' },
  })

  if (negativeBalanceCents > 0) {
    // Idempotent: one open gap per (order, vendor, kind).
    const existing = await db.negativeBalanceEvent.findFirst({
      where: { orderId, vendorId, kind, status: 'open' }, select: { id: true },
    })
    if (!existing) {
      await db.negativeBalanceEvent.create({
        data: {
          eventId, orderId, vendorId, kind,
          amountCents: negativeBalanceCents, reversalId: reversal.id, status: 'open',
          note: `FairSynq fronted ${negativeBalanceCents}¢ (${kind}) — vendor balance insufficient at reversal`,
        },
      })
    }
    logger.warn('[Clawback] NEGATIVE BALANCE — FairSynq fronted; debt recorded (open)', {
      orderId, vendorId, kind, frontedCents: negativeBalanceCents, reversalId: reversal.id,
    })
  }

  return { reversalId: reversal.id, negativeBalanceCents }
}
