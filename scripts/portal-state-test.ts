/**
 * PORTAL-STATE TEST — proves the collapse changed NOTHING about who gets in.
 *
 * lib/portal-state.ts is derivation ZERO for "may this person enter portal X, and in what
 * state?" — the gates now CALL it instead of each re-deriving the answer. That is a refactor of
 * three ACCESS BOUNDARIES, so the property that matters is not "the predicate works" but "the
 * predicate returns exactly what each gate decided before".
 *
 * ── THE EQUIVALENCE IS ASSERTED, NOT ASSUMED ─────────────────────────────────────────────────
 * Every case below runs the ORIGINAL inline gate logic (replayed verbatim from the pre-collapse
 * layouts) and the NEW predicate against the SAME seeded row, and asserts they agree on the
 * admit/refuse decision. A test that only exercised the new code would prove it self-consistent
 * — which is precisely what a silently-changed boundary also looks like.
 *
 *   [0]  BASELINE — fixtures resolve; an empty cohort FAILS rather than passing vacuously
 *   [1]  vendor    — none/active, and equivalence with the original `vendorMember.findFirst`
 *   [2]  organizer — none/pending/active/blocked, equivalence with `organizerPortalState`
 *   [3]  runner    — none/active, equivalence with the original `runner.findUnique`
 *   [4]  the ASYMMETRY, asserted rather than described: a PENDING runner is `active` (approval
 *        is a VERB gate, not a portal gate) while a PENDING organizer is `pending`
 *   [5]  door policy — shouldShowPortalDoor over the full state × portal matrix
 *   [P1] POSITIVE CONTROL on the equivalence probe itself: a deliberately WRONG predicate is
 *        caught by the same comparison. Without this, [1]-[3] could agree vacuously.
 *
 * Scoped to a fixture prefix; no global counts. Run:  npx tsx scripts/portal-state-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { organizerPortalState } from '../lib/organizer-portal-state'

const prisma = testPrisma()

const SLUG = 'pstest-'
const MAIL = '@pstest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else      { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  await prisma.runner.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.vendorMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.vendor.deleteMany({ where: { slug: { startsWith: SLUG } } })
  await prisma.event.deleteMany({ where: { urlSlug: { startsWith: SLUG } } })
}

const mkUser = () => prisma.user.create({
  data: { clerkId: `${SLUG}clerk-${rand()}`, email: `${SLUG}${rand()}${MAIL}`, name: 'PS' },
})

// ─── THE ORIGINAL GATE LOGIC, replayed verbatim from the pre-collapse layouts. ───────────────
// These exist ONLY to be compared against the new predicate. Nothing in the app calls them.

/** app/vendor/layout.tsx:22 (pre-collapse) — admit iff a VendorMember row exists. */
async function ORIGINAL_vendorAdmits(userId: string): Promise<boolean> {
  const member = await prisma.vendorMember.findFirst({ where: { userId }, select: { id: true } })
  return Boolean(member)
}

/** app/organizer/layout.tsx:42-56 (pre-collapse) — row required, then state must be ACTIVE. */
async function ORIGINAL_organizerAdmits(userId: string): Promise<boolean> {
  const orgMember = await prisma.orgMember.findFirst({
    where: { userId },
    select: {
      id: true,
      organizer: {
        select: { approvalStatus: true, rejectionReason: true, suspendedAt: true, suspendedReason: true },
      },
    },
  })
  if (!orgMember) return false
  return organizerPortalState(orgMember.organizer).state === 'ACTIVE'
}

/** app/runner/[fairSlug]/layout.tsx:32 (pre-collapse) — admit iff a Runner row exists. */
async function ORIGINAL_runnerAdmits(userId: string): Promise<boolean> {
  const runner = await prisma.runner.findUnique({ where: { userId }, select: { id: true } })
  return Boolean(runner)
}

