/**
 * ESCALATION GUARD (Commit 2, U5) — the operational read-models + the admin-release handle.
 * The surfaces must present the HANDLE, not just the strand: each stranded row carries its party
 * and the action its reason names; the vendor's returns view is a NEW, VOS-independent query; and
 * an admin can release a stranded PRE-collection order on the runner's behalf.
 *
 *   [0] BASELINE   — nothing stranded / no returns → empty lists.
 *   [1] STRANDED   — one per reason → right action (release/refund/await_vendor) + party attached;
 *                    a voided stranded order is excluded.
 *   [2] RETURNS    — a returnRequestedAt order on THIS vendor shows; one on another vendor doesn't;
 *                    a voided one doesn't.
 *   [3] ADMIN REL. — admin releases a stranded CLAIMED order → pool (custody by:admin); a
 *                    COLLECTED (unreachable) order refuses (already_collected → that's a refund).
 *
 * Seeds a throwaway (never-protected) event and cleans up.
 * Run:  npx tsx scripts/test-escalation-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, StrandedReason } from '@prisma/client'
import { listStrandedForEvent, listReturnsForVendor } from '../lib/strand-escalation'
import { adminReleaseStranded } from '../lib/release-order'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'escal-', MAIL = '@escal.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `ESC ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string, extra: Record<string, unknown> = {}) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer', ...extra } })).id
    const runnerUser = await mkUser('Runner Rae', { phone: '+15551234567' })
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: runnerUser, status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `Taco Stand ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const otherVendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `Other ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    const mkOrder = async (extra: Record<string, unknown> = {}, forVendor = vendor.id) => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: await mkUser('c'), vendorId: forVendor,
        status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id, dispatchedAt: new Date(),
        subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'Casey C', customerPhone: '+10000000000',
        placedAt: new Date(), ...extra,
      } })
      await prisma.vendorOrderStatus.create({ data: { orderId: o.id, vendorId: forVendor, status: 'READY' } })
      return o
    }
    const strand = (reason: StrandedReason, extra: Record<string, unknown> = {}) => mkOrder({ strandedAt: new Date(), strandedReason: reason, ...extra })

    // ── [0] BASELINE ────────────────────────────────────────────────────────────
    console.log('[0] baseline: nothing stranded, no returns')
    assert((await listStrandedForEvent(ev.id)).length === 0, 'no stranded rows')
    assert((await listReturnsForVendor(vendor.id)).length === 0, 'no returns rows')

    // ── [1] STRANDED — one per reason, with the right action + party ────────────
    console.log('\n[1] each stranded reason carries its action + party')
    const claimed = await strand(StrandedReason.CLAIMED_NOT_COLLECTED, { collectedAt: null })
    const unreach = await strand(StrandedReason.RUNNER_UNREACHABLE_WITH_FOOD, { collectedAt: new Date() })
    const awaiting = await strand(StrandedReason.AWAITING_VENDOR_CONFIRMATION, { collectedAt: new Date(), returnRequestedAt: new Date() })
    const voidedStranded = await strand(StrandedReason.CLAIMED_NOT_COLLECTED, { voidedAt: new Date(), voidReason: 'test' })
    const stranded = await listStrandedForEvent(ev.id)
    const byId = (id: string) => stranded.find(s => s.orderId === id)
    assert(stranded.length === 3, 'exactly 3 stranded (the voided one is excluded)')
    assert(byId(claimed.id)?.action === 'release', 'CLAIMED → action release')
    assert(byId(unreach.id)?.action === 'refund', 'UNREACHABLE → action refund')
    assert(byId(awaiting.id)?.action === 'await_vendor', 'AWAITING → action await_vendor')
    assert(byId(claimed.id)?.runner?.name === 'Runner Rae' && byId(unreach.id)?.runner?.phone === '+15551234567', 'runner name/phone attached (the handle for the runner reasons)')
    assert(byId(awaiting.id)?.vendor?.name?.startsWith('Taco Stand') === true, 'vendor attached for the AWAITING reason')
    assert(!byId(voidedStranded.id), 'the voided stranded order is absent')

    // ── [2] RETURNS — VOS-scoped, this vendor only, not voided ──────────────────
    console.log('\n[2] the vendor returns view is scoped + VOS-independent')
    const myReturn = await mkOrder({ returnRequestedAt: new Date() }, vendor.id)
    const otherReturn = await mkOrder({ returnRequestedAt: new Date() }, otherVendor.id)
    const voidedReturn = await mkOrder({ returnRequestedAt: new Date(), voidedAt: new Date(), voidReason: 'test' }, vendor.id)
    const returns = await listReturnsForVendor(vendor.id)
    const rIds = returns.map(r => r.orderId)
    assert(rIds.includes(myReturn.id), 'a return on this vendor shows')
    assert(!rIds.includes(otherReturn.id), 'a return on another vendor does NOT show')
    assert(!rIds.includes(voidedReturn.id), 'a voided return does NOT show')
    assert(returns.find(r => r.orderId === myReturn.id)?.customerName === 'Casey C', 'carries the customer for the vendor to identify the bag')

    // ── [3] ADMIN RELEASE — the CLAIMED handle works; a collected one refuses ───
    console.log('\n[3] admin release resolves a CLAIMED strand; refuses a collected one')
    const relRes = await adminReleaseStranded({ orderId: claimed.id, eventId: ev.id, actorId: 'admin_test' })
    const relOrder = await prisma.order.findUnique({ where: { id: claimed.id }, select: { status: true, runnerId: true } })
    assert(relRes.outcome === 'released', `CLAIMED order released by admin (got '${relRes.outcome}')`)
    assert(relOrder?.status === 'READY' && relOrder?.runnerId === null, 'released to the pool (status READY, runnerId null)')
    assert((await prisma.deliveryCustodyEvent.count({ where: { orderId: claimed.id, eventType: 'released' } })) === 1, 'a `released` custody event was written')
    const refuseRes = await adminReleaseStranded({ orderId: unreach.id, eventId: ev.id, actorId: 'admin_test' })
    assert(refuseRes.outcome === 'already_collected', `a COLLECTED (unreachable) order refuses release → ${refuseRes.outcome} (use refund)`)

    console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} escalation-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('💥', e); process.exit(1) })
