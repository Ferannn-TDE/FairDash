import { headers } from 'next/headers'
import { Webhook } from 'svix'
import { handleApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import { syncClerkUser, handleClerkSessionCreated, type ClerkUserPayload } from '@/lib/clerk-user-sync'
import { softDeleteClerkUser } from '@/lib/delete-clerk-user'

// POST /api/webhooks/clerk
// Verifies the svix signature and syncs Clerk user lifecycle events to our DB.
// Configure in Clerk Dashboard → Webhooks → endpoint: /api/webhooks/clerk
// Events: user.created, user.updated, user.deleted, session.created

type ClerkWebhookPayload = {
  type: string
  data: ClerkUserPayload & {
    // session.* fields
    user_id?: string
  }
}

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
  if (!webhookSecret) {
    logger.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not set')
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

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

  try {
    switch (event.type) {
      case 'user.created': {
        await syncClerkUser(event.data)
        logger.info('[Clerk Webhook] user.created synced', { userId: event.data.id })
        break
      }

      case 'user.updated': {
        await syncClerkUser(event.data)
        logger.info('[Clerk Webhook] user.updated synced', { userId: event.data.id })
        break
      }

      case 'user.deleted': {
        // Soft-deletes when the user has orders (Order_customerId_fkey is ON DELETE
        // RESTRICT — a hard delete there is impossible, and throwing made svix retry
        // forever). See lib/delete-clerk-user.ts.
        const res = await softDeleteClerkUser(event.data.id)
        logger.info('[Clerk Webhook] user.deleted handled', {
          userId: event.data.id,
          outcome: res.outcome,
        })
        break
      }

      case 'session.created': {
        // lastSignInAt + add any payee role the rows back but Clerk lacks (readiness 1.9).
        if (event.data.user_id) await handleClerkSessionCreated(event.data.user_id)
        break
      }

      default:
        logger.debug('[Clerk Webhook] unhandled event', { type: event.type })
    }

    return Response.json({ received: true })
  } catch (err) {
    return handleApiError(err)
  }
}