async function main() {
  await cleanup()

  const { vendorPortalStatus, organizerPortalStatus, runnerPortalStatus, allPortalStates, shouldShowPortalDoor } =
    await import('../lib/portal-state')

  try {
    // Shared fixtures.
    const event = await prisma.event.create({
      data: {
        name: `PS ${rand()}`, urlSlug: `${SLUG}fair-${rand()}`, status: 'ACTIVE',
        startDate: new Date(Date.now() - 86_400_000), endDate: new Date(Date.now() + 86_400_000),
        venueAddress: '1 Test Way',
      },
    })
    const vendor = await prisma.vendor.create({
      data: {
        eventId: event.id, name: `PS Vendor ${rand()}`, slug: `${SLUG}v-${rand()}`,
        cuisineType: 'Test', status: 'PENDING', // deliberately PENDING — see [1]
      },
    })

    // ── [0] BASELINE ───────────────────────────────────────────────────────────────────────
    console.log('\n[0] baseline — fixtures exist and the cohort is non-empty')
    const bare = await mkUser()
    assert(Boolean(bare.id), 'a fixture user was created')
    assert(Boolean(event.id && vendor.id), 'fixture event + vendor exist')

    // ── [1] VENDOR ─────────────────────────────────────────────────────────────────────────
    console.log('\n[1] vendor — state, and equivalence with the original gate')
    const vNone = await vendorPortalStatus(bare.id)
    assert(vNone.state === 'none', `no VendorMember → 'none' (got '${vNone.state}')`)
    assert(
      (vNone.state === 'active') === (await ORIGINAL_vendorAdmits(bare.id)),
      'EQUIVALENCE: predicate and original gate agree (no row)',
    )

    const vUser = await mkUser()
    await prisma.vendorMember.create({ data: { userId: vUser.id, vendorId: vendor.id, role: 'owner' } })
    const vActive = await vendorPortalStatus(vUser.id)
    assert(vActive.state === 'active', `VendorMember exists → 'active' (got '${vActive.state}')`)
    assert(
      (vActive.state === 'active') === (await ORIGINAL_vendorAdmits(vUser.id)),
      'EQUIVALENCE: predicate and original gate agree (row exists)',
    )
    // The Vendor row above is PENDING. The gate ignores Vendor.status, and so must we —
    // a PENDING vendor WITH a member row gets the full portal. Pinned so a future "tidy-up"
    // that folds status in has to fail here first.
    const vRow = await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { status: true } })
    assert(vRow?.status === 'PENDING', 'the fixture vendor really is PENDING (control on the next assertion)')
    assert(vActive.state === 'active', "Vendor.status is NOT an input — PENDING vendor is still 'active'")

    // ── [2] ORGANIZER ──────────────────────────────────────────────────────────────────────
    console.log('\n[2] organizer — all four states, and equivalence with the original gate')
    const oNone = await organizerPortalStatus(bare.id)
    assert(oNone.state === 'none', `no OrgMember → 'none' (got '${oNone.state}')`)
    assert(oNone.view === null, 'no row → no view')
    assert(
      (oNone.state === 'active') === (await ORIGINAL_organizerAdmits(bare.id)),
      'EQUIVALENCE: agree (no row)',
    )

    const cases: Array<{ label: string; data: Record<string, unknown>; expect: string }> = [
      { label: 'APPROVED',            data: { approvalStatus: 'APPROVED' },                                  expect: 'active'  },
      { label: 'PENDING',             data: { approvalStatus: 'PENDING' },                                   expect: 'pending' },
      { label: 'REJECTED',            data: { approvalStatus: 'REJECTED', rejectionReason: 'no' },           expect: 'blocked' },
      { label: 'APPROVED+suspended',  data: { approvalStatus: 'APPROVED', suspendedAt: new Date(), suspendedReason: 'x' }, expect: 'blocked' },
    ]
    for (const c of cases) {
      const u = await mkUser()
      const org = await prisma.fairOrganizer.create({
        data: { name: `PS Org ${rand()}`, contactEmail: `${SLUG}${rand()}${MAIL}`, ...(c.data as object) },
      })
      await prisma.orgMember.create({ data: { userId: u.id, organizerId: org.id, role: 'owner' } })

      const got = await organizerPortalStatus(u.id)
      assert(got.state === c.expect, `${c.label} → '${c.expect}' (got '${got.state}')`)
      assert(
        (got.state === 'active') === (await ORIGINAL_organizerAdmits(u.id)),
        `EQUIVALENCE: agree (${c.label})`,
      )
      assert(got.view !== null, `${c.label} → view present (the gate screen renders from it)`)
    }

    // ── [3] RUNNER ─────────────────────────────────────────────────────────────────────────
    console.log('\n[3] runner — state, and equivalence with the original gate')
    const rNone = await runnerPortalStatus(bare.id)
    assert(rNone.state === 'none', `no Runner → 'none' (got '${rNone.state}')`)
    assert(
      (rNone.state === 'active') === (await ORIGINAL_runnerAdmits(bare.id)),
      'EQUIVALENCE: agree (no row)',
    )

    const rUser = await mkUser()
    await prisma.runner.create({ data: { userId: rUser.id, eventId: event.id, approvalStatus: 'APPROVED' } })
    const rActive = await runnerPortalStatus(rUser.id)
    assert(rActive.state === 'active', `Runner exists → 'active' (got '${rActive.state}')`)
    assert(rActive.eventSlug === event.urlSlug, 'eventSlug is returned for routing')
    assert(
      (rActive.state === 'active') === (await ORIGINAL_runnerAdmits(rUser.id)),
      'EQUIVALENCE: agree (row exists)',
    )

    // ── [4] THE ASYMMETRY — asserted, not merely described in a comment ─────────────────────
    console.log('\n[4] the asymmetry — PENDING runner is active, PENDING organizer is pending')
    const rPend = await mkUser()
    await prisma.runner.create({ data: { userId: rPend.id, eventId: event.id, approvalStatus: 'PENDING' } })
    const rPendState = await runnerPortalStatus(rPend.id)
    assert(rPendState.state === 'active', `PENDING runner → 'active' (approval is a VERB gate) (got '${rPendState.state}')`)
    assert(
      (rPendState.state === 'active') === (await ORIGINAL_runnerAdmits(rPend.id)),
      'EQUIVALENCE: the original gate also admits a PENDING runner — behaviour unchanged',
    )

    // ── [5] DOOR POLICY ────────────────────────────────────────────────────────────────────
    console.log('\n[5] door policy — the full state × portal matrix')
    const matrix: Array<[('vendor'|'organizer'|'runner'), string, boolean]> = [
      ['vendor',    'none',    false], ['vendor',    'active',  true ],
      ['organizer', 'none',    false], ['organizer', 'pending', false],
      ['organizer', 'active',  true ], ['organizer', 'blocked', false],
      ['runner',    'none',    false], ['runner',    'active',  true ],
      ['runner',    'pending', true ], // policy: runner pending lands on the real portal
    ]
    for (const [portal, state, expected] of matrix) {
      const got = shouldShowPortalDoor(portal, state as never)
      assert(got === expected, `door(${portal}, ${state}) = ${expected} (got ${got})`)
    }

    // allPortalStates composes the three without changing them.
    const combo = await allPortalStates(vUser.id)
    assert(combo.vendor === 'active' && combo.organizer === 'none' && combo.runner === 'none',
      `allPortalStates composes correctly (${JSON.stringify(combo)})`)

    // ── [P1] POSITIVE CONTROL on the equivalence probe ─────────────────────────────────────
    // [1]-[3] compare two implementations. If the comparison itself could not detect a
    // disagreement, every one of them would pass vacuously — which is exactly how a changed
    // access boundary would slip through. Feed it a deliberately WRONG predicate and require
    // the comparison to FAIL.
    console.log('\n[P1] PROBE CONTROL — a deliberately wrong predicate is caught')
    const WRONG_vendorAdmits = async (_userId: string) => true // "everyone is a vendor"
    const wrongAgrees = (await WRONG_vendorAdmits(bare.id)) === (await ORIGINAL_vendorAdmits(bare.id))
    assert(!wrongAgrees, 'the equivalence comparison DETECTS a wrong predicate (it does not always agree)')
    const rightAgrees =
      ((await vendorPortalStatus(bare.id)).state === 'active') === (await ORIGINAL_vendorAdmits(bare.id))
    assert(rightAgrees, 'and it still agrees for the REAL predicate (it discriminates)')

  } finally {
    await cleanup()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
  .catch(err => { console.error('FATAL', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
