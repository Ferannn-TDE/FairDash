/**
 * VENDOR OPERATOR ADMITTANCE — STEP 1 GUARD: the grandfather held, and this step is INERT.
 *
 * 20260804000000_add_vendor_member_approval_status adds VendorMember.approvalStatus with a
 * PENDING default. That ADD COLUMN sets EVERY pre-existing operator to PENDING, so the
 * hand-added grandfather UPDATE in the same migration is the only thing standing between the
 * live operators and a locked portal once enforcement ships. `prisma migrate dev` does not
 * infer that UPDATE — regenerate the migration and it silently disappears. This guard is what
 * turns "we remembered to add it" into an invariant.
 *
 * WHAT IT PROVES
 *   [0] POSITIVE CONTROL ON THE PROBE — a deliberately un-grandfathered row is DETECTED and
 *       NAMED. Without this the suite could "pass" with a probe that can never report anything
 *       (the vacuous-negative failure this repo has been bitten by repeatedly).
 *   [1] NEGATIVE CONTROL ON THE PROBE — a grandfathered row is NOT reported. So [0] is not
 *       merely a probe that flags everything.
 *   [2] THE INVARIANT — no VendorMember row anywhere is left PENDING, over a set asserted
 *       NON-EMPTY first (an empty table must never pass vacuously).
 *   [3] THE MIGRATION TEXT — the grandfather UPDATE, the four columns and the index are all
 *       still in the migration file. This is the assertion that survives a regenerated
 *       migration, which is the actual regression path.
 *   [4] INERTNESS — the step-3 enforcement sites do not read approvalStatus yet. Step 1 adds
 *       columns and changes no behaviour; this pins that claim. ⚠️ THIS BLOCK IS MEANT TO BE
 *       DELETED by the commit that adds the door gate — it asserts a property that is true only
 *       while the axis is inert, and retiring it should be a conscious act, not a surprise.
 *
 * HONEST LIMITATION: run against the local test database, [2]'s population is this suite's OWN
 * fixtures — the test DB has no real operators. The guard proves the probe works and that the
 * DB it is pointed at is clean; it cannot, from the test DB, prove production's four rows were
 * promoted. That evidence is the SELECT in the step-1 report, run against production.
 *
 * Run:  npx tsx scripts/vendor-operator-grandfather-guard.ts   (self-cleaning, prefix vogseed-)
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'

const prisma = testPrisma()

/** Self-contained fixture namespace — seeded and torn down by THIS suite, never ambient. */
const SEED_TAG = 'vogseed'
const MIGRATION = 'prisma/migrations/20260804000000_add_vendor_member_approval_status/migration.sql'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const rand = () => Math.random().toString(36).slice(2, 10)

/**
 * THE PROBE. "Which operators were left un-admitted?" — the exact question the grandfather
 * UPDATE exists to answer with 'none'. Pure over the rows it is handed, so [0] and [1] can
 * exercise it in BOTH directions without a database round-trip deciding the outcome.
 */
function unadmitted<T extends { id: string; approvalStatus: string }>(rows: T[]): T[] {
  return rows.filter(r => r.approvalStatus === 'PENDING')
}

async function allMembers() {
  return prisma.vendorMember.findMany({
    select: { id: true, userId: true, approvalStatus: true, approvedBy: true, approvedAt: true },
    orderBy: { createdAt: 'asc' },
  })
}

async function cleanup() {
  const events = await prisma.event.findMany({
    where: { urlSlug: { startsWith: SEED_TAG } }, select: { id: true },
  })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const vendors = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vendors.map(v => v.id) } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: SEED_TAG } } })
}

