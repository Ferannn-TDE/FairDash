/**
 * One-time backfill: create the missing VendorOrderStatus (VOS) rows for LIVE orders.
 *
 * WHY. VOS rows are created eagerly at placement (lib/place-order.ts), but a handful of old
 * orders (pre-eager-creation / partial writes) have a vendor with items yet no VOS row. The
 * reader-symmetry fix (vendorOrderScope + statusWhere) makes those orders render correctly via
 * the master-status fallback — but VOS is read by ~10 places, and the reconciler's Pattern B
 * only heals orders inside its recent scan window, so these old corpses would keep producing
 * edge cases in readers nobody audited. Healing the rows removes the CONDITION for good; the
 * reader fix keeps the code robust if it ever recurs. Both, per the plan.
 *
 * SAFE BY CONSTRUCTION:
 *   • Only non-voided orders (voidedAt: null) — voided orders are the out-of-model exclusion
 *     and must stay VOS-less/hidden. Never healed.
 *   • Only SINGLE-vendor orders, where the vendor's true status is unambiguously the master
 *     Order.status. Multi-vendor or non-mirrorable master statuses are SKIPPED and reported,
 *     never guessed.
 *   • Idempotent — re-running finds nothing (the rows now exist). skipDuplicates on top.
 *   • DRY-RUN by default. Pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-vos.ts            # dry run — report only
 *   npx tsx scripts/backfill-missing-vos.ts --apply    # write the rows
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const APPLY = process.argv.includes('--apply')

// Master Order.status values that map 1:1 to a VendorOrderStatus for a single-vendor order.
// (PENDING_PAYMENT is pre-placement; the terminal delivery/no-show statuses aren't per-vendor
// kitchen states — none of those should be silently mirrored, so they're excluded and reported.)
const MIRRORABLE = new Set(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED', 'COMPLETED'])

async function main() {
  const orders = await prisma.order.findMany({
    where: { voidedAt: null },
    select: {
      id: true, status: true, placedAt: true,
      orderItems: { select: { vendorId: true } },
      vendorOrderStatuses: { select: { vendorId: true } },
    },
  })

  type Heal = { orderId: string; vendorId: string; status: string }
  const toHeal: Heal[] = []
  const skipped: { orderId: string; reason: string }[] = []

  for (const o of orders) {
    const vids = [...new Set(o.orderItems.map(i => i.vendorId))]
    const vosVids = new Set(o.vendorOrderStatuses.map(v => v.vendorId))
    const missing = vids.filter(v => !vosVids.has(v))
    if (!missing.length) continue

    if (vids.length > 1) { skipped.push({ orderId: o.id, reason: `multi-vendor (${vids.length}) — per-vendor status ambiguous` }); continue }
    if (!MIRRORABLE.has(o.status)) { skipped.push({ orderId: o.id, reason: `master status ${o.status} is not a mirrorable per-vendor state` }); continue }
    for (const vendorId of missing) toHeal.push({ orderId: o.id, vendorId, status: o.status })
  }

  console.log(`\nScanned ${orders.length} non-voided orders.`)
  console.log(`VOS rows to backfill: ${toHeal.length}`)
  for (const h of toHeal) console.log(`   #${h.orderId.slice(-8).toUpperCase()}  vendor ${h.vendorId}  → VOS status ${h.status}`)
  if (skipped.length) {
    console.log(`\nSkipped (reported, NOT healed): ${skipped.length}`)
    for (const s of skipped) console.log(`   #${s.orderId.slice(-8).toUpperCase()}  — ${s.reason}`)
  }

  if (!APPLY) {
    console.log('\n🟡 DRY RUN — no rows written. Re-run with --apply to write the rows above.')
    return
  }
  if (!toHeal.length) { console.log('\n✅ Nothing to heal.'); return }

  const res = await prisma.vendorOrderStatus.createMany({
    data: toHeal.map(h => ({ orderId: h.orderId, vendorId: h.vendorId, status: h.status })),
    skipDuplicates: true,
  })
  console.log(`\n✅ Backfilled ${res.count} VendorOrderStatus row(s).`)

  // Verify: zero non-voided VOS-less pairs remain.
  const after = await prisma.order.findMany({
    where: { voidedAt: null },
    select: { id: true, orderItems: { select: { vendorId: true } }, vendorOrderStatuses: { select: { vendorId: true } } },
  })
  let remaining = 0
  for (const o of after) {
    const vids = [...new Set(o.orderItems.map(i => i.vendorId))]
    const vosVids = new Set(o.vendorOrderStatuses.map(v => v.vendorId))
    if (vids.some(v => !vosVids.has(v) && vids.length === 1)) remaining++
  }
  console.log(`Remaining single-vendor non-voided VOS-less orders: ${remaining} (expected 0)`)
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
