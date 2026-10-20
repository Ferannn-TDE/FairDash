/**
 * ROLE CONSISTENCY CHECK — READ-ONLY. Counts users whose Clerk publicMetadata.roles[]
 * disagrees with their payee rows (OrgMember → organizer, VendorMember → vendor,
 * Runner → runner). Admin-family roles live only in Clerk and are not compared.
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

const PAYEE_ROLES = ['organizer', 'vendor', 'runner'] as const
type PayeeRole = (typeof PAYEE_ROLES)[number]

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
        orgMembers: { select: { id: true }, take: 1 },
        vendorMembers: { select: { id: true }, take: 1 },
        runner: { select: { id: true } },
      },
    })
    const dbRoles = new Map<string, Set<PayeeRole>>()
    for (const u of users) {
      const r = new Set<PayeeRole>()
      if (u.orgMembers.length) r.add('organizer')
      if (u.vendorMembers.length) r.add('vendor')
      if (u.runner) r.add('runner')
      dbRoles.set(u.clerkId, r)
    }

    const clerkRoles = new Map<string, Set<string>>()
    for (let offset = 0; ; offset += 100) {
      const page = await clerk.users.getUserList({ limit: 100, offset })
      for (const cu of page.data) {
        const roles = Array.isArray(cu.publicMetadata?.roles) ? (cu.publicMetadata.roles as string[]) : []
        clerkRoles.set(cu.id, new Set(roles))
      }
      if (page.data.length < 100) break
    }

    const missing: Record<PayeeRole, number> = { organizer: 0, vendor: 0, runner: 0 }
    const extra: Record<PayeeRole, number> = { organizer: 0, vendor: 0, runner: 0 }
    let mismatchedUsers = 0, dbOnly = 0
    for (const [clerkId, rows] of dbRoles) {
      const meta = clerkRoles.get(clerkId)
      if (!meta) { dbOnly++; continue }
      let bad = false
      for (const r of PAYEE_ROLES) {
        if (rows.has(r) && !meta.has(r)) { missing[r]++; bad = true }
        if (!rows.has(r) && meta.has(r)) { extra[r]++; bad = true }
      }
      if (bad) mismatchedUsers++
    }
    const clerkOnly = [...clerkRoles.keys()].filter(id => !dbRoles.has(id)).length

    console.log(JSON.stringify({
      dbUsers: dbRoles.size,
      clerkUsers: clerkRoles.size,
      compared: dbRoles.size - dbOnly,
      mismatchedUsers,
      roleInRowsButNotInClerk: missing,
      roleInClerkButNoRow: extra,
      dbUsersWithNoClerkUser: dbOnly,
      clerkUsersWithNoDbRow: clerkOnly,
    }, null, 2))
  } finally {
    await db.$disconnect()
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
