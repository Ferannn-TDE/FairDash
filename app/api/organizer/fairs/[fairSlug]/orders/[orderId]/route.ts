import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// GET /api/organizer/fairs/[fairSlug]/orders/[orderId]
// Full order detail: items, timeline, dispute, cancellation, refund status.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string; orderId: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug, orderId } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        vendor: { select: { id: true, name: true, boothNumber: true } },
        orderItems: {
          select: {
            id: true, quantity: true, unitPrice: true, subtotal: true, vendorId: true, specialInstructions: true,
            menuItem: { select: { name: true, category: true } },
          },
        },
        vendorOrderStatuses: {
          select: { vendorId: true, status: true, vendor: { select: { name: true } } },
        },
        refunds: { select: { vendorId: true, status: true, amountCents: true } },
        refundRequests: { select: { vendorId: true, status: true, reason: true } },
        chargebacks: {
          select: {
            id: true, stripeDisputeId: true, amountCents: true, feeCents: true, reason: true,
            status: true, atFaultVendorId: true, clawbackStatus: true, fundsReinstated: true,
          },
        },
        orderEvents: {
          orderBy: { timestamp: 'asc' },
          select: { id: true, eventType: true, actorRole: true, metadata: true, timestamp: true },
        },
        disputes: {
          orderBy: { submittedAt: 'desc' },
          select: { id: true, status: true, reason: true, evidence: true, submittedAt: true, resolution: true, resolvedAt: true },
        },
        cancellation: {
          // Pure audit now — refund truth is derived from Refund rows below, not
          // the deprecated refundIssued/refundAmount columns (which drifted on ~80%
          // of historical rows; Refund rows are the money record).
          select: { reason: true },
        },
      },
    })

    if (!order) return apiError('Order not found', 404, 'NOT_FOUND')
    if (order.eventId !== event.id) return apiError('Access denied', 403, 'FORBIDDEN')

    // Refund truth derived from Refund rows (the money record) — replaces the
    // deprecated Cancellation.refundIssued/refundAmount. Sum the COMPLETED refunds
    // (PENDING/FAILED haven't moved money). This is what the detail modal renders.
    const refundedCents = order.refunds
      .filter(r => r.status === 'COMPLETED')
      .reduce((s, r) => s + r.amountCents, 0)

    return success({
      id: order.id,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      // Pricing
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      fairSynqFee: order.fairSynqFee,
      vendorPayout: order.vendorPayout,
      serviceCharge: order.serviceCharge,
      // Customer
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      pickupLocation: order.pickupLocation,
      // Delivery address
      deliveryStreet: order.deliveryStreet,
      deliveryUnit: order.deliveryUnit,
      deliveryCity: order.deliveryCity,
      deliveryState: order.deliveryState,
      deliveryZip: order.deliveryZip,
      // Curbside
      vehicleMake: order.vehicleMake,
      vehicleColor: order.vehicleColor,
      vehiclePlate: order.vehiclePlate,
      // Cancellation
      cancelledBy: order.cancelledBy,
      cancellationReason: order.cancellationReason,
      // Timestamps
      placedAt: order.placedAt,
      acceptedAt: order.acceptedAt,
      readyAt: order.readyAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      estimatedReadyAt: order.estimatedReadyAt,
      // Stripe
      hasStripe: !!order.stripePaymentIntentId,
      payoutStatus: order.payoutStatus,
      // Out-of-model marker — refunds are disabled for voided orders
      voided: !!order.voidedAt,
      // Vendor
      vendor: order.vendor,
      // Bank chargebacks (distinct from in-app disputes). Read-only surfacing —
      // the fight/accept decision is done in the Stripe dashboard.
      chargebacks: order.chargebacks,
      // Per-vendor breakdown for refunds: slice (the exact amount refundable —
      // NEVER includes the platform fee), current status, refund + request state.
      vendors: order.vendorOrderStatuses.map(vos => {
        const sliceAmount = order.orderItems
          .filter(i => i.vendorId === vos.vendorId)
          .reduce((s, i) => s + i.subtotal, 0)
        const refund = order.refunds.find(r => r.vendorId === vos.vendorId)
        const refundStatus: 'NONE' | 'PENDING' | 'REFUNDED' =
          !refund ? 'NONE' : refund.status === 'COMPLETED' ? 'REFUNDED' : 'PENDING'
        const request = order.refundRequests.find(r => r.vendorId === vos.vendorId)
        return {
          vendorId: vos.vendorId,
          vendorName: vos.vendor.name,
          status: vos.status,
          sliceAmount: parseFloat(sliceAmount.toFixed(2)),
          refundStatus,
          refundRequest: request ? { status: request.status, reason: request.reason } : null,
        }
      }),
      // Items
      items: order.orderItems.map(i => ({
        id: i.id,
        name: i.menuItem.name,
        category: i.menuItem.category,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: parseFloat((i.quantity * i.unitPrice).toFixed(2)),
        specialInstructions: i.specialInstructions,
      })),
      // Timeline
      timeline: order.orderEvents.map(e => ({
        id: e.id,
        eventType: e.eventType,
        actorRole: e.actorRole,
        metadata: e.metadata,
        timestamp: e.timestamp,
      })),
      // Disputes
      disputes: order.disputes,
      // Cancellation audit (reason) + refund summary DERIVED from Refund rows.
      cancellation: order.cancellation
        ? {
            reason: order.cancellation.reason,
            refundIssued: refundedCents > 0,
            refundAmount: refundedCents / 100,
          }
        : null,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
