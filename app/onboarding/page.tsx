import { currentUser, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { safeRedirect } from '@/lib/safe-redirect'

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
  searchParams: { role?: string; redirect?: string }
}) {
  const user = await currentUser()
  if (!user) redirect('/sign-in/customer')

  const raw = searchParams.role ?? 'customer'
  const role: Role = (VALID_ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : 'customer'

  const existingRoles = Array.isArray(user.publicMetadata?.roles)
    ? (user.publicMetadata.roles as string[])
    : []

  // We write BOTH singular `role` and `roles[]` here, deliberately:
  //   • roles[]  — the GATING source of truth (lib/roles.ts, RoleContext, every
  //                portal guard read this). Written directly here (not via the
  //                membership-derived syncUserRoleMetadata) so it's present from
  //                signup, before any membership row exists.
  //   • role     — RETAINED as the SIGNUP-BOOTSTRAP SIGNAL. The Clerk webhook
  //                (app/api/webhooks/clerk/route.ts:48,62) reads singular role to
  //                bootstrap a FairOrganizer for new organizers. It is NOT used for
  //                gating. Do NOT remove the singular `role` without re-architecting
  //                the onboarding→webhook signup pair (the webhook would lose its
  //                signal). NOTE: the webhook's bootstrap TRIGGER is under
  //                investigation — it's gated on isNew (user.created) but this write
  //                fires user.updated, so the bootstrap may not actually run here.
  //                See the webhook's comment before deriving any conclusions.
  const client = await clerkClient()
  await client.users.updateUser(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      role,
      roles: Array.from(new Set([...existingRoles, role])),
    },
  })

  const destination = safeRedirect(searchParams.redirect, REDIRECT_MAP[role])
  redirect(destination)
}
