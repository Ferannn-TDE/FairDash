import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { getRealtimeDb } from '@/lib/firebase-admin'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// Valid per-vendor status transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PLACED:    ['ACCEPTED', 'DECLINED'],
  ACCEPTED:  ['PREPARING'],
  PREPARING: ['READY'],
  READY:     ['COMPLETED'],
}

// PATCH /api/orders/:id/vendor-status
// Advances this vendor's portion of an order independently.
// Only affects VendorOrderStatus — the master Order.status is only updated
// when ALL vendors have reached a terminal state (COMPLETED or DECLINED).
// If ALL vendors decline → master order cancelled + Stripe refund issued.
// If ALL vendors complete/decline (mixed) → master order marked COMPLETED.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const orderId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const { status: newStatus } = await req.json() as { status: string }
    if (!newStatus) throw new ApiError('status is required', 400, 'VALIDATION_ERROR')

    // Resolve the calling user's vendor membership
    const membership = await db.vendorMember.findFirst({
      where: { userId: dbUser.id },
      select: { vendorId: true },
    })
    if (!membership) return apiError('Access denied — not a vendor member', 403, 'FORBIDDEN')

    const { vendorId } = membership

    // Load the VendorOrderStatus for this vendor
    const vendorStatus = await db.vendorOrderStatus.findUnique({
      where: { orderId_vendorId: { orderId, vendorId } },
    })
    if (!vendorStatus) {
      return apiError('This order does not include your vendor', 404, 'NOT_FOUND')
    }

    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[vendorStatus.status]
    if (!allowed?.includes(newStatus)) {
      throw new ApiError(
        `Cannot transition from ${vendorStatus.status} to ${newStatus}`,
        409,
        'INVALID_TRANSITION'
      )
    }

    const TIMESTAMP_FIELD: Record<string, string> = {
      ACCEPTED:  'acceptedAt',
      PREPARING: 'preparingAt',
      READY:     'readyAt',
      COMPLETED: 'completedAt',
      DECLINED:  'declinedAt',
    }

    // Apply the vendor-level status update + set the corresponding timestamp
    const tsField = TIMESTAMP_FIELD[newStatus]
    const updated = await db.vendorOrderStatus.update({
      where: { orderId_vendorId: { orderId, vendorId } },
      data: {
        status: newStatus,
        ...(tsField ? { [tsField]: new Date() } : {}),
      },
    })

    // Check aggregate state across all vendors to decide master order update
    const allStatuses = await db.vendorOrderStatus.findMany({
      where: { orderId },
      select: { status: true, vendorId: true },
    })

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, eventId: true, customerId: true, vendorId: true,
        stripePaymentIntentId: true, stripeChargeId: true,
      },
    })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    const allDeclined  = allStatuses.every(s => s.status === 'DECLINED')
    const allTerminal  = allStatuses.every(s => ['COMPLETED', 'DECLINED'].includes(s.status))

    if (allDeclined) {
      // Every vendor declined — cancel the master order and refund
      await db.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'vendor' },
      })

      // Issue Stripe refund
      if (order.stripePaymentIntentId) {
        try {
          const refundParams = order.stripeChargeId
            ? { charge: order.stripeChargeId }
            : { payment_intent: order.stripePaymentIntentId }
          await stripe.refunds.create({
            ...refundParams,
            metadata: { orderId, reason: 'all_vendors_declined' },
          })
        } catch (err) {
          console.error('[VendorStatus] Stripe refund failed:', err)
        }

        await db.cancellation.upsert({
          where: { orderId },
          create: {
            orderId,
            vendorId: order.vendorId,
            reason: 'All vendors declined',
            refundIssued: true,
          },
          update: { refundIssued: true },
        })
      }

      // Firebase — notify customer
      const rtdb = getRealtimeDb()
      rtdb?.ref(`fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`)
        .update({ status: 'CANCELLED', updatedAt: Date.now() })
        .catch(() => {})
    } else if (allTerminal) {
      // Some completed, some declined — master order done
      await db.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', completedAt: new Date() } })

      const rtdb = getRealtimeDb()
      rtdb?.ref(`fairs/${order.eventId}/customerOrders/${order.customerId}/${orderId}`)
        .update({ status: 'COMPLETED', updatedAt: Date.now() })
        .catch(() => {})
    }

    // Always update this vendor's RTDB node with their own status
    const rtdb = getRealtimeDb()
    rtdb?.ref(`fairs/${order.eventId}/orders/${vendorId}/${orderId}`)
      .update({ status: newStatus, updatedAt: Date.now() })
      .catch(() => {})

    return success({ vendorId, orderId, status: newStatus })
  } catch (err) {
    return handleApiError(err)
  }
}
