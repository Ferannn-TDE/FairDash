import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { refundVendorPortion } from '@/lib/process-refund'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { logger } from '@/lib/logger'

// PATCH /api/organizer/fairs/[fairSlug]/disputes/[disputeId]
// { action: 'RESOLVE' | 'REFUND' | 'PARTIAL_REFUND', resolution?: string, amount?: number }
// RESOLVE:        mark resolved, no refund.
// REFUND:         full refund via BullMQ worker + mark resolved.
// PARTIAL_REFUND: partial refund via Stripe directly + mark resolved.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; disputeId: string }> }
) {
  try {
    const { organizerId, clerkId } = await requireOrganizerAuth()
    const { fairSlug, disputeId } = await params

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const dispute = await db.dispute.findUnique({
      where: { id: disputeId },
      include: {
        vendor: { select: { id: true, eventId: true } },
        order: {
          select: {
            id: true, eventId: true, vendorId: true, total: true,
            stripePaymentIntentId: true, stripeChargeId: true,
          },
        },
      },
    })
    if (!dispute) return apiError('Dispute not found', 404, 'NOT_FOUND')
    if (dispute.vendor.eventId !== event.id) return apiError('Access denied', 403, 'FORBIDDEN')
    if (dispute.status === 'RESOLVED') return apiError('Dispute already resolved', 409, 'CONFLICT')

    const body = await req.json() as { action?: string; resolution?: string; amount?: number }
    const { action, resolution, amount } = body

    if (!action || !['RESOLVE', 'REFUND', 'PARTIAL_REFUND'].includes(action)) {
      return apiError('action must be RESOLVE, REFUND, or PARTIAL_REFUND', 400, 'VALIDATION_ERROR')
    }
    if (action === 'PARTIAL_REFUND' && (!amount || amount <= 0)) {
      return apiError('amount is required for PARTIAL_REFUND', 400, 'VALIDATION_ERROR')
    }

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const order = dispute.order
    let refundMeta: Record<string, unknown> = {}

    if (action === 'REFUND' || action === 'PARTIAL_REFUND') {
      if (!order.stripePaymentIntentId) {
        return apiError('Order has no Stripe payment — cannot issue refund', 422, 'UNPROCESSABLE')
      }

      const refundReason = resolution ?? `Dispute resolved — ${action === 'PARTIAL_REFUND' ? 'partial' : 'full'} refund`

      // In-app disputes are filed against a SPECIFIC vendor — refund that
      // vendor's portion through the SINGLE engine (fee kept per decision B).
      // REFUND = the vendor's full slice; PARTIAL_REFUND = a constrained override
      // (engine rejects an amount > that vendor's slice). Never raw Stripe.
      try {
        const res = await refundVendorPortion({
          orderId: order.id,
          vendorId: dispute.vendorId,
          reason: refundReason,
          actor: dbUser.id,
          ...(action === 'PARTIAL_REFUND' ? { amountCentsOverride: Math.round(amount! * 100) } : {}),
        })
        refundMeta = {
          partial: action === 'PARTIAL_REFUND',
          vendorId: dispute.vendorId,
          amount: res.sliceCents / 100,
          stripeRefundId: res.stripeRefundId,
        }
        logger.info('[Dispute] refund via engine', { disputeId, orderId: order.id, ...refundMeta })
      } catch (err) {
        logger.error('[Dispute] engine refund failed', { disputeId, error: String(err) })
        return apiError(`Refund failed: ${err instanceof Error ? err.message : 'unknown'}`, 502, 'REFUND_FAILED')
      }

      void db.orderEvent.create({
        data: { orderId: order.id, eventType: 'refund_initiated', actorId: dbUser.id, actorRole: 'organizer', metadata: { ...refundMeta, disputeId } },
      }).catch(() => {})
    }

    const resolutionText = resolution?.slice(0, 500)
      ?? (action === 'REFUND'         ? 'Full refund issued'
        : action === 'PARTIAL_REFUND' ? `Partial refund of $${(amount ?? 0).toFixed(2)} issued`
        : null)

    const updated = await db.dispute.update({
      where: { id: disputeId },
      data:  { status: 'RESOLVED', resolution: resolutionText, resolvedAt: new Date() },
    })

    revalidateTag(`event-badges-${event.id}`, 'default')

    logVendorAction(dispute.vendor.id, dbUser.id, AUDIT_ACTIONS.ORDER_COMPLETED, {
      event: 'dispute_resolved',
      disputeId,
      action,
      resolution: resolutionText,
    })

    return success({
      id:         updated.id,
      status:     updated.status,
      resolution: updated.resolution,
      resolvedAt: updated.resolvedAt,
      refund:     Object.keys(refundMeta).length ? refundMeta : null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
