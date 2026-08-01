import { headers } from 'next/headers'
import { Webhook } from 'svix'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import { ensureDbUser } from '@/lib/ensure-db-user'
import { softDeleteClerkUser } from '@/lib/delete-clerk-user'

// POST /api/webhooks/clerk
// Verifies the svix signature and syncs Clerk user lifecycle events to our DB.
// Configure in Clerk Dashboard → Webhooks → endpoint: /api/webhooks/clerk
// Events: user.created, user.updated, user.deleted, session.created

type ClerkEmailAddress = { email_address: string; id: string }

type ClerkWebhookPayload = {
  type: string
  data: {
    // user.* fields
    id: string
    email_addresses?: ClerkEmailAddress[]
    primary_email_address_id?: string
    first_name?: string | null
    last_name?: string | null
    phone_numbers?: Array<{ phone_number: string }>
    image_url?: string
    banned?: boolean
    public_metadata?: Record<string, unknown>
    // session.* fields
    user_id?: string
  }
}

const VALID_ROLES = ['customer', 'vendor', 'organizer', 'runner'] as const
type AppRole = (typeof VALID_ROLES)[number]

async function syncUser(data: ClerkWebhookPayload['data']) {
  const primaryEmail = data.email_addresses?.find(
    (e) => e.id === data.primary_email_address_id
  )?.email_address

  if (!primaryEmail) return null

  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null
  const phone = data.phone_numbers?.[0]?.phone_number ?? null
  const avatarUrl = data.image_url ?? null
  const isActive = !data.banned

  // Legacy singular role — mirrored into DB user.role for continuity only. It is NO
  // LONGER a signal: organizer provisioning is now synchronous in
  // app/onboarding/page.tsx (see lib/organizer-bootstrap.ts), and gating reads roles[]
  // via lib/roles.ts. Nothing live reads this field; slated for a separate retirement.
  const rawRole = data.public_metadata?.role as string | undefined
  const role: AppRole = (VALID_ROLES as readonly string[]).includes(rawRole ?? '')
    ? (rawRole as AppRole)
    : 'customer'

  // ensureDbUser, NOT a bare upsert — see lib/ensure-db-user.ts. The old upsert keyed only
  // on clerkId while `email` is @unique too, so a row owning this email under a stale
  // clerkId sent it into create → P2002 → a 500 that svix then retries forever.
  const { user } = await ensureDbUser(data.id, {
    email: primaryEmail, name, phone, avatarUrl, isActive, role,
  })

  // NOTE: organizer bootstrap (FairOrganizer + owner OrgMember) is NOT done here.
  // It runs synchronously in app/onboarding/page.tsx so the OrgMember exists before
  // the portal's DB authority check — the webhook only mirrors Clerk lifecycle → DB.
  // (Vendor/Runner records are event-scoped and created when joining an event.)

  return user
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
        await syncUser(event.data)
        logger.info('[Clerk Webhook] user.created synced', { userId: event.data.id })
        break
      }

      case 'user.updated': {
        await syncUser(event.data)
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
        if (event.data.user_id) {
          await db.user.updateMany({
            where: { clerkId: event.data.user_id },
            data: { lastSignInAt: new Date() },
          })
        }
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
