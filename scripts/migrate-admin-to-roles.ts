import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { ADMIN_ROLES } from '../lib/roles'

// One-time (idempotent) migration: move any admin-family grant from the legacy
// singular publicMetadata.role into the unified publicMetadata.roles[] array, so
// there is ONE role shape everywhere. Re-running = no-op.
//   npx tsx scripts/migrate-admin-to-roles.ts

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const admins = ADMIN_ROLES as readonly string[]

  let offset = 0
  const limit = 100
  let scanned = 0, migrated = 0

  for (;;) {
    const res = await clerk.users.getUserList({ limit, offset })
    if (!res.data.length) break
    for (const u of res.data) {
      scanned++
      const meta = (u.publicMetadata ?? {}) as { role?: string; roles?: string[] }
      const singular = typeof meta.role === 'string' ? meta.role : ''
      const roles = Array.isArray(meta.roles) ? meta.roles : []

      if (admins.includes(singular) && !roles.includes(singular)) {
        const next = Array.from(new Set([...roles, singular]))
        await clerk.users.updateUserMetadata(u.id, { publicMetadata: { ...meta, roles: next } })
        migrated++
        console.log(`MIGRATE ${u.emailAddresses[0]?.emailAddress}  role='${singular}' -> roles=[${next.join(', ')}]`)
      }
    }
    offset += limit
    if (res.data.length < limit) break
  }

  console.log(`\nscanned=${scanned}  migrated=${migrated}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
