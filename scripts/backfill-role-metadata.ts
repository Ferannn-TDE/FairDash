import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClerkClient } from '@clerk/backend'
import { db } from '../lib/db'
import { syncUserRoleMetadata } from '../lib/role-sync'

// One-time (idempotent) backfill: derive Clerk publicMetadata.roles[] from each
// user's DB memberships, via the SAME sync helper used by the live mutation paths.
// Also audits the legacy unsafeMetadata.isVendor fallback. Re-running = no-op.
//   npx tsx scripts/backfill-role-metadata.ts

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  const users = await db.user.findMany({ select: { id: true, email: true, clerkId: true } })
  console.log(`Backfilling role metadata for ${users.length} users…\n`)

  let changed = 0, unchanged = 0, noClerk = 0
  let isVendorLegacy = 0
  const legacyOffenders: string[] = []

  for (const u of users) {
    if (!u.clerkId) { noClerk++; console.log(`SKIP  ${u.email} (no clerkId)`); continue }

    let before: string[] = []
    let unsafeIsVendor = false
    try {
      const cu = await clerk.users.getUser(u.clerkId)
      before = Array.isArray(cu.publicMetadata?.roles) ? (cu.publicMetadata.roles as string[]) : []
      unsafeIsVendor = (cu.unsafeMetadata as Record<string, unknown>)?.isVendor === true
    } catch {
      noClerk++; console.log(`WARN  ${u.email} (clerk user not found)`); continue
    }

    const result = await syncUserRoleMetadata(u.id)
    const after = result?.roles ?? []

    if (unsafeIsVendor) {
      isVendorLegacy++
      if (!after.includes('vendor')) legacyOffenders.push(u.email)
    }

    const same = before.length === after.length && before.every((r) => after.includes(r))
    if (same) { unchanged++; console.log(`=     ${u.email}  [${after.join(', ')}]`) }
    else { changed++; console.log(`SYNC  ${u.email}  [${before.join(', ')}] -> [${after.join(', ')}]`) }
  }

  console.log(`\n── Summary ──`)
  console.log(`total=${users.length}  changed=${changed}  unchanged=${unchanged}  noClerk=${noClerk}`)
  console.log(`\n── unsafeMetadata.isVendor audit ──`)
  console.log(`users with isVendor set: ${isVendorLegacy}`)
  if (legacyOffenders.length)
    console.log(`  ⚠ isVendor WITHOUT a VendorMember row (would lose vendor access if fallback removed): ${legacyOffenders.join(', ')}`)
  else
    console.log(`  ✓ every isVendor user also has a VendorMember row — legacy fallback is safe to remove`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
