import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'

// Remove the stale legacy singular publicMetadata.role field. Gates now read
// roles[] everywhere (requireAdminAuth, admin layout, middleware, RoleContext,
// /api/auth/access), so the singular field is an unread, often-inaccurate vestige.
// Clerk deletes a metadata key when set to null. Preserves roles[] and everything
// else. Idempotent, Clerk-only (no DB, no credentials).
//   npx tsx scripts/clear-legacy-role.ts <email> [<email> ...]

const EMAILS = process.argv.slice(2)

async function main() {
  if (!EMAILS.length) throw new Error('Usage: clear-legacy-role.ts <email> [<email> ...]')
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  for (const email of EMAILS) {
    const list = await clerk.users.getUserList({ emailAddress: [email] })
    const user = list.data[0]
    if (!user) { console.log(`SKIP ${email} (no Clerk user)`); continue }

    const meta = (user.publicMetadata ?? {}) as Record<string, unknown>
    if (!('role' in meta) || meta.role == null) {
      console.log(`=    ${email} — no singular role field. roles=${JSON.stringify(meta.roles ?? [])}`)
      continue
    }

    console.log(`BEFORE ${email}: ${JSON.stringify(meta)}`)
    // null deletes the key (merge); roles[] and everything else untouched.
    await clerk.users.updateUserMetadata(user.id, { publicMetadata: { role: null } })
    const after = await clerk.users.getUser(user.id)
    console.log(`AFTER  ${email}: ${JSON.stringify(after.publicMetadata)}`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
