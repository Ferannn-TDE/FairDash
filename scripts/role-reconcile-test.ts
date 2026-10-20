/**
 * ROLE RECONCILE TEST (readiness 1.9) — Clerk roles[] (the portal doors) converge on the payee
 * rows (the gates): OrgMember → organizer, VendorMember → vendor, Runner → runner.
 *
 * Root causes found in production 2026-10-19 (docs/PRODUCTION_READINESS.md 1.9): a create path
 * that never synced, an out-of-band insert, signup-time claims with no row, a Clerk user created
 * before the webhook existed, and a purge tombstone.
 *
 *   [0] BASELINE + POSITIVE CONTROL — the classifier sees a row-without-role mismatch before any
 *       fix runs, so every "converged" below is a real change.
 *   [1] ONE CREATE HELPER (item 3) — runner / vendor+owner / vendor member / org owner each
 *       create the row AND add the role; Clerk down → the row still lands, nothing throws; a
 *       sync with nothing to add makes no Clerk write.
 *   [2] SCAN (item 3) — outside lib/payee-membership.ts, no app/lib/worker file and no non-test
 *       script creates these rows directly (nested + multi-line + raw SQL included); scanner
 *       positive-controlled.
 *   [3] RECONCILE (item 1) — adds every missing payee role, never removes one (stale claims and
 *       admin roles survive), dry run writes nothing, a second run changes nothing, one Clerk
 *       failure doesn't stop the rest and the next run finishes it; sign-in reconciles too.
 *   [4] CLERK WEBHOOK (item 4) — a user with no primary email still gets a DB row (first email,
 *       else a placeholder) and a warning is logged.
 *   [5] CONSISTENCY CHECK (item 5) — purge tombstones are expected; each other kind fails it.
 *
 * Test DB + a fake Clerk client. No network.
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/role-reconcile-test.ts
 */

import { config } from 'dotenv'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

const prisma = testPrisma()
const SLUG = 'rr19-'
const MAIL = '@rr19.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// ── Fake Clerk: in-memory users, write counter, per-user failure switch ──────────
interface FakeUser { id: string; publicMetadata: Record<string, unknown>; emailAddresses: Array<{ id: string; emailAddress: string }>; primaryEmailAddressId: string | null }
const clerkUsers = new Map<string, FakeUser>()
let updates = 0
let clerkDown = false
const failFor = new Set<string>()
const fakeClerk = {
  users: {
    async getUser(id: string) {
      if (clerkDown) throw new Error('clerk 503')
      const u = clerkUsers.get(id); if (!u) throw new Error('not found'); return u
    },
    async updateUserMetadata(id: string, p: { publicMetadata: Record<string, unknown> }) {
      if (clerkDown || failFor.has(id)) throw new Error('clerk 503')
      const u = clerkUsers.get(id)!; u.publicMetadata = p.publicMetadata; updates++; return u
    },
    async getUserList({ limit = 100, offset = 0 }: { limit?: number; offset?: number }) {
      if (clerkDown) throw new Error('clerk 503')
      const all = [...clerkUsers.values()]
      return { data: all.slice(offset, offset + limit), totalCount: all.length }
    },
  },
}
const rolesOf = (clerkId: string) => ((clerkUsers.get(clerkId)?.publicMetadata.roles as string[] | undefined) ?? []).slice().sort()

async function mkUser(roles: string[] = []) {
  const clerkId = `${SLUG}c-${rand()}`
  const u = await prisma.user.create({ data: { clerkId, email: `${SLUG}${rand()}${MAIL}`, name: 'T', role: 'customer' } })
  clerkUsers.set(clerkId, { id: clerkId, publicMetadata: { roles }, emailAddresses: [{ id: 'e1', emailAddress: u.email }], primaryEmailAddressId: 'e1' })
  return u
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: SLUG } }] } })
}

const src = (p: string) => readFileSync(p, 'utf8')
function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) { const q = join(dir, n); statSync(q).isDirectory() ? (n !== 'node_modules' && walk(q, out)) : /\.(ts|tsx)$/.test(n) && out.push(q) }
  return out
}

