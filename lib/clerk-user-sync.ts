import { db } from './db'
import { logger } from './logger'
import { ensureDbUser } from './ensure-db-user'
import { syncUserRoleMetadata } from './role-sync'

// Clerk lifecycle → DB, for app/api/webhooks/clerk (moved here so it can be tested without svix).

export interface ClerkUserPayload {
  id: string
  email_addresses?: Array<{ email_address: string; id: string }>
  primary_email_address_id?: string | null
  first_name?: string | null
  last_name?: string | null
  phone_numbers?: Array<{ phone_number: string }>
  image_url?: string
  banned?: boolean
  public_metadata?: Record<string, unknown>
}

const VALID_ROLES = ['customer', 'vendor', 'organizer', 'runner'] as const
type AppRole = (typeof VALID_ROLES)[number]

/**
 * Mirror a Clerk user into the DB. Every Clerk user gets a row: the primary email, else any
 * email, else a `<clerkId>@pending.invalid` placeholder (the same fallback checkout uses).
 * A user with no primary email used to be skipped silently, which is how a Clerk user can
 * end up with no DB row (readiness 1.9); it is now a row plus a warning.
 */
export async function syncClerkUser(data: ClerkUserPayload) {
  const emails = data.email_addresses ?? []
  const primary = emails.find(e => e.id === data.primary_email_address_id)?.email_address
  const email = primary ?? emails[0]?.email_address ?? `${data.id}@pending.invalid`
  if (!primary) {
    logger.warn('[Clerk Webhook] user has no primary email — row keyed on a fallback address', {
      clerkId: data.id, fallback: emails[0] ? 'first email' : 'placeholder',
    })
  }

  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null
  const phone = data.phone_numbers?.[0]?.phone_number ?? null
  const avatarUrl = data.image_url ?? null
  const isActive = !data.banned

  // Legacy singular role — mirrored into DB user.role for continuity only. It is NO
  // LONGER a signal: organizer provisioning is synchronous in app/onboarding/page.tsx
  // (see lib/organizer-bootstrap.ts), and gating reads roles[] via lib/roles.ts.
  const rawRole = data.public_metadata?.role as string | undefined
  const role: AppRole = (VALID_ROLES as readonly string[]).includes(rawRole ?? '')
    ? (rawRole as AppRole)
    : 'customer'

  // ensureDbUser, NOT a bare upsert — see lib/ensure-db-user.ts. The old upsert keyed only
  // on clerkId while `email` is @unique too, so a row owning this email under a stale
  // clerkId sent it into create → P2002 → a 500 that svix then retries forever.
  const { user } = await ensureDbUser(data.id, { email, name, phone, avatarUrl, isActive, role })
  return user
}

/**
 * On each sign-in: stamp lastSignInAt and add any payee role the user's rows back but Clerk
 * is missing (readiness 1.9). Best-effort on the role half — the worker's reconcile retries.
 */
export async function handleClerkSessionCreated(clerkId: string): Promise<void> {
  await db.user.updateMany({ where: { clerkId }, data: { lastSignInAt: new Date() } })
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
  if (!user) return
  try {
    await syncUserRoleMetadata(user.id)
  } catch (err) {
    logger.error('[Clerk Webhook] sign-in role reconcile failed; the worker reconcile retries', {
      clerkId, err: err instanceof Error ? err.message : String(err),
    })
  }
}
