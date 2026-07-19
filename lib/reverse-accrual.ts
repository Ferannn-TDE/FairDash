import { db } from './db'
import { NON_PAYABLE_VENDOR_STATUSES } from './process-payout'
import { writeMoneyAudit, type MoneyActor } from './admin-money'
import { logger } from './logger'

/**
 * Reverse a PHANTOM vendor accrual — an 'accrued' VendorEarning for a portion that is owed
 * nothing (its own VendorOrderStatus is REFUNDED/DECLINED/CANCELLED). The ONE reverser, shared
 * by both the refund-time hook (refund-AFTER-accrual) and the reconciler Pattern-T backstop
 * (the race net + the existing-residual cleanup), so the two can't drift.
 *
 * SAFE BY CONSTRUCTION:
 *   • SAME predicate as the accrual gate (NON_PAYABLE_VENDOR_STATUSES / payableVendorIds) —
 *     it REFUSES to cancel a row whose portion is still payable (VOS not in the non-payable
 *     set). A legit COMPLETED accrual can never be reversed by this, even if called by mistake.
 *   • Only touches 'accrued' rows. 'cancelled' → already done (idempotent no-op). 'paid' → the
 *     money already transferred; reversing a sent transfer is the chargeback/clawback domain,
 *     NOT this. 'held' → an admin's explicit decision; never overridden here.
 *   • ATOMIC: the status flip and the audit row are one $transaction (same shape as
 *     setOrderPayoutState) — a failed audit rolls back the cancel. No un-audited money move.
 *   • HONEST ACTOR: writes actorId + actorType via writeMoneyAudit — organizer refund → that
 *     organizer; reconciler sweep → reconciler; webhook → system. Never an admin-by-default.
 *   • dryRun: reports what it WOULD reverse, writes nothing.
 */
export interface ReverseAccrualInput {
  orderId: string
  vendorId: string
  actor: MoneyActor
  reason: string
  dryRun?: boolean
}

export type ReverseAccrualResult =
  | { reversed: true; cents: number; auditId: string | null; dryRun: boolean }
  | { reversed: false; skipped: 'no-earning' | 'not-accrued' | 'portion-still-payable'; status?: string; cents: number }

export async function reverseAccrualForRefundedPortion(input: ReverseAccrualInput): Promise<ReverseAccrualResult> {
  const { orderId, vendorId, actor, reason, dryRun = false } = input

  const earning = await db.vendorEarning.findFirst({
    where: { orderId, vendorId },
    select: {
      id: true, eventId: true, status: true, subtotalCents: true,
      order: { select: { vendorOrderStatuses: { where: { vendorId }, select: { status: true } } } },
    },
  })
  if (!earning) return { reversed: false, skipped: 'no-earning', cents: 0 }

  // Idempotent / scope: only an 'accrued' phantom is reversible here.
  if (earning.status !== 'accrued') {
    return { reversed: false, skipped: 'not-accrued', status: earning.status, cents: earning.subtotalCents }
  }

  // SAFETY: never cancel a payable portion. The portion's OWN status must be non-payable.
  const vos = earning.order.vendorOrderStatuses[0]?.status
  if (!vos || !NON_PAYABLE_VENDOR_STATUSES.has(vos)) {
    logger.warn('[reverseAccrual] REFUSED — portion is still payable', { orderId, vendorId, vos: vos ?? '(none)' })
    return { reversed: false, skipped: 'portion-still-payable', status: earning.status, cents: earning.subtotalCents }
  }

  if (dryRun) {
    return { reversed: true, cents: earning.subtotalCents, auditId: null, dryRun: true }
  }

  const [, audit] = await db.$transaction([
    db.vendorEarning.update({ where: { id: earning.id }, data: { status: 'cancelled' } }),
    writeMoneyAudit(actor, earning.eventId, {
      action: 'CANCEL',
      payeeType: 'vendor',
      payeeId: vendorId,
      orderId,
      earningId: earning.id,
      amountCents: earning.subtotalCents,
      reason,
      metadata: { previousStatus: 'accrued', newStatus: 'cancelled', portionStatus: vos, reversedBy: actor.type },
    }),
  ])

  logger.warn('[reverseAccrual] phantom accrual reversed', {
    orderId, vendorId, cents: earning.subtotalCents, portion: vos, actorType: actor.type,
  })
  return { reversed: true, cents: earning.subtotalCents, auditId: audit.id, dryRun: false }
}
