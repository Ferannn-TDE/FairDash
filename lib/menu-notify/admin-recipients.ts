// WHO THE STRICT ADMINS ARE, for menu alerts on a fair with no organizer (audit H5, step 3).
//
// Strict admins (admin | super_admin, never event_operator) exist only as Clerk
// publicMetadata.roles; AdminUser is never written. So the list comes from Clerk, paged the same
// way as reconcileAllRoles (lib/role-sync.ts), and filtered with hasStrictAdminRole.
//
// Same client rules as lib/role-sync.ts: @clerk/backend directly (works in the worker and in
// scripts), the production-Clerk guard on first use, and a test seam so suites never call Clerk.

import { createClerkClient } from '@clerk/backend'
import { assertNotProductionClerk } from '../prod-clerk-guard'
import { hasStrictAdminRole } from '../roles'

type ClerkLike = Pick<ReturnType<typeof createClerkClient>, 'users'>
let _clerk: ClerkLike | null = null
let _testClerk: ClerkLike | null = null

/** Test seam: route every Clerk call here to a fake (null restores the real client). */
export function __setClerkForTest(fake: ClerkLike | null) { _testClerk = fake }

function getClerk(): ClerkLike {
  if (_testClerk) return _testClerk
  if (!_clerk) {
    if (!process.env.CLERK_SECRET_KEY) {
      throw new Error('Cannot list FairSynq admins for a menu alert: CLERK_SECRET_KEY is not set')
    }
    assertNotProductionClerk('lib/menu-notify/admin-recipients')
    _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  }
  return _clerk
}

const PAGE = 100

/** Clerk ids of every strict admin. event_operator and platform_manager are left out. */
export async function listStrictAdminClerkIds(): Promise<string[]> {
  const clerk = getClerk()
  const ids: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await clerk.users.getUserList({ limit: PAGE, offset })
    const users = page.data as Array<{ id: string; publicMetadata: Record<string, unknown> }>
    for (const u of users) if (hasStrictAdminRole(u.publicMetadata)) ids.push(u.id)
    if (users.length < PAGE) break
  }
  return ids
}
