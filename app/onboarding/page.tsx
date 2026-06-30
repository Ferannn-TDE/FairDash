import { currentUser, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { safeRedirect } from '@/lib/safe-redirect'
import { ensureOrganizerBootstrap } from '@/lib/organizer-bootstrap'

const VALID_ROLES = ['customer', 'vendor', 'organizer', 'runner'] as const
type Role = (typeof VALID_ROLES)[number]

const REDIRECT_MAP: Record<Role, string> = {
  customer: '/fairs',
  vendor: '/become-vendor',
  organizer: '/organizer',
  runner: '/become-driver',
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; redirect?: string }>
}) {
  // Next 16: searchParams is async — must be awaited before property access.
  // (Reading it synchronously silently yields undefined, which is why ?role=
  // appeared to "drop" on our own side.)
  const { role: roleParam, redirect: redirectParam } = await searchParams

  const user = await currentUser()
  if (!user) redirect('/sign-in/customer')

  const raw = roleParam ?? 'customer'
  const role: Role = (VALID_ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : 'customer'

  // Profile fields (same shape the Clerk webhook's syncUser derives).
  const primaryEmail = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId
  )?.emailAddress
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
  const phone = user.phoneNumbers?.[0]?.phoneNumber ?? null
  const avatarUrl = user.imageUrl ?? null
  const isActive = !user.banned

  // Ensure the DB User exists NOW rather than depending on the async user.created
  // webhook having landed — the organizer bootstrap below needs the DB user id, and
  // we must not race webhook delivery on the signup-critical path.
  let dbUserId: string | null = null
  if (primaryEmail) {
    const dbUser = await db.user.upsert({
      where: { clerkId: user.id },
      create: { clerkId: user.id, email: primaryEmail, name, phone, avatarUrl, isActive, role },
      update: { email: primaryEmail, name, phone, avatarUrl, isActive, role },
      select: { id: true },
    })
    dbUserId = dbUser.id
  }

  const existingRoles = Array.isArray(user.publicMetadata?.roles)
    ? (user.publicMetadata.roles as string[])
    : []

  // We write BOTH singular `role` and `roles[]` here, deliberately:
  //   • roles[]  — the GATING source of truth (lib/roles.ts, RoleContext, every
  //                portal guard read this). Written directly here so it's present
  //                from signup, before any membership row exists (vendor/runner/
  //                customer have no membership at signup).
  //   • role     — legacy singular field. Now UNREAD as a signal (the organizer
  //                bootstrap below decides off `role` from searchParams, not off this
  //                metadata field), but still written for continuity; full retirement
  //                is a separate logged cleanup.
  const client = await clerkClient()
  await client.users.updateUser(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      role,
      roles: Array.from(new Set([...existingRoles, role])),
    },
  })

  // Organizer self-signup: provision FairOrganizer + owner OrgMember SYNCHRONOUSLY,
  // before the redirect to /organizer, so the portal's DB authority check (and
  // requireOrganizerAuth) pass on first load. Idempotent + concurrency-safe; see
  // lib/organizer-bootstrap.ts. (Vendor/runner provision later, per-event.)
  if (role === 'organizer' && dbUserId && primaryEmail) {
    await ensureOrganizerBootstrap(dbUserId, { name, email: primaryEmail, phone })
  }

  const destination = safeRedirect(redirectParam, REDIRECT_MAP[role])
  redirect(destination)
}
