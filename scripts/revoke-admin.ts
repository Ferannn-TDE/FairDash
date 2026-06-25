import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { ADMIN_ROLES } from '../lib/roles'

// Mirror of grant-admin.ts: remove an admin-family role from a user's Clerk
// publicMetadata.roles[]. Preserves all OTHER roles, idempotent, Clerk-only
// (no DB, no credentials). Use to pull admin off an account that shouldn't have it.
//   npx tsx scripts/revoke-admin.ts <email> [admin|super_admin|event_operator]

const EMAIL = process.argv[2]
const ROLE = process.argv[3] ?? 'admin'

async function main() {
  if (!EMAIL) throw new Error('Usage: revoke-admin.ts <email> [role]')
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

  if (!before.includes(ROLE)) {
    console.log(`\nNo change — ${EMAIL} does not have '${ROLE}'.`)
    return
  }

  const roles = before.filter((r) => r !== ROLE)
  await clerk.users.updateUserMetadata(user.id, { publicMetadata: { ...meta, roles } })

  const after = await clerk.users.getUser(user.id)
  console.log(`AFTER  publicMetadata: ${JSON.stringify(after.publicMetadata)}`)
  console.log(`\nRevoked '${ROLE}' from ${EMAIL} (roles now: [${roles.join(', ')}]). No DB rows touched.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
