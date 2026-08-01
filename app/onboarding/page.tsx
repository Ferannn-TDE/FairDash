import { currentUser, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { safeRedirect } from '@/lib/safe-redirect'
import { ensureOrganizerBootstrap } from '@/lib/organizer-bootstrap'
import { ensureDbUser } from '@/lib/ensure-db-user'

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

  // Role intent, in priority order:
  //   1. ?role= — the explicit hint from the redirect.
  //   2. unsafeMetadata.intendedRole — written atomically at SignUp; survives even
  //      if the query is ever lost (Clerk redirect, cookie timing). The authority.
  //   3. 'customer' — only when neither is present (a plain customer signup).
  const intendedRole = typeof user.unsafeMetadata?.intendedRole === 'string'
    ? (user.unsafeMetadata.intendedRole as string)
    : undefined
  const raw = roleParam ?? intendedRole ?? 'customer'
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
  //
  // Via ensureDbUser, NOT a bare upsert: `email` is @unique too, so a row already owning
  // this email under a stale clerkId made the old upsert fall through to create and die
  // with P2002 — a permanent 500 on this page for that person (prod, 2026-08-01).
  let dbUserId: string | null = null
  if (primaryEmail) {
    const { user: dbUser } = await ensureDbUser(user.id, {
      email: primaryEmail, name, phone, avatarUrl, isActive, role,
    })
    dbUserId = dbUser.id
  }

  // ⛔ THIS PAGE NO LONGER WRITES roles[]. ⛔
  //
  // It used to: `roles: [...existingRoles, role]`, granted at SIGNUP, deliberately "before any
  // membership row exists". That single line was the source of a whole bug class, because
  // roles[] is what renders the PORTAL DOORS (MarketplaceNavbar, MarketplaceLanding) while the
  // GATES read membership rows (VendorMember / OrgMember / Runner). Granting here made the two
  // disagree by construction, in both directions:
  //
  //   • the door appeared for someone with no row — they clicked "Vendor Dashboard", hit the
  //     gate, and were told they were unauthorized in their own account;
  //   • and lib/role-sync.ts, recomputing roles[] from the rows, correctly found no row and
  //     DROPPED the grant — so acquiring a second role silently revoked the first.
  //
  // Both symptoms, one cause: a claim written before the fact it claims. Roles are now written
  // exactly where the fact becomes true — the membership-creation sites, which already call
  // syncUserRoleMetadata (app/api/vendors/route.ts, lib/organizer-bootstrap.ts, and now
  // app/api/drivers/route.ts). Every entry in roles[] is therefore DB-backed by construction,
  // and the door appears iff the gate would open.
  //
  // WHAT THIS PAGE STILL DOES, and why routing sign-in through it (RoleAuthCard) still matters:
  // it is the ROUTER INTO role acquisition, not the writer of it. REDIRECT_MAP sends vendor to
  // /become-vendor and runner to /become-driver, and the organizer branch below provisions the
  // OrgMember synchronously. That is how an existing account picks up a second role.
  //
  // The legacy singular `role` is still mirrored for continuity (nothing reads it — see the DB
  // column note in schema.prisma), and skipped when it would be a no-op so the sign-in hop does
  // not spend a Clerk round-trip on a field no one consults.
  if (user.publicMetadata?.role !== role) {
    const client = await clerkClient()
    await client.users.updateUser(user.id, {
      publicMetadata: { ...user.publicMetadata, role },
    })
  }

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
