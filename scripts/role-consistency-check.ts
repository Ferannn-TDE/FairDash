/**
 * ROLE CONSISTENCY CHECK — READ-ONLY. Counts users whose Clerk publicMetadata.roles[]
 * disagrees with their payee rows (OrgMember → organizer, VendorMember → vendor,
 * Runner → runner). Admin-family roles live only in Clerk and are not compared. Purge
 * tombstones are expected (lib/role-consistency). Exits 1 on any other disagreement, so it can
 * gate the cutover seed (PRODUCTION_READINESS 9.3).
 *
 * Sealed: one DB connection in a read-only session (verified before any read), a
 * middleware that refuses every write action, and Clerk list calls only. Prints counts,
 * never user ids or emails.
 *
 * Run (production, deliberate):
 *   CONFIRM_PROD_DB=<ref> CONFIRM_PROD_CLERK=<frontend host> ./scripts/with-prod-db.sh \
 *     npx tsx scripts/role-consistency-check.ts
 */

import { PrismaClient } from '@prisma/client'
import { createClerkClient } from '@clerk/backend'
import { assertNotProductionDatabase } from '../lib/prod-db-guard'
import { assertNotProductionClerk } from '../lib/prod-clerk-guard'
import { classifyRoleConsistency } from '../lib/role-consistency'

async function main() {
  assertNotProductionDatabase('role-consistency-check.ts')
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.set('connection_limit', '1')
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
  await db.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  // From here on, nothing but reads leaves this process.
  db.$use(async (params, next) => {
    if (!/^(find|count|aggregate|groupBy|queryRaw)/.test(params.action)) throw new Error(`write blocked: ${params.action}`)
    return next(params)
  })
  const [{ tro }] = await db.$queryRawUnsafe<{ tro: string }[]>("SELECT current_setting('transaction_read_only') AS tro")
  if (tro !== 'on') throw new Error(`session is not read-only (transaction_read_only=${tro})`)

  assertNotProductionClerk('role-consistency-check.ts')
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  try {
    const users = await db.user.findMany({
      where: { clerkId: { not: '' } },
      select: {
        clerkId: true,
        email: true,
        orgMembers: { select: { id: true }, take: 1 },
        vendorMembers: { select: { id: true }, take: 1 },
        runner: { select: { id: true } },
      },
    })

    const clerkUsers: Array<{ id: string; roles: string[] }> = []
    for (let offset = 0; ; offset += 100) {
      const page = await clerk.users.getUserList({ limit: 100, offset })
      for (const cu of page.data) {
        clerkUsers.push({ id: cu.id, roles: Array.isArray(cu.publicMetadata?.roles) ? (cu.publicMetadata.roles as string[]) : [] })
      }
      if (page.data.length < 100) break
    }

    const result = classifyRoleConsistency(
      users.map(u => ({ clerkId: u.clerkId, email: u.email, organizer: u.orgMembers.length > 0, vendor: u.vendorMembers.length > 0, runner: !!u.runner })),
      clerkUsers,
    )
    console.log(JSON.stringify(result.counts, null, 2))
    console.log(result.ok ? '✅ consistent (purge tombstones are expected)' : '❌ roles and rows disagree')
    await db.$disconnect()
    process.exit(result.ok ? 0 : 1)
  } finally {
    await db.$disconnect()
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
