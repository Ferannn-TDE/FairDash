import { NextRequest } from 'next/server'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// PATCH /api/orders/:id/cancel
// Customer-initiated cancellation.
// Only allowed for PLACED or ACCEPTED orders (before the vendor starts preparing).
// Side-effects: Stripe refund + Cancellation record.

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const clerkId = await requireAuth()

    const order = await db.order.findUnique({ where: { id: params.id } })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // Verify caller is the order's customer
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')
    if (order.customerId !== dbUser.id) return apiError('Access denied', 403, 'FORBIDDEN')

    // Only PLACED or ACCEPTED can be cancelled by the customer
    const cancellable: OrderStatus[] = [OrderStatus.PLACED, OrderStatus.ACCEPTED]
    if (!cancellable.includes(order.status)) {
      throw new ApiError(
        'Orders can only be cancelled before the vendor starts preparing them',
        409,
        'CANNOT_CANCEL'
      )
    }

    // Update order status
    await db.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: 'customer',
        cancellationReason: 'Customer requested cancellation',
      },
    })

    // Issue Stripe refund (best-effort — don't fail the cancellation if it errors)
    let refundIssued = false
    let refundAmount: number | null = null

    if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
          metadata: { orderId: order.id, reason: 'customer_cancelled' },
        })
        refundIssued = true
        refundAmount = refund.amount / 100
        console.log(`[Cancel] Refund ${refund.id} issued — $${refundAmount} for order ${order.id}`)
      } catch (err) {
        console.error(`[Cancel] Stripe refund failed for order ${order.id}:`, err)
      }
    }

    // Write Cancellation record
    await db.cancellation.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        vendorId: order.vendorId,
        reason: 'Customer requested cancellation',
        refundIssued,
        refundAmount,
      },
      update: {},
    })

    return success({ orderId: order.id, status: OrderStatus.CANCELLED, refundIssued })
  } catch (err) {
    return handleApiError(err)
  }
}
