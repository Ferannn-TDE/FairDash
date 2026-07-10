import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { logger } from '@/lib/logger'

// PATCH /api/organizer/fairs/[fairSlug]/chargebacks/[chargebackId]
// body: { atFaultVendorId: string }
//
// Admin assigns fault for a bank chargeback. This MATERIALIZES the ~$15 dispute
// fee as a recoverable debt (NegativeBalanceEvent kind=dispute_fee) against the
// at-fault vendor — the data that keeps fee pass-through possible later. It does
// NOT move money or deduct anything now (default = FairSynq absorbs). The
// fight/accept decision stays in the Stripe dashboard.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; chargebackId: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug, chargebackId } = await params

    // MONEY CARVE-OUT: chargeback fault-assignment must stay reachable AFTER a fair
    // is soft-deleted (a bank dispute can land post-delete), so this resolves with
    // includeArchived — it must NOT adopt the default (archived-excluding) resolver.
    const event = await resolveOwnedFair(fairSlug, organizerId, { includeArchived: true })

    const cb = await db.chargeback.findUnique({
      where: { id: chargebackId },
      select: { id: true, eventId: true, orderId: true, feeCents: true, atFaultVendorId: true },
    })
    if (!cb) return apiError('Chargeback not found', 404, 'NOT_FOUND')
    if (cb.eventId !== event.id) return apiError('Access denied', 403, 'FORBIDDEN')

    const body = await req.json().catch(() => ({})) as { atFaultVendorId?: string }
    const atFaultVendorId = body.atFaultVendorId
    if (!atFaultVendorId) return apiError('atFaultVendorId is required', 400, 'VALIDATION_ERROR')

    // Vendor must actually be on the order.
    const onOrder = await db.orderItem.findFirst({ where: { orderId: cb.orderId, vendorId: atFaultVendorId }, select: { id: true } })
    if (!onOrder) return apiError('Vendor is not on this order', 400, 'VALIDATION_ERROR')

    await db.chargeback.update({ where: { id: cb.id }, data: { atFaultVendorId } })

    // Materialize the recoverable dispute-fee debt (idempotent per order+vendor+kind).
    // Default action remains ABSORB — this only records that it's recoverable.
    const existing = await db.negativeBalanceEvent.findFirst({
      where: { orderId: cb.orderId, vendorId: atFaultVendorId, kind: 'dispute_fee' }, select: { id: true },
    })
    if (!existing && cb.feeCents > 0) {
      await db.negativeBalanceEvent.create({
        data: {
          eventId: cb.eventId, orderId: cb.orderId, vendorId: atFaultVendorId, kind: 'dispute_fee',
          amountCents: cb.feeCents, status: 'open',
          note: `Dispute fee recoverable from at-fault vendor (chargeback ${cb.id}). Default: FairSynq absorbs.`,
        },
      })
    }

    logger.info('[Chargeback] at-fault vendor set; dispute fee recorded recoverable', { chargebackId: cb.id, atFaultVendorId, feeCents: cb.feeCents })
    return success({ chargebackId: cb.id, atFaultVendorId, feeRecordedRecoverableCents: cb.feeCents })
  } catch (err) {
    return handleApiError(err)
  }
}
