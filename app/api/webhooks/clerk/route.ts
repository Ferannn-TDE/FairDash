import { headers } from 'next/headers'
import { Webhook } from 'svix'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-error'

type ClerkEmailAddress = { email_address: string; id: string }

type ClerkWebhookPayload = {
  type: string
  data: {
    id: string
    email_addresses: ClerkEmailAddress[]
    primary_email_address_id: string
    first_name: string | null
    last_name: string | null
    phone_numbers?: Array<{ phone_number: string }>
  }
}

// POST /api/webhooks/clerk
// Verifies the svix signature and syncs Clerk user lifecycle events to our DB.
// Configure in Clerk Dashboard → Webhooks → endpoint: /api/webhooks/clerk
// Events: user.created, user.updated, user.deleted
export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not set')
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  // Verify svix signature
  const headerPayload = await headers()
  const svixId = headerPayload.get('svix-id')
  const svixTimestamp = headerPayload.get('svix-timestamp')
  const svixSignature = headerPayload.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return Response.json({ error: 'Missing svix headers' }, { status: 400 })
  }

  const rawBody = await req.text()

  let event: ClerkWebhookPayload
  try {
    const wh = new Webhook(webhookSecret)
    event = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookPayload
  } catch {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  const { type, data } = event

  try {
    switch (type) {
      case 'user.created':
      case 'user.updated': {
        const primaryEmail = data.email_addresses.find(
          (e) => e.id === data.primary_email_address_id
        )?.email_address

        if (!primaryEmail) {
          return Response.json({ error: 'No primary email on user' }, { status: 400 })
        }

        const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null
        const phone = data.phone_numbers?.[0]?.phone_number ?? null

        await db.user.upsert({
          where: { clerkId: data.id },
          create: { clerkId: data.id, email: primaryEmail, name, phone },
          update: { email: primaryEmail, name, phone },
        })

        console.log(`[Clerk Webhook] ${type} → synced user ${data.id}`)
        break
      }

      case 'user.deleted': {
        // Soft approach: only delete if the user record exists.
        // Orders / payout history is preserved via FK references.
        const existing = await db.user.findUnique({ where: { clerkId: data.id } })
        if (existing) {
          await db.user.delete({ where: { clerkId: data.id } })
          console.log(`[Clerk Webhook] user.deleted → removed user ${data.id}`)
        }
        break
      }

      default:
        console.log(`[Clerk Webhook] Unhandled event type: ${type}`)
    }

    return Response.json({ received: true })
  } catch (err) {
    return handleApiError(err)
  }
}
