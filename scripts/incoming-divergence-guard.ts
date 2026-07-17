/**
 * "Is this order incoming?" — the two readers must NEVER disagree.
 *
 * THE BUG THIS GUARDS. The vendor ORDERS page ("Incoming" tab) and the vendor DASHBOARD
 * (INCOMING lane / IN QUEUE) answer the same question about the same order. They diverged:
 * the orders-page query (lib/vendor-order-history.statusWhere) had a FALLBACK arm — no
 * VendorOrderStatus row ⇒ fall back to the master Order.status — while /api/vendors/:id/orders/active
 * required a VOS row (JOIN-only, no fallback). So an order with no VOS row was "Incoming 1"
 * on the orders page yet invisible on the live dashboard (IN QUEUE: 0). 14 real orders were
 * in exactly this state. The fix makes BOTH readers derive "incoming" from ONE definition —
 * statusWhere — so the next new reader can't re-introduce the split by forgetting the fallback.
 *
 * WHY THE SEED HAS A VOS-LESS ORDER. The bug only exists when the optional row is ABSENT. If
 * every seeded order had a VOS row, both readers would trivially agree and this test would
 * pass while proving NOTHING. So the seed deliberately creates a PLACED order with NO VOS row —
 * the exact corpse the production data contained.
 *
 * POSITIVE CONTROL ON THE PROBE. Before trusting "the two readers agree", we prove the OLD
 * JOIN-only filter would have MISSED the VOS-less order. Without that, an agreement test can
 * pass vacuously (e.g. if the seed silently grew a VOS row). The probe must be able to SEE the
 * bug, or its silence means nothing.
 *
 * Run:  npx tsx scripts/incoming-divergence-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, OrderStatus } from '@prisma/client'
import { statusWhere, vendorOrderScope, fetchVendorOrderHistory } from '../lib/vendor-order-history'
import { ACTIVE_VENDOR_STATUSES } from '../app/api/vendors/[id]/orders/active/route'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const SLUG = 'incdiv-'
const MAIL = '@incdiv.local'
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
    const w = { where: { eventId: { in: ids } } }
    await prisma.vendorEarning.deleteMany(w)
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** The REAL dashboard/active reader: shared scope (items + not-voided) + shared statusWhere. */
async function activeIncoming(vendorId: string): Promise<Set<string>> {
  const rows = await prisma.order.findMany({
    where: { ...vendorOrderScope(vendorId), ...statusWhere(vendorId, ACTIVE_VENDOR_STATUSES) },
    select: { id: true },
  })
  // The dashboard client then filters status === 'PLACED' for the INCOMING lane; the master
  // status ?? o.status resolves to PLACED for a VOS-less PLACED order, so it lands there.
  return new Set(rows.map(r => r.id))
}

/** The OLD, buggy reader — JOIN-only, no fallback. Used ONLY as the positive control. */
async function activeIncomingJoinOnly(vendorId: string): Promise<Set<string>> {
  const rows = await prisma.order.findMany({
    where: {
      orderItems: { some: { vendorId } },
      vendorOrderStatuses: { some: { vendorId, status: { in: ACTIVE_VENDOR_STATUSES } } },
    },
    select: { id: true },
  })
  return new Set(rows.map(r => r.id))
}

/** The REAL orders-page reader: the "Incoming" tab = tab=PLACED through the history lib. */
async function historyIncoming(vendorId: string): Promise<Set<string>> {
  const seen = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    const res: Awaited<ReturnType<typeof fetchVendorOrderHistory>> =
      await fetchVendorOrderHistory({ vendorId, tab: 'PLACED', take: 50, cursor })
    res.orders.forEach(o => seen.add(o.id))
    if (!res.nextCursor) break
    cursor = res.nextCursor
  }
  return seen
}

