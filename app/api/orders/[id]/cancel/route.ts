import { NextRequest, NextResponse } from 'next/server'
import { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/ratelimit'
import { enqueueJobSafely } from '@/lib/queue-safe'
import { getOrderQueue, JOB_REFUND } from '@/lib/queues'
import { ORDER_CANCELLATION_FEE_USD } from '@/lib/constants'

// PATCH /api/orders/:id/cancel
// Customer-initiated cancellation.
// Only allowed for PLACED or ACCEPTED orders (before the vendor starts preparing).
// Side-effects: Stripe refund enqueued via BullMQ (idempotent) + Cancellation record.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    // ── Rate limiting — prevent cancellation spam (each triggers a Stripe call) ──
    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? clerkId
    const { allowed } = await enforceRateLimit(ip, 'refund', { failClosed: false })
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

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

    // Determine refund amount:
    //   PLACED   → full refund (vendor hasn't started yet)
    //   ACCEPTED → partial refund: total − $5 cancellation fee
    const isFeeApplicable = order.status === OrderStatus.ACCEPTED
    const refundAmountDollars = isFeeApplicable
      ? Math.max(0, order.total - ORDER_CANCELLATION_FEE_USD)
      : order.total
    const refundAmountCents = isFeeApplicable
      ? Math.round(refundAmountDollars * 100)
      : undefined  // omit → Stripe issues full refund

    // Update master order status + all vendor portions atomically
    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: 'customer',
          cancellationReason: 'Customer requested cancellation',
          cancellationFee: isFeeApplicable ? ORDER_CANCELLATION_FEE_USD : null,
        },
      }),
      db.vendorOrderStatus.updateMany({
        where: { orderId: order.id },
        data: { status: 'DECLINED' },
      }),
    ])

    // Write initial Cancellation record (refund pending — worker updates it on completion)
    await db.cancellation.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        vendorId: order.vendorId,
        reason: 'Customer requested cancellation',
        refundIssued: false,
        refundAmount: null,
      },
      update: {},
    })

    // ── Enqueue Stripe refund via BullMQ (idempotent — jobId deduplicates retries) ──
    if (order.stripePaymentIntentId && process.env.STRIPE_SECRET_KEY) {
      const queue = getOrderQueue()
      const refundIdempotencyKey = `cancel-refund-${order.id}`

      if (queue) {
        const result = await enqueueJobSafely({
          queue,
          name: JOB_REFUND,
          data: {
            eventId:              order.eventId,
            orderId:              order.id,
            stripePaymentIntentId: order.stripePaymentIntentId,
            stripeChargeId:       order.stripeChargeId ?? undefined,
            refundIdempotencyKey,
            refundAmountCents,
            refundReason:         isFeeApplicable
              ? 'customer_cancelled_after_accept'
              : 'customer_cancelled',
            cancellationVendorId: order.vendorId,
          },
          jobId:    refundIdempotencyKey,
          priority: 'critical',
          fallback: async () => {
            await stripe.refunds.create(
              {
                payment_intent: order.stripePaymentIntentId!,
                ...(refundAmountCents && { amount: refundAmountCents }),
                metadata: {
                  orderId:  order.id,
                  reason:   isFeeApplicable
                    ? 'customer_cancelled_after_accept'
                    : 'customer_cancelled',
                },
              },
              { idempotencyKey: refundIdempotencyKey }
            )
          },
        })

        if (result === 'dropped') {
          console.error('[Cancel] Refund job dropped — queue and fallback both failed', {
            orderId: order.id,
          })
        }
      }
    }

    return success({
      orderId:         order.id,
      status:          OrderStatus.CANCELLED,
      refundQueued:    true,
      cancellationFee: isFeeApplicable ? ORDER_CANCELLATION_FEE_USD : 0,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
