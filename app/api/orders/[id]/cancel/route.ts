import { NextRequest } from 'next/server'
import { OrderStatus } from '@prisma/client'
import Stripe from 'stripe'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { ORDER_CANCELLATION_FEE_USD } from '@/lib/constants'

// PATCH /api/orders/:id/cancel
// Customer-initiated cancellation.
// Only allowed for PLACED or ACCEPTED orders (before the vendor starts preparing).
// Side-effects: Stripe refund + Cancellation record.

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    const order = await db.order.findUnique({ where: { id: (await params).id } })
    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // Verify caller is the order's customer
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')
    if (order.customerId !== dbUser.id) return apiError('Access denied', 403, 'FORBIDDEN')

    // PREPARING or later cannot be cancelled
    const cancellable = [OrderStatus.PLACED, OrderStatus.ACCEPTED] as const
    if (!(cancellable as readonly OrderStatus[]).includes(order.status)) {
      throw new ApiError(
        'Order cannot be cancelled at this stage',
        409,
        'CANCEL_NOT_ALLOWED'
      )
    }

    // Determine refund amount based on whether the vendor has already accepted
    //   PLACED   → full refund (vendor hasn't started yet)
    //   ACCEPTED → partial refund: total − $5 cancellation fee
    const isFeeApplicable = order.status === OrderStatus.ACCEPTED
    const refundAmountDollars = isFeeApplicable
      ? Math.max(0, order.total - ORDER_CANCELLATION_FEE_USD)
      : order.total

    // Update order status
    await db.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: 'customer',
        cancellationReason: 'Customer requested cancellation',
        // Persist the retained fee so reports can reconcile
        cancellationFee: isFeeApplicable ? ORDER_CANCELLATION_FEE_USD : null,
      },
    })

    // Issue Stripe refund (best-effort — don't fail the cancellation if it errors)
    let refundIssued = false
    let refundAmount: number | null = null

    if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
      try {
        const refundParams: Stripe.RefundCreateParams = {
          payment_intent: order.stripePaymentIntentId,
          metadata: {
            orderId: order.id,
            reason: isFeeApplicable ? 'customer_cancelled_after_accept' : 'customer_cancelled',
          },
          // Partial refund when cancellation fee applies; omit for full refund
          ...(isFeeApplicable && { amount: Math.round(refundAmountDollars * 100) }),
        }
        const refund = await stripe.refunds.create(refundParams)
        refundIssued = true
        refundAmount = refund.amount / 100
        console.log(`[Cancel] Refund ${refund.id} — $${refundAmount} for order ${order.id}${isFeeApplicable ? ` ($${ORDER_CANCELLATION_FEE_USD} fee retained)` : ''}`)
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
      update: { refundIssued, refundAmount },
    })

    return success({
      orderId: order.id,
      status: OrderStatus.CANCELLED,
      refundIssued,
      refundAmount,
      cancellationFee: isFeeApplicable ? ORDER_CANCELLATION_FEE_USD : 0,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