async function main() {
  await cleanup()
  try {
    const event = await prisma.event.create({
      data: { name: `INC ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' },
    })
    const vendor = await prisma.vendor.create({
      data: { eventId: event.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' },
    })
    const mi = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: 'Item', price: 10, category: 'T' } })

    // vendorStatus=null is the whole point: an order the vendor must accept, with NO VOS row.
    const mk = async (masterStatus: OrderStatus, vendorStatus: string | null, voided = false) => {
      const c = await prisma.user.create({
        data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' },
      })
      const o = await prisma.order.create({
        data: {
          eventId: event.id, customerId: c.id, vendorId: vendor.id,
          status: masterStatus, fulfillmentType: 'HOME_DELIVERY',
          subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10,
          customerName: 'C', customerPhone: '+10000000000', placedAt: new Date(),
          ...(voided ? { voidedAt: new Date(), voidReason: 'test-data' } : {}),
          orderItems: { create: [{ vendorId: vendor.id, menuItemId: mi.id, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
          ...(vendorStatus ? { vendorOrderStatuses: { create: [{ vendorId: vendor.id, status: vendorStatus }] } } : {}),
        },
      })
      return o.id
    }

    const A = await mk(OrderStatus.PLACED, 'PLACED')          // normal incoming — has a VOS row
    const B = await mk(OrderStatus.PLACED, null)              // ⛔ the corpse — PLACED, NO VOS row
    const C = await mk(OrderStatus.COMPLETED, 'COMPLETED')          // terminal — must NOT be "incoming"
    const D = await mk(OrderStatus.PLACED, null, true)              // ⛔ voided PLACED, NO VOS row — must be HIDDEN everywhere
    const E = await mk(OrderStatus.RUNNER_COLLECTED, 'RUNNER_COLLECTED') // handed off — must LEAVE the vendor's board

    // ── [0] BASELINE — the seed really contains the bug's precondition ──────────
    console.log('\n[0] the seed contains the condition the bug needs (a VOS-less PLACED order)')
    const bVos = await prisma.vendorOrderStatus.count({ where: { orderId: B, vendorId: vendor.id } })
    const aVos = await prisma.vendorOrderStatus.count({ where: { orderId: A, vendorId: vendor.id } })
    assert(bVos === 0, `order B is PLACED with ZERO VendorOrderStatus rows (found ${bVos}) — the corpse exists`)
    assert(aVos === 1, `order A is PLACED WITH a VendorOrderStatus row (found ${aVos}) — the normal case exists`)

    // ── [1] POSITIVE CONTROL ON THE PROBE — the OLD filter MUST miss the corpse ──
    console.log('\n[1] positive control: the OLD join-only reader DROPS the VOS-less order (so silence would be meaningful)')
    const joinOnly = await activeIncomingJoinOnly(vendor.id)
    assert(joinOnly.has(A), 'OLD reader sees A (VOS-having) — it is not blind to everything')
    assert(!joinOnly.has(B), '⛔ OLD reader MISSES B (VOS-less) — this is the exact divergence being guarded')

    // ── [2] THE INVARIANT — both real readers agree on "incoming" ───────────────
    console.log('\n[2] ⛔ the two real readers derive the SAME incoming set (one shared definition)')
    const active  = await activeIncoming(vendor.id)   // dashboard INCOMING lane / IN QUEUE
    const history = await historyIncoming(vendor.id)  // orders page "Incoming" tab
    assert(active.has(B),  'dashboard reader now SEES the VOS-less order B (the bug is fixed)')
    assert(history.has(B), 'orders-page reader SEES B (it always did — via the fallback arm)')
    assert(active.has(A) && history.has(A), 'both readers see the normal VOS-having order A (no regression)')
    assert(!active.has(C) && !history.has(C), 'neither reader counts the terminal (COMPLETED) order C as incoming')
    const sameSet = active.size === history.size && [...active].every(id => history.has(id))
    assert(sameSet, `⛔ the incoming sets are IDENTICAL (active=${active.size}, history=${history.size}) — the two screens cannot disagree`)

    // ── [3] VOIDED ORDERS — the out-of-model exclusion — are hidden by BOTH readers ──
    console.log('\n[3] ⛔ voided orders (out-of-model test data) are excluded by BOTH readers, not leaked')
    // Positive control: WITHOUT the void filter, statusWhere alone WOULD match the voided order —
    // proving it's vendorOrderScope that excludes it, not some incidental miss.
    const withoutVoidFilter = new Set(
      (await prisma.order.findMany({
        where: { orderItems: { some: { vendorId: vendor.id } }, ...statusWhere(vendor.id, ACTIVE_VENDOR_STATUSES) },
        select: { id: true },
      })).map(r => r.id),
    )
    assert(withoutVoidFilter.has(D), 'positive control: statusWhere WITHOUT the scope would match the voided order D (so its exclusion is meaningful)')
    assert(!active.has(D),  '⛔ dashboard reader HIDES the voided order D')
    assert(!history.has(D), '⛔ orders-page reader HIDES the voided order D')

    // ── [4] HANDOFF BOUNDARY — a RUNNER_COLLECTED order leaves the vendor's live board ──
    console.log('\n[4] a collected (RUNNER_COLLECTED) order is OFF the vendor active board — the runner has it now')
    const eVos = await prisma.vendorOrderStatus.count({ where: { orderId: E, vendorId: vendor.id, status: 'RUNNER_COLLECTED' } })
    assert(eVos === 1, `order E is RUNNER_COLLECTED with a VOS row (found ${eVos}) — the handoff case exists`)
    assert(!active.has(E), '⛔ the vendor active board (all lanes) EXCLUDES the collected order E — it can never sit in the ready lane')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
