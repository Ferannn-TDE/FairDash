import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { OrderStatus } from '@prisma/client'

// Void ALL PRO TEES' junk ORDERS (keeps the vendor itself active/visible — this
// cleans its order HISTORY out of dashboard numbers, nothing else).
//
// Junk = an ALL PRO (primary vendor) order, not already voided, that is either
//   • zero-item   (no OrderItem rows), OR
//   • out-of-model (total != subtotal+fees AND total == subtotal — the 7% test era)
// A current-model (10%, reconciling, with items) ALL PRO order is reported but NOT
// voided by default. Cross-vendor safety: any candidate containing a DIFFERENT
// vendor's line items is EXCLUDED (never void a real vendor's revenue).
//
//   npx tsx scripts/void-allpro-junk-orders.ts            # DRY-RUN (default, writes nothing)
//   npx tsx scripts/void-allpro-junk-orders.ts --apply    # set voidedAt marker (reversible)

const VOID_REASON = 'allpro-test-junk-order'
const cents = (n: number | null | undefined) => Math.round((n ?? 0) * 100)
const ACTIVE = [OrderStatus.PLACED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY]

async function main() {
  const apply = process.argv.includes('--apply')
  const vendor = await db.vendor.findFirst({ where: { name: { contains: 'ALL PRO', mode: 'insensitive' } }, select: { id: true, name: true, eventId: true } })
  if (!vendor) { console.log('No ALL PRO vendor'); process.exit(0) }

  const orders = await db.order.findMany({
    where: { vendorId: vendor.id },
    select: {
      id: true, status: true, voidedAt: true,
      subtotal: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, total: true, vendorPayout: true,
      orderItems: { select: { vendorId: true } },
    },
  })

  let alreadyVoided = 0
  const alreadyVoidedIds = new Set<string>()
  const zeroItem: typeof orders = [], outOfModel: typeof orders = [], currentModel: typeof orders = [], crossVendor: typeof orders = []
  for (const o of orders) {
    if (o.voidedAt) { alreadyVoided++; alreadyVoidedIds.add(o.id); continue }
    const hasOtherVendorItems = o.orderItems.some(i => i.vendorId !== vendor.id)
    if (hasOtherVendorItems) { crossVendor.push(o); continue }          // SAFETY: never void — has a real vendor's items
    if (o.orderItems.length === 0) { zeroItem.push(o); continue }
    const customerSide = cents(o.subtotal) + cents(o.fairSynqFee) + cents(o.deliveryFee) + cents(o.serviceCharge)
    if (cents(o.total) !== customerSide && cents(o.total) === cents(o.subtotal)) { outOfModel.push(o); continue }
    currentModel.push(o)
  }

  const voidSet = [...zeroItem, ...outOfModel]
  const voidIds = new Set(voidSet.map(o => o.id))

  console.log(`\n=== ALL PRO junk-order ${apply ? 'VOID (--apply)' : 'DRY-RUN'} — vendor "${vendor.name}" ===`)
  console.log(`  total orders on vendor:        ${orders.length}`)
  console.log(`  already voided (skip):         ${alreadyVoided}`)
  console.log(`  → WOULD VOID (junk):           ${voidSet.length}`)
  console.log(`       zero-item:                ${zeroItem.length}`)
  console.log(`       out-of-model (7% era):    ${outOfModel.length}`)
  console.log(`  NOT voided — current-model (report only, decide separately): ${currentModel.length}`)
  console.log(`  EXCLUDED — cross-vendor (has a real vendor's items, protected): ${crossVendor.length}`)

  // ── Safety proof: nothing outside ALL PRO is in the void set ───────────────
  const outsideAllPro = await db.order.count({ where: { id: { in: [...voidIds] }, NOT: { vendorId: vendor.id } } })
  console.log(`\n  SAFETY: void-set orders NOT belonging to ALL PRO: ${outsideAllPro}  ${outsideAllPro === 0 ? '✅' : '❌ ABORT'}`)

  // ── Dashboard delta (what the numbers look like after the void + voidedAt filter) ──
  // BEFORE = today's dashboard (no voidedAt filter → includes even already-voided).
  // AFTER  = apply void + add the voidedAt:null filter → excludes ALL voided
  //          (the 25 already-voided ∪ the 123 new).
  const afterExcluded = new Set<string>([...voidIds, ...alreadyVoidedIds])
  const before = await snapshot(vendor.eventId, vendor.id, new Set<string>())
  const after  = await snapshot(vendor.eventId, vendor.id, afterExcluded)
  console.log(`\n=== DASHBOARD NUMBERS — before → after (voided excluded) ===`)
  console.log(`  Fair live orders (active status):   ${before.liveOrders} → ${after.liveOrders}`)
  console.log(`  Fair all-time order count:          ${before.fairCount} → ${after.fairCount}`)
  console.log(`  Fair all-time revenue (payout $):   ${before.fairRevenue.toFixed(2)} → ${after.fairRevenue.toFixed(2)}`)
  console.log(`  ALL PRO card — orders:              ${before.allProCount} → ${after.allProCount}`)
  console.log(`  ALL PRO card — revenue ($):         ${before.allProRevenue.toFixed(2)} → ${after.allProRevenue.toFixed(2)}`)
  console.log(`  (Randy's + real vendors: unchanged — none of their orders are in the void set)`)

  if (apply) {
    if (outsideAllPro !== 0) { console.log('\n❌ Safety check failed — aborting, no writes.'); process.exit(1) }
    const res = await db.order.updateMany({
      where: { id: { in: [...voidIds] }, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: VOID_REASON },
    })
    console.log(`\n✅ APPLIED — voided ${res.count} orders (voidedAt marker, reversible; Stripe untouched, no deletes).`)
  } else {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to void the ${voidSet.length} junk orders.`)
  }
  process.exit(0)
}

// Mirrors the polluted aggregates (getEventStats liveOrders + getFairVendors card),
// WITH a set of order-ids treated as voided/excluded.
async function snapshot(eventId: string, allProId: string, excluded: Set<string>) {
  const [liveRows, fairRows, allProRows] = await Promise.all([
    db.order.findMany({ where: { eventId, status: { in: ACTIVE } }, select: { id: true } }),
    db.order.findMany({ where: { eventId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } }, select: { id: true, status: true, vendorPayout: true } }),
    db.order.findMany({ where: { vendorId: allProId, status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } }, select: { id: true, status: true, vendorPayout: true } }),
  ])
  const live = liveRows.filter(o => !excluded.has(o.id))
  const fair = fairRows.filter(o => !excluded.has(o.id))
  const allPro = allProRows.filter(o => !excluded.has(o.id))
  const rev = (rows: { status: string; vendorPayout: number }[]) =>
    rows.filter(o => ['COMPLETED', 'DELIVERED'].includes(o.status)).reduce((s, o) => s + (o.vendorPayout ?? 0), 0)
  return {
    liveOrders: live.length,
    fairCount: fair.length,
    fairRevenue: rev(fair),
    allProCount: allPro.length,
    allProRevenue: rev(allPro),
  }
}
main().catch(e => { console.error(e); process.exit(1) })
