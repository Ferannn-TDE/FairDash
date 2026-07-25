/**
 * Vendor.slug per-fair uniqueness — the acceptance test for the constraint swap +
 * resolver sweep.
 *
 * This scenario COULD NOT EXIST before the migration: two vendors sharing a slug at
 * two different fairs. That's the whole point — it proves both halves at once:
 *   1. the migration actually relaxed global → per-fair (the second create succeeds), and
 *   2. the resolver fix serves the RIGHT fair's vendor for a shared slug (the bug the
 *      relaxation would otherwise activate).
 *
 * It exercises the REAL resolveVendorWhere the routes use, against real rows.
 *
 * Run:  npx tsx scripts/vendor-slug-per-fair-test.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { resolveVendorWhere } from '../lib/resolve-vendor'

const prisma = testPrisma()
const SLUG = 'slugtest-'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
}

/** The exact query the routes run: findFirst over resolveVendorWhere's clause. */
async function resolve(param: string, fairSlug?: string | null) {
  return prisma.vendor.findFirst({
    where: await resolveVendorWhere(param, fairSlug),
    select: { id: true, eventId: true, slug: true },
  })
}

async function main() {
  await cleanup()
  try {
    const mkEvent = () => prisma.event.create({
      data: { name: `SlugTest ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' },
    })
    const fairA = await mkEvent()
    const fairB = await mkEvent()
    const SHARED = 'randys-bbq'

    // ── [1] The migration is real: the SAME slug at TWO fairs now COEXISTS ──────
    console.log('\n[1] the same slug at two different fairs can now coexist (was impossible under global-unique)')
    const vA = await prisma.vendor.create({ data: { eventId: fairA.id, name: "Randy's BBQ (A)", slug: SHARED, cuisineType: 'BBQ', status: 'ACTIVE' } })
    let secondCreateSucceeded = false
    let vB: { id: string; slug: string; eventId: string } | null = null
    try {
      vB = await prisma.vendor.create({ data: { eventId: fairB.id, name: "Randy's BBQ (B)", slug: SHARED, cuisineType: 'BBQ', status: 'ACTIVE' } })
      secondCreateSucceeded = true
    } catch { /* would throw P2002 under the old global unique */ }
    assert(secondCreateSucceeded, 'creating "randys-bbq" at Fair B succeeds while it already exists at Fair A')
    assert(vA.slug === vB!.slug && vA.eventId !== vB!.eventId, 'two distinct vendors, same slug, different fairs')

    // ── [2] Per-fair uniqueness is still ENFORCED (not just dropped) ────────────
    console.log('\n[2] within ONE fair the slug is still unique (we scoped it, did not remove it)')
    let dupeInSameFairRejected = false
    try {
      await prisma.vendor.create({ data: { eventId: fairA.id, name: 'Dupe', slug: SHARED, cuisineType: 'BBQ', status: 'ACTIVE' } })
    } catch (e: any) { dupeInSameFairRejected = e?.code === 'P2002' }
    assert(dupeInSameFairRejected, 'a second "randys-bbq" in the SAME fair is still rejected (P2002)')

    // ── [3] ⛔ THE RESOLVER: a shared slug resolves to the RIGHT fair's vendor ──
    console.log('\n[3] ⛔ the resolver serves each fair its OWN "randys-bbq" (the bug the migration would otherwise open)')
    const rA = await resolve(SHARED, fairA.urlSlug)
    const rB = await resolve(SHARED, fairB.urlSlug)
    assert(rA?.id === vA.id, `/fair/A → Fair A's Randy's (got the right vendor)`)
    assert(rB?.id === vB!.id, `/fair/B → Fair B's Randy's (got the right vendor)`)
    assert(rA?.id !== rB?.id, 'the two fairs resolve the shared slug to DIFFERENT vendors')

    // ── [4] Safety: a bare slug with NO fair refuses to guess ───────────────────
    console.log('\n[4] a bare slug with NO fair context resolves to nothing (refuses to serve an arbitrary fair)')
    const bare = await resolve(SHARED, null)
    assert(bare === null, 'no fair → no match (id-only clause; the ambiguous bare-slug path is closed)')
    const bareUnknownFair = await resolve(SHARED, 'slugtest-does-not-exist')
    assert(bareUnknownFair === null, 'unknown fair → no match (never widens to an unscoped slug)')

    // ── [5] id resolution stays unambiguous (list/dashboard callers unchanged) ──
    console.log('\n[5] cuid id still resolves unambiguously, with or without a fair')
    const byIdNoFair = await resolve(vA.id, null)
    assert(byIdNoFair?.id === vA.id, 'id with no fair → the vendor (id is globally unique)')
    const byIdWrongFair = await resolve(vA.id, fairB.urlSlug)
    assert(byIdWrongFair?.id === vA.id, 'id wins even under a different fair (the id branch is unambiguous)')

    console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(60)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
