import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-error'
import type Stripe from 'stripe'

// POST /api/webhooks/stripe
// Verifies the Stripe webhook signature and handles payment events.
// Configure in Stripe Dashboard → Webhooks → endpoint: /api/webhooks/stripe
// Events: payment_intent.succeeded, payment_intent.payment_failed, transfer.created
//
// NOTE: Full per-transaction payout logic is implemented in Part 3.
// This handler records the incoming event and updates order payment state.
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set')
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const headerPayload = await headers()
  const signature = headerPayload.get('stripe-signature')

  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err)
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent
      await db.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { stripeChargeId: (pi.latest_charge as string | null) ?? undefined },
      })
      console.log(`[Stripe Webhook] payment_intent.succeeded → ${pi.id}`)

    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent
      await db.order.updateMany({
        where: { stripePaymentIntentId: pi.id },
        data: { status: 'CANCELLED', cancelledBy: 'system', cancellationReason: 'Payment failed' },
      })
      console.log(`[Stripe Webhook] payment_intent.payment_failed → ${pi.id}`)

    } else if (event.type === 'transfer.created') {
      // Record per-transaction payout in our Payout table
      const transfer = event.data.object as Stripe.Transfer
      const meta = transfer.metadata as Record<string, string>
      if (meta?.vendorId && meta?.eventId) {
        const gross = transfer.amount / 100
        const fee = parseFloat(meta.fairSynqFee ?? meta.fairDashFee ?? '0')
        await db.payout.upsert({
          where: { stripeTransferId: transfer.id },
          create: {
            vendorId: meta.vendorId,
            eventId: meta.eventId,
            grossAmount: gross,
            fairSynqFee: fee,
            netAmount: gross - fee,
            stripeTransferId: transfer.id,
            stripeStatus: 'pending',
          },
          update: {},
        })
      }
      console.log(`[Stripe Webhook] transfer.created → ${transfer.id}`)

    } else {
      // transfer.paid and other non-typed events
      if ((event.type as string) === 'transfer.paid') {
        const obj = event.data.object as { id: string }
        await db.payout.updateMany({
          where: { stripeTransferId: obj.id },
          data: { stripeStatus: 'paid', processedAt: new Date() },
        })
      }
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    return Response.json({ received: true })
  } catch (err) {
    return handleApiError(err)
  }
}
