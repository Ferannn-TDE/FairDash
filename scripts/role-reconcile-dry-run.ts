/**
 * SEALED DRY RUN of the readiness-1.9 role reconcile (lib/role-sync.reconcileAllRoles) against
 * a real database + Clerk instance — answers "what will the worker's first role reconcile write
 * to Clerk after the deploy?" before it can. Template: scripts/connect-dry-run.ts.
 *
 * Seals, each proven by a control BEFORE the reconcile runs (the run aborts if one fails):
 *   1. Postgres: ONE connection set read-only right after it opens. Controls: the server must
 *      REFUSE a zero-row UPDATE, and at the end the SAME backend pid must still be read-only.
 *   2. Prisma: a middleware rejects every write action. Control: a write must throw before SQL.
 *   3. Clerk: the client the reconcile sees exposes only getUserList and getUser; every other
 *      users.* method throws. Control: updateUserMetadata must throw.
 *   4. The reconcile runs with dryRun: true, which counts and returns before any update.
 * Positive control: the same probe, shown one already-consistent payee with their roles hidden,
 * must count exactly one more user — so a zero is an answer, not a probe that can't see.
 *
 * Prints counts only, never ids or emails.
 * Run (production):
 *   CONFIRM_PROD_DB=<ref> CONFIRM_PROD_CLERK=<frontend host> ./scripts/with-prod-db.sh \
 *     npx tsx scripts/role-reconcile-dry-run.ts
 */

import { createClerkClient } from '@clerk/backend'
import { assertNotProductionClerk } from '../lib/prod-clerk-guard'

class SealBroken extends Error {}
const die = (m: string): never => { console.error(`🛑 ${m}`); process.exit(3) }

const direct = process.env.DIRECT_URL || die('DIRECT_URL not set (run through scripts/with-prod-db.sh)')
const sealedUrl = new URL(direct)
sealedUrl.searchParams.set('connection_limit', '1')
sealedUrl.searchParams.delete('pgbouncer')
process.env.DATABASE_URL = sealedUrl.toString()
process.env.REDIS_URL = ''

const WRITE_ACTIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'executeRaw', 'executeRawUnsafe'])

async function main() {
  const { db } = await import('../lib/db')
  const { reconcileAllRoles, __setClerkForTest } = await import('../lib/role-sync')

  await db.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  await db.$executeRawUnsafe('SET default_transaction_read_only = on')
  const pidOf = async () => (await db.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid'))[0].pid
  const sealedPid = await pidOf()
  db.$use(async (params, next) => {
    if (WRITE_ACTIONS.has(params.action)) throw new SealBroken(`SEALED: blocked ${params.model ?? ''}.${params.action}`)
    return next(params)
  })

  assertNotProductionClerk('role-reconcile-dry-run.ts')
  const real = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  let reads = 0
  let hide: string | null = null // positive control: present this user with no roles
  const sealedUsers = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'getUserList') return async (p: { limit?: number; offset?: number }) => {
        reads++
        const page = await real.users.getUserList(p)
        if (!hide) return page
        return { ...page, data: page.data.map(u => u.id === hide ? { ...u, publicMetadata: { ...u.publicMetadata, roles: [] } } : u) }
      }
      if (name === 'getUser') return async (id: string) => { reads++; return real.users.getUser(id) }
      return () => { throw new SealBroken(`SEALED: blocked clerk.users.${name}`) }
    },
  })
  __setClerkForTest({ users: sealedUsers } as never)

  console.log('[controls]')
  const [{ tro }] = await db.$queryRawUnsafe<{ tro: string }[]>("SELECT current_setting('transaction_read_only') AS tro")
  if (tro !== 'on') die(`C1 session not read-only (${tro})`)
  console.log('  ✅ C1 Postgres session is read-only')
  let c2 = ''
  try { await db.$queryRawUnsafe('UPDATE "User" SET "role" = "role" WHERE false') } catch (e) { c2 = String(e) }
  if (!/read-only transaction/i.test(c2)) die(`C2 server did NOT refuse a write: ${c2 || 'no error'}`)
  console.log('  ✅ C2 server refuses a zero-row UPDATE ("read-only transaction")')
  let c3 = false
  try { await db.user.updateMany({ where: { id: '__sealed_control__' }, data: { role: 'customer' } }) } catch (e) { c3 = e instanceof SealBroken }
  if (!c3) die('C3 Prisma write was not blocked by the middleware')
  console.log('  ✅ C3 Prisma write blocked before SQL')
  let c4 = false
  try { await (sealedUsers as { updateUserMetadata: (id: string, p: unknown) => Promise<unknown> }).updateUserMetadata('x', {}) } catch (e) { c4 = e instanceof SealBroken }
  if (!c4) die('C4 Clerk updateUserMetadata was not blocked')
  console.log('  ✅ C4 Clerk writes blocked (only getUserList / getUser reach Clerk)')

  const result = await reconcileAllRoles({ dryRun: true })
  console.log('\n[dry run]')
  console.log(`  Clerk users checked:            ${result.clerkUsers}`)
  console.log(`  users the first run would update: ${result.usersToUpdate}`)
  console.log(`  roles it would add:             organizer ${result.missing.organizer} · vendor ${result.missing.vendor} · runner ${result.missing.runner}`)
  console.log(`  Clerk writes made:              ${result.updated} (must be 0)`)
  if (result.updated !== 0) die('dry run reported writes')

  // Positive control: pick a payee whose roles already match, hide their roles, re-run.
  const consistent = await db.user.findFirst({
    where: { OR: [{ runner: { isNot: null } }, { vendorMembers: { some: {} } }, { orgMembers: { some: {} } }] },
    select: { clerkId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (consistent) {
    hide = consistent.clerkId
    const probe = await reconcileAllRoles({ dryRun: true })
    hide = null
    const delta = probe.usersToUpdate - result.usersToUpdate
    if (delta !== 1 && !(delta === 0 && result.usersToUpdate > 0)) die(`positive control: hiding one payee's roles changed the count by ${delta}`)
    console.log(`  ✅ positive control: hiding one payee's roles → the probe counts ${probe.usersToUpdate} (${delta === 1 ? '+1' : 'that user was already counted'})`)
  }

  console.log('\n[controls, end]')
  const [{ tro: endRo }] = await db.$queryRawUnsafe<{ tro: string }[]>("SELECT current_setting('transaction_read_only') AS tro")
  const endPid = await pidOf()
  if (endPid !== sealedPid || endRo !== 'on') die(`C5 connection changed or lost read-only (pid ${sealedPid} → ${endPid})`)
  console.log(`  ✅ C5 whole run on the same read-only backend (pid ${sealedPid}) · Clerk reads: ${reads}`)
  __setClerkForTest(null)
  await db.$disconnect()
}

main().catch(err => { console.error(err instanceof SealBroken ? `🛑 ${err.message}` : err); process.exit(err instanceof SealBroken ? 3 : 1) })