async function main() {
  await cleanup()
  const { __setClerkForTest } = await import('../lib/role-sync')
  __setClerkForTest(fakeClerk as any)
  const { logger } = await import('../lib/logger')
  const warns: string[] = [], errors: string[] = []
  const realWarn = logger.warn, realError = logger.error
  ;(logger as any).warn = (m: string, ...r: unknown[]) => { warns.push(m); return (realWarn as any).call(logger, m, ...r) }
  ;(logger as any).error = (m: string, ...r: unknown[]) => { errors.push(m); return (realError as any).call(logger, m, ...r) }

  const pm = await import('../lib/payee-membership')
  const rs = await import('../lib/role-sync')
  const { classifyRoleConsistency } = await import('../lib/role-consistency')
  const snapshot = async (clerkIds: string[]) => {
    const dbUsers = await prisma.user.findMany({
      where: { clerkId: { in: clerkIds } },
      select: { clerkId: true, email: true, orgMembers: { select: { id: true }, take: 1 }, vendorMembers: { select: { id: true }, take: 1 }, runner: { select: { id: true } } },
    })
    return classifyRoleConsistency(
      dbUsers.map(u => ({ clerkId: u.clerkId, email: u.email, organizer: u.orgMembers.length > 0, vendor: u.vendorMembers.length > 0, runner: !!u.runner })),
      clerkIds.filter(id => clerkUsers.has(id)).map(id => ({ id, roles: rolesOf(id) })),
    )
  }

  try {
    const ev = await prisma.event.create({ data: { name: 'RR19', urlSlug: `${SLUG}${rand()}`, status: 'ACTIVE', startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000) } })

    console.log('[0] baseline + positive control')
    const base = await mkUser([])
    await prisma.runner.create({ data: { userId: base.id, eventId: ev.id } }) // the out-of-band insert, on purpose
    const s0 = await snapshot([base.clerkId])
    assert(!s0.ok && s0.counts.rowWithoutRole.runner === 1, 'classifier sees "runner row, no runner role" before any fix')

    console.log('[1] one create helper')
    const r1 = await mkUser([])
    const runner = await pm.createRunnerRecord({ userId: r1.id, eventId: ev.id, approvalStatus: 'PENDING' })
    assert(!!runner.id && rolesOf(r1.clerkId).includes('runner'), 'createRunnerRecord → Runner row + runner role')
    const v1 = await mkUser(['admin'])
    const vendor = await pm.createVendorWithOwner({ eventId: ev.id, name: 'V', slug: `${SLUG}v-${rand()}`, cuisineType: 'T', status: 'PENDING' }, { userId: v1.id })
    const owner = await prisma.vendorMember.findFirst({ where: { vendorId: vendor.id, userId: v1.id } })
    assert(owner?.role === 'owner' && rolesOf(v1.clerkId).join() === 'admin,vendor', 'createVendorWithOwner → vendor + owner member + vendor role, admin kept')
    const staff = await mkUser([])
    await pm.addVendorMember({ vendorId: vendor.id, userId: staff.id, role: 'staff' })
    assert(rolesOf(staff.clerkId).includes('vendor'), 'addVendorMember → member + vendor role')
    const o1 = await mkUser([])
    const org = await prisma.fairOrganizer.create({ data: { name: 'O', contactEmail: `${SLUG}o-${rand()}${MAIL}` } })
    await pm.addOrgOwner(org.id, o1.id)
    await pm.addOrgOwner(org.id, o1.id)
    assert((await prisma.orgMember.count({ where: { organizerId: org.id } })) === 1 && rolesOf(o1.clerkId).includes('organizer'), 'addOrgOwner twice → one OrgMember + organizer role')
    const before = updates
    await rs.syncUserRoleMetadata(o1.id)
    assert(updates === before, 'a sync with nothing to add makes no Clerk write')
    clerkDown = true
    const down = await mkUser([])
    let threw = false
    try { await pm.createRunnerRecord({ userId: down.id, eventId: ev.id }) } catch { threw = true }
    clerkDown = false
    assert(!threw && !!(await prisma.runner.findUnique({ where: { userId: down.id } })) && errors.some(e => /roles\[\] sync failed/.test(e)),
      'Clerk down → Runner still created, nothing thrown, sync failure logged')
    assert(!rolesOf(down.clerkId).includes('runner'), 'Clerk down → role still missing (the reconcile below must heal it)')

    console.log('[2] scan')
    const { findBareMembershipCreates, MEMBERSHIP_WRITER, isTestFixture } = await import('./_membership-scan')
    assert(findBareMembershipCreates('await db.runner.create({ data })').length === 1, 'scanner control: a bare runner.create is flagged')
    assert(findBareMembershipCreates('db.vendor.create({ data: { name,\n  vendorMembers: {\n    create: { userId } } } })').length === 1, 'scanner control: a multi-line nested vendorMembers create is flagged')
    assert(findBareMembershipCreates('await tx.orgMember.createMany({ data: rows })').length === 1, 'scanner control: orgMember.createMany on any client is flagged')
    assert(findBareMembershipCreates('INSERT INTO "VendorMember" (id) VALUES ($1)').length === 1, 'scanner control: raw SQL insert is flagged')
    assert(findBareMembershipCreates('db.runner.update({ where })\n// runner.create is documented here').length === 0, 'scanner control: updates and comments are not flagged')
    const offenders = [...walk('app'), ...walk('lib'), ...walk('workers'), ...walk('scripts')]
      .filter(f => f !== MEMBERSHIP_WRITER && !isTestFixture(f))
      .filter(f => findBareMembershipCreates(src(f)).length > 0)
    assert(offenders.length === 0, `no direct membership creates outside ${MEMBERSHIP_WRITER} and test fixtures${offenders.length ? ` — ${offenders.join(', ')}` : ''}`)
    assert(findBareMembershipCreates(src(MEMBERSHIP_WRITER)).length > 0, `control: the writer itself is visible to the scanner`)

    console.log('[3] reconcile')
    const a = await mkUser([]);         await prisma.runner.create({ data: { userId: a.id, eventId: ev.id } })
    const b = await mkUser(['organizer']); const bv = await prisma.vendor.create({ data: { eventId: ev.id, name: 'B', slug: `${SLUG}b-${rand()}`, cuisineType: 'T' } })
    await prisma.vendorMember.create({ data: { vendorId: bv.id, userId: b.id, role: 'owner' } })
    const c = await mkUser(['admin']);  const co = await prisma.fairOrganizer.create({ data: { name: 'C', contactEmail: `${SLUG}c-${rand()}${MAIL}` } })
    await prisma.orgMember.create({ data: { organizerId: co.id, userId: c.id, role: 'owner' } })
    const stale = await mkUser(['vendor']) // a signup-time claim with no row
    const ids = [base, r1, v1, staff, o1, down, a, b, c, stale].map(u => u.clerkId)
    const preUpdates = updates
    const dry = await rs.reconcileAllRoles({ dryRun: true })
    assert(updates === preUpdates, 'dry run → no Clerk writes')
    assert(dry.missing.runner === 3 && dry.missing.vendor === 1 && dry.missing.organizer === 1 && dry.usersToUpdate === 5,
      `dry run counts: runner 3, vendor 1, organizer 1, users 5 (got ${JSON.stringify(dry.missing)}, ${dry.usersToUpdate})`)
    failFor.add(a.clerkId)
    const live = await rs.reconcileAllRoles({ dryRun: false })
    assert(live.updated === 4 && live.errors === 1, `one Clerk failure doesn't stop the rest: 4 updated, 1 error (got ${live.updated}, ${live.errors})`)
    failFor.clear()
    const again = await rs.reconcileAllRoles({ dryRun: false })
    assert(again.updated === 1 && rolesOf(a.clerkId).includes('runner'), 'next run finishes the failed user')
    const third = await rs.reconcileAllRoles({ dryRun: false })
    assert(third.updated === 0 && third.usersToUpdate === 0, 'third run → nothing to do (idempotent)')
    assert(rolesOf(c.clerkId).join() === 'admin,organizer', 'admin role survives the reconcile')
    assert(rolesOf(stale.clerkId).join() === 'vendor', 'a stale claim is never removed by the reconcile')
    const s3 = await snapshot(ids)
    assert(s3.counts.rowWithoutRole.runner === 0 && s3.counts.rowWithoutRole.vendor === 0 && s3.counts.rowWithoutRole.organizer === 0,
      'after the reconcile: no row is missing its role')
    assert(s3.counts.roleWithoutRow.vendor === 1 && !s3.ok, 'the stale claim is still reported (removal is out of scope)')
    // Sign-in path.
    const si = await mkUser([]); await prisma.runner.create({ data: { userId: si.id, eventId: ev.id } })
    const { handleClerkSessionCreated } = await import('../lib/clerk-user-sync')
    await handleClerkSessionCreated(si.clerkId)
    const siRow = await prisma.user.findUnique({ where: { id: si.id }, select: { lastSignInAt: true } })
    assert(!!siRow?.lastSignInAt && rolesOf(si.clerkId).includes('runner'), 'sign-in (session.created) → lastSignInAt set + missing role added')
    const worker = src('workers/order-worker.ts')
    assert(/reconcileAllRoles\(\{ dryRun: false \}\)/.test(worker) && /setInterval\(\(\) => \{ void runRoleReconcile\(\) \}, roleEveryMs\)/.test(worker) && /role reconcile OFF/.test(worker),
      'the worker runs the role reconcile on an in-process timer, and says so at boot when it is off')
    assert(/handleClerkSessionCreated\(/.test(src('app/api/webhooks/clerk/route.ts')), 'the Clerk webhook calls handleClerkSessionCreated on session.created')

    console.log('[4] Clerk webhook — no primary email')
    const { syncClerkUser } = await import('../lib/clerk-user-sync')
    const noPrimaryId = `${SLUG}np-${rand()}`
    const np = await syncClerkUser({ id: noPrimaryId, email_addresses: [{ id: 'x', email_address: `${SLUG}np${MAIL}` }], primary_email_address_id: null })
    assert(np?.email === `${SLUG}np${MAIL}`, 'no primary email, one other email → row with that email')
    const noEmailId = `${SLUG}ne-${rand()}`
    const w0 = warns.length
    const ne = await syncClerkUser({ id: noEmailId, email_addresses: [], primary_email_address_id: null })
    assert(ne?.email === `${noEmailId}@pending.invalid`, `no email at all → row with ${noEmailId}@pending.invalid`)
    assert(warns.slice(w0).some(w => /no primary email/i.test(w)), 'and a warning is logged (not a silent skip)')
    const withPrimary = `${SLUG}wp-${rand()}`
    const wp = await syncClerkUser({ id: withPrimary, email_addresses: [{ id: 'a', email_address: `${SLUG}other${MAIL}` }, { id: 'b', email_address: `${SLUG}prim${MAIL}` }], primary_email_address_id: 'b' })
    assert(wp?.email === `${SLUG}prim${MAIL}`, 'control: the primary email still wins when present')

    console.log('[5] consistency check')
    const ok = classifyRoleConsistency(
      [{ clerkId: 'purged_abc', email: 'purged+abc@fairsynq.invalid', organizer: false, vendor: false, runner: false },
       { clerkId: 'u1', email: 'a@x', organizer: true, vendor: false, runner: true }],
      [{ id: 'u1', roles: ['organizer', 'runner', 'admin'] }],
    )
    assert(ok.ok && ok.counts.tombstones === 1 && ok.counts.dbOnly === 0, 'purge tombstone → expected; consistent users → ok')
    const kinds: Array<[string, Parameters<typeof classifyRoleConsistency>, (r: ReturnType<typeof classifyRoleConsistency>) => boolean]> = [
      ['row without role', [[{ clerkId: 'u', email: 'a@x', organizer: false, vendor: false, runner: true }], [{ id: 'u', roles: [] }]], r => r.counts.rowWithoutRole.runner === 1],
      ['role without row', [[{ clerkId: 'u', email: 'a@x', organizer: false, vendor: false, runner: false }], [{ id: 'u', roles: ['vendor'] }]], r => r.counts.roleWithoutRow.vendor === 1],
      ['DB user, no Clerk user', [[{ clerkId: 'gone', email: 'a@x', organizer: false, vendor: false, runner: false }], []], r => r.counts.dbOnly === 1],
      ['Clerk user, no DB row', [[], [{ id: 'new', roles: [] }]], r => r.counts.clerkOnly === 1],
      ['look-alike tombstone (real email)', [[{ clerkId: 'purged_x', email: 'a@gmail.com', organizer: false, vendor: false, runner: false }], []], r => r.counts.dbOnly === 1 && r.counts.tombstones === 0],
    ]
    for (const [label, args, check] of kinds) {
      const r = classifyRoleConsistency(...args)
      assert(!r.ok && check(r), `${label} → fails the check`)
    }
    const script = src('scripts/role-consistency-check.ts')
    assert(/classifyRoleConsistency\(/.test(script) && /process\.exit\(\s*result\.ok\s*\?\s*0\s*:\s*1\s*\)/.test(script), 'role-consistency-check uses the classifier and exits non-zero unless ok')
  } finally {
    __setClerkForTest(null)
    ;(logger as any).warn = realWarn
    ;(logger as any).error = realError
    await cleanup()
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} role-reconcile: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => { console.error('[role-reconcile-test] FAILED:', err); await cleanup().catch(() => {}); process.exit(1) })
