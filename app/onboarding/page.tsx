import { currentUser, clerkClient } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

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
  if (!user) redirect('/login')

  const raw = searchParams.role ?? 'customer'
  const role: Role = (VALID_ROLES as readonly string[]).includes(raw)
    ? (raw as Role)
    : 'customer'

  const existingRoles = Array.isArray(user.publicMetadata?.roles)
    ? (user.publicMetadata.roles as string[])
    : []

  const client = await clerkClient()
  await client.users.updateUser(user.id, {
    publicMetadata: {
      ...user.publicMetadata,
      role,
      roles: Array.from(new Set([...existingRoles, role])),
    },
  })

  const destination = searchParams.redirect || REDIRECT_MAP[role]
  redirect(destination)
}
