import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { ADMIN_ROLES } from '../lib/roles'

// Grant an admin-family role to a user's Clerk publicMetadata.roles[].
// Admin-family roles are dashboard/script-granted (no DB membership model) and
// PRESERVED by the sync helper; vendor/organizer/runner stay DB-derived. This
// script touches ONLY the roles[] array — never DB memberships, never passwords.
// Idempotent. NO credential is ever read or written here.
//   npx tsx scripts/grant-admin.ts <email> [admin|super_admin|event_operator]

const EMAIL = process.argv[2]
const ROLE = process.argv[3] ?? 'admin'

async function main() {
  if (!EMAIL) throw new Error('Usage: grant-admin.ts <email> [role]')
  if (!(ADMIN_ROLES as readonly string[]).includes(ROLE)) {
    throw new Error(`role must be one of: ${ADMIN_ROLES.join(', ')}`)
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const list = await clerk.users.getUserList({ emailAddress: [EMAIL] })
  const user = list.data[0]
  if (!user) throw new Error(`No Clerk user for ${EMAIL}`)

  const meta = (user.publicMetadata ?? {}) as { roles?: string[] } & Record<string, unknown>
  const before = Array.isArray(meta.roles) ? meta.roles : []
  console.log(`BEFORE publicMetadata: ${JSON.stringify(meta)}`)

  if (before.includes(ROLE)) {
    console.log(`\nNo change — ${EMAIL} already has '${ROLE}'.`)
    return
  }

  const roles = Array.from(new Set([...before, ROLE]))
  await clerk.users.updateUserMetadata(user.id, { publicMetadata: { ...meta, roles } })

  const after = await clerk.users.getUser(user.id)
  console.log(`AFTER  publicMetadata: ${JSON.stringify(after.publicMetadata)}`)
  console.log(`\nGranted '${ROLE}' to ${EMAIL} (roles preserved: [${roles.join(', ')}]). No DB rows touched.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
