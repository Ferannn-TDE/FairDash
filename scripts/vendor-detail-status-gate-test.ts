/**
 * Non-ACTIVE vendor visibility — the authorization decision behind the status gate on
 * GET /api/vendors/[id].
 *
 * THE GAP THIS CLOSES. The marketplace LIST and order placement both require status ACTIVE,
 * but this detail endpoint only gated on status when ENFORCE_VENDOR_READINESS was on (off by
 * default). isOffline defaults false, so a PENDING vendor's page was reachable by DIRECT URL
 * — a visibility gap (NOT a money leak: placement rejects non-ACTIVE with VENDOR_INACTIVE).
 *
 * THE SHAPE OF THE FIX (why it's not a blunt 404): the gate hides a vendor from CUSTOMERS,
 * not from themselves — so it 404s the public while still resolving for the OWNER (previewing
 * their own storefront) and an ADMIN, mirroring the sibling menu route's owner-bypass. This
 * exercises the REAL decision function (lib/vendor-visibility) the route calls, against a
 * real database. (The route wiring around it — "only enter this branch when status !=
 * ACTIVE" — is a one-line guard verified by tsc + inspection; the AUTH decision is the part
 * with teeth, and it's what this proves.)
 *
 * Run:  npx tsx scripts/vendor-detail-status-gate-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { callerMayViewInactiveVendor } from '../lib/vendor-visibility'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const PFX = 'sgtest-'
const MAIL = '@sgtest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendorMember.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({
      data: { name: 'SG', urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' },
    })
    const owner    = await prisma.user.create({ data: { clerkId: `${PFX}o-${rand()}`, email: `${PFX}o-${rand()}${MAIL}`, name: 'Owner', role: 'vendor' } })
    const stranger = await prisma.user.create({ data: { clerkId: `${PFX}s-${rand()}`, email: `${PFX}s-${rand()}${MAIL}`, name: 'Stranger', role: 'vendor' } })

    const pending = await prisma.vendor.create({
      data: {
        eventId: ev.id, name: 'PT', slug: `${PFX}v-${rand()}`, cuisineType: 'T', status: 'PENDING',
        vendorMembers: { create: { userId: owner.id, role: 'owner' } },
      },
    })

    // ── [1] ⛔ the public (anonymous) cannot view a non-ACTIVE vendor ───────────
    console.log('\n[1] ⛔ anonymous cannot view a PENDING vendor → the route 404s')
    assert((await callerMayViewInactiveVendor(pending.id, null, false)) === false,
      'anonymous (no user, not admin) → refused')

    // ── [2] a signed-in STRANGER is also refused ───────────────────────────────
    console.log('\n[2] a signed-in stranger (not owner, not admin) → refused')
    assert((await callerMayViewInactiveVendor(pending.id, stranger.id, false)) === false,
      'stranger → refused (membership check really runs — a real user id that is NOT a member)')

    // ── [3] the OWNER may preview their own pending storefront ─────────────────
    console.log('\n[3] the OWNER previewing their own pending storefront → allowed')
    assert((await callerMayViewInactiveVendor(pending.id, owner.id, false)) === true,
      'owner (a member) → allowed')

    // ── [4] an ADMIN may resolve any non-ACTIVE vendor ─────────────────────────
    console.log('\n[4] an ADMIN → allowed (even though not a member)')
    assert((await callerMayViewInactiveVendor(pending.id, stranger.id, true)) === true,
      'admin → allowed regardless of membership')
    assert((await callerMayViewInactiveVendor(pending.id, null, true)) === true,
      'admin flag short-circuits before any user lookup')

    // ── [5] the decision is MEMBERSHIP-scoped, not user-exists ─────────────────
    // A member of ANOTHER vendor is still a stranger to THIS one — proves the check is
    // per-vendor, not "is any vendor member".
    console.log('\n[5] membership is per-vendor — a member of another vendor is still refused')
    const otherVendor = await prisma.vendor.create({
      data: {
        eventId: ev.id, name: 'Other', slug: `${PFX}v-${rand()}`, cuisineType: 'T', status: 'PENDING',
        vendorMembers: { create: { userId: stranger.id, role: 'owner' } },
      },
    })
    assert((await callerMayViewInactiveVendor(pending.id, stranger.id, false)) === false,
      "owner of a DIFFERENT vendor is refused on this one (not 'is any member')")
    assert((await callerMayViewInactiveVendor(otherVendor.id, stranger.id, false)) === true,
      '…and that same user IS allowed on the vendor they actually own')

    console.log(`\n${'─'.repeat(60)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(60)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