async function main() {
  await cleanup()
  try {
    // ── Fixture: one event, one booth, one operator ───────────────────────────────
    const ev = await prisma.event.create({
      data: {
        name: `${SEED_TAG} fair`, urlSlug: `${SEED_TAG}-${rand()}`,
        status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 86_400_000),
      },
    })
    const vendor = await prisma.vendor.create({
      data: { eventId: ev.id, name: `${SEED_TAG} booth`, slug: `${SEED_TAG}-v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
    })
    const user = await prisma.user.create({
      data: { clerkId: `${SEED_TAG}_${rand()}`, email: `${SEED_TAG}-${rand()}@vogseed.local`, name: 'Fixture Operator' },
    })

    // ── [0] POSITIVE CONTROL ON THE PROBE ─────────────────────────────────────────
    // An operator row that the grandfather did NOT reach. The probe MUST report it, and must
    // name it — a probe that reports "something is wrong" without saying which row is not
    // actionable at 6am on the day of a fair.
    console.log('\n[0] POSITIVE CONTROL: an un-grandfathered operator is DETECTED and NAMED')
    const orphan = await prisma.vendorMember.create({
      data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'PENDING' },
      select: { id: true, userId: true, approvalStatus: true, approvedBy: true, approvedAt: true },
    })
    const withOrphan = await allMembers()
    assert(withOrphan.length >= 1, `probe population is NON-EMPTY (${withOrphan.length} row(s)) — nothing below can pass vacuously`)
    const detected = unadmitted(withOrphan)
    assert(detected.length >= 1, `probe DETECTS the un-grandfathered row (${detected.length} found) — it is capable of failing`)
    assert(detected.some(r => r.id === orphan.id), `probe NAMES the offending row (${orphan.id}) — actionable, not just "something is wrong"`)

    // ── [1] NEGATIVE CONTROL ON THE PROBE ─────────────────────────────────────────
    // Apply to that row exactly what the migration's grandfather UPDATE applies. The probe must
    // now clear it — otherwise [0] proved only that the probe flags everything.
    console.log('\n[1] NEGATIVE CONTROL: once grandfathered, the SAME row is no longer reported')
    await prisma.vendorMember.update({
      where: { id: orphan.id },
      data: { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: 'system-grandfather' },
    })
    const afterFix = await allMembers()
    assert(!unadmitted(afterFix).some(r => r.id === orphan.id), 'the grandfathered row is NOT reported — the probe discriminates, it does not flag everything')

    // ── [2] THE INVARIANT ─────────────────────────────────────────────────────────
    console.log('\n[2] THE INVARIANT: no operator anywhere is left PENDING (i.e. un-admitted)')
    const all = await allMembers()
    assert(all.length >= 1, `[0] floor: ${all.length} VendorMember row(s) examined — an empty table does not pass here`)
    const left = unadmitted(all)
    assert(left.length === 0, left.length === 0
      ? `every VendorMember row is admitted — none left PENDING (${all.length} examined)`
      : `⛔ ${left.length} operator(s) left PENDING: ${left.map(r => `${r.id} (user ${r.userId})`).join(', ')}`)
    const gf = all.filter(r => r.approvedBy === 'system-grandfather')
    assert(gf.every(r => r.approvalStatus === 'APPROVED'), `every 'system-grandfather' row is APPROVED (${gf.length} such row(s))`)
    console.log(`     ℹ  population: ${all.length} total, ${gf.length} grandfathered. On the test DB these are this suite's own fixtures;`)
    console.log('        production evidence is the SELECT in the step-1 report, not this line.')

    // ── [3] THE MIGRATION TEXT ────────────────────────────────────────────────────
    // The regression that actually happens: someone re-runs `prisma migrate dev`, the file is
    // regenerated from the schema, and the hand-added UPDATE is silently gone.
    console.log('\n[3] the migration still CONTAINS the hand-added grandfather (survives regeneration)')
    const sql = readFileSync(MIGRATION, 'utf8')
    assert(/ALTER TABLE "VendorMember" ADD COLUMN\s+"approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING'/.test(sql),
      'adds approvalStatus with the PENDING default (the thing that makes a grandfather necessary)')
    for (const col of ['approvedAt', 'approvedBy', 'rejectionReason']) {
      assert(new RegExp(`ADD COLUMN\\s+"${col}"`).test(sql), `adds the ${col} audit column`)
    }
    assert(/UPDATE "VendorMember"/.test(sql), 'contains the grandfather UPDATE')
    assert(/SET "approvalStatus" = 'APPROVED'/.test(sql), "grandfather sets approvalStatus = 'APPROVED'")
    assert(/"approvedBy"\s*=\s*'system-grandfather'/.test(sql), "grandfather stamps approvedBy = 'system-grandfather' (the audit trail for a machine decision)")
    assert(/WHERE "approvalStatus" = 'PENDING'/.test(sql),
      'grandfather is scoped WHERE approvalStatus = PENDING — it can only touch rows that just took the default')
    assert(/CREATE INDEX "VendorMember_approvalStatus_idx"/.test(sql), 'creates the approvalStatus index')
    assert(!/ALTER TABLE "Vendor"\b/.test(sql) && !/UPDATE "Vendor"\b/.test(sql),
      '⛔ the migration does NOT touch Vendor (the BOOTH axis stays untouched — two independent axes)')

    // ── [4] INERTNESS — true only for step 1 ──────────────────────────────────────
    // ⚠️ DELETE THIS BLOCK in the commit that adds the door gate. It asserts that the axis is
    // not yet read, which is step 1's entire contract and step 3's entire purpose to end.
    console.log('\n[4] INERT: the enforcement sites do not read approvalStatus yet (step-1 contract)')
    for (const f of ['app/vendor/layout.tsx', 'lib/vendor-auth-cache.ts', 'app/api/orders/[id]/vendor-status/route.ts']) {
      assert(!/approvalStatus/.test(readFileSync(f, 'utf8')), `${f} does not read approvalStatus (enforcement is a later commit)`)
    }
    // lib/auth.ts is NOT scanned wholesale — it legitimately reads approvalStatus for the
    // ORGANIZER gate (requireOrganizerAuth). The step-1 claim is narrower and so is the check:
    // the VENDOR helper specifically does not consult it.
    const authSrc = readFileSync('lib/auth.ts', 'utf8')
    const vendorAuthFn = authSrc.slice(
      authSrc.indexOf('export async function requireVendorAuth'),
      authSrc.indexOf('export async function requireOrganizerAuth'),
    )
    assert(vendorAuthFn.length > 0, 'requireVendorAuth located in lib/auth.ts (probe anchor still valid)')
    assert(!/approvalStatus/.test(vendorAuthFn), 'requireVendorAuth does not read approvalStatus (enforcement is a later commit)')
    assert(/approvalStatus/.test(authSrc), 'lib/auth.ts DOES still read approvalStatus elsewhere — the organizer gate is untouched by this step')

    console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  } finally {
    await cleanup()
    console.log(`cleanup done (all ${SEED_TAG}- rows removed)`)
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1) })
