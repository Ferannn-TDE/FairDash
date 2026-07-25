/**
 * READY-LANE EVICTION GUARD — a collected order leaves the vendor's Ready lane, and comes back
 * only on a confirmed return. The custody-reader class (sibling of the delivered-timeline gap):
 * a lifecycle event (collect) updated one reader (the customer bar / collectedAt) but not the
 * other (the vendor Ready lane), so a collected order lingered where the vendor already handed
 * it off.
 *
 *   [1] SERVER (real /active predicate) — a READY, not-collected order is returned; the SAME
 *       order once collected is EXCLUDED; after a confirmed return (collectedAt nulled) it is
 *       returned again. Positive control: the not-collected twin is always present.
 *   [2] SOURCE SHAPE — the client Ready memo gates on `!o.collectedAt`, and the refetch
 *       RECONCILES (evicts active-lane orders absent from the fresh /active), not merge-only;
 *       the returns surface is untouched (it keys on returnRequestedAt, so a pending return is
 *       never hidden by the collectedAt filter).
 *
 * Seeds a throwaway event and cleans up. Run:  npx tsx scripts/ready-lane-eviction-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { statusWhere, vendorOrderScope } from '../lib/vendor-order-history'
import { ACTIVE_VENDOR_STATUSES } from '../app/api/vendors/[id]/orders/active/route'

const prisma = testPrisma()
const SLUG = 'rlane-', MAIL = '@rlane.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// The EXACT /active live-lane predicate (mirrors the route, incl. the collectedAt: null filter).
const activeLaneWhere = (vendorId: string) => ({
  ...vendorOrderScope(vendorId),
  ...statusWhere(vendorId, ACTIVE_VENDOR_STATUSES),
  collectedAt: null,
})

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.order.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `RL ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const cust = (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'c', role: 'customer' } })).id
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const menuItem = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: 'Taco', price: 10, category: 'Food' } })

    // Seed a READY order WITH an order-item for this vendor (vendorOrderScope requires it) + a
    // VOS READY row. Returns the order.
    const mkReadyOrder = async () => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: cust, vendorId: vendor.id, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
        subtotal: 20, fairSynqFee: 2, total: 22, vendorPayout: 20, customerName: 'C', customerPhone: '+10000000000',
        placedAt: new Date(), readyAt: new Date(),
        orderItems: { create: [{ vendorId: vendor.id, menuItemId: menuItem.id, itemName: 'Taco', quantity: 2, unitPrice: 10, totalPrice: 20, subtotal: 20 }] },
      } })
      await prisma.vendorOrderStatus.create({ data: { orderId: o.id, vendorId: vendor.id, status: 'READY' } })
      return o
    }

    // The control that must ALWAYS show, and the order we move through claim → collect → return.
    const notCollected = await mkReadyOrder()
    const order = await mkReadyOrder()

    const inLane = async (id: string) => (await prisma.order.findMany({ where: { ...activeLaneWhere(vendor.id), id }, select: { id: true } })).length === 1

    console.log('[1] server /active predicate: collect drops it, confirmed return brings it back')
    assert(await inLane(order.id), 'READY + not collected → IN the Ready lane')
    assert(await inLane(notCollected.id), 'positive control: the not-collected twin is IN the lane')

    // Runner claims + collects (VOS stays READY; collectedAt is what changes).
    await prisma.order.update({ where: { id: order.id }, data: { status: 'RUNNER_COLLECTED', runnerId: null, collectedAt: new Date() } })
    assert(!(await inLane(order.id)), 'collected (collectedAt set) → GONE from the Ready lane')
    assert(await inLane(notCollected.id), 'the not-collected twin is STILL in the lane (eviction is scoped to the collected order)')

    // Vendor confirms the return → collectedAt nulled, VOS/status back to READY.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'READY', collectedAt: null } })
    assert(await inLane(order.id), 'confirmed return (collectedAt nulled) → BACK in the Ready lane')

    console.log('\n[2] source shape: client memo + reconciling refetch + returns surface untouched')
    const dash = readFileSync(new URL('../app/vendor/[fairSlug]/dashboard/page.tsx', import.meta.url), 'utf8')
    assert(/status === 'READY' && !o\.collectedAt/.test(dash), 'Ready memo gates on !collectedAt')
    assert(/freshActiveIds/.test(dash) && /delete next\[id\]/.test(dash), 'refetch RECONCILES (evicts active-lane orders absent from fresh /active) — no longer merge-only')
    const route = readFileSync(new URL('../app/api/vendors/[id]/orders/active/route.ts', import.meta.url), 'utf8')
    assert(/collectedAt: null/.test(route), '/active query excludes collected orders')
    const returns = readFileSync(new URL('../lib/strand-escalation.ts', import.meta.url), 'utf8')
    assert(returns.includes('returnRequestedAt') && !/listReturnsForVendor[\s\S]*collectedAt/.test(returns.slice(returns.indexOf('listReturnsForVendor'), returns.indexOf('listReturnsForVendor') + 600)), 'returns surface keys on returnRequestedAt, NOT collectedAt (a pending return is never hidden)')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} ready-lane-eviction-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
