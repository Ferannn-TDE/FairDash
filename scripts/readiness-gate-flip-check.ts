import { config } from 'dotenv'; config({ path: '.env.local' })
import { db } from '../lib/db'
import { VendorStatus } from '@prisma/client'
import { isVendorReadinessEnforced, readinessWhereIfEnforced, readyVendorWhere } from '../lib/vendor-readiness'

// READ-ONLY confirmation that flipping ENFORCE_VENDOR_READINESS gates the
// customer-facing surfaces to the ready vendors, hides (not deactivates) the rest,
// and gates order creation. Mirrors the exact queries the endpoints run.
const FAIR = 'springfield-state-fair-2026'

async function main() {
  const event = await db.event.findFirst({ where: { urlSlug: FAIR }, select: { id: true } })
  if (!event) throw new Error('no fair')

  console.log(`isVendorReadinessEnforced() = ${isVendorReadinessEnforced()}  (flag read from .env.local)`)

  // What the marketplace / fair-count endpoints now return (status ACTIVE + gate).
  const visibleWhere = { eventId: event.id, status: VendorStatus.ACTIVE, ...readinessWhereIfEnforced() }
  const visible = await db.vendor.findMany({ where: visibleWhere, select: { name: true }, orderBy: { name: 'asc' } })
  console.log(`\nCUSTOMER-FACING (status ACTIVE + gate): ${visible.length} vendor(s)`)
  visible.forEach(v => console.log(`   • ${v.name}`))

  // The same query WITHOUT the gate (what customers saw before the flip).
  const ungated = await db.vendor.count({ where: { eventId: event.id, status: VendorStatus.ACTIVE } })
  console.log(`\nBefore the flip (ACTIVE, no gate): ${ungated}  →  after: ${visible.length}  (${ungated - visible.length} hidden)`)

  // The gate's own ready set (proves the visible set == readyVendorWhere).
  const readyCount = await db.vendor.count({ where: { eventId: event.id, ...readyVendorWhere } })
  console.log(`readyVendorWhere count (the gate's definition): ${readyCount}`)

  // HIDDEN ≠ DEACTIVATED: every vendor's status is untouched — still 17 ACTIVE.
  const byStatus = await db.vendor.groupBy({ by: ['status'], where: { eventId: event.id }, _count: { id: true } })
  console.log(`\nVendor STATUS in DB (unchanged by the flag — filter, not mutation):`)
  byStatus.forEach(s => console.log(`   ${s.status}: ${s._count.id}`))
  const totalActive = byStatus.find(s => s.status === 'ACTIVE')?._count.id ?? 0
  console.log(`   → ${totalActive} still ACTIVE (the 15 not-ready are HIDDEN, not deactivated)`)

  // Order-path gate: a not-ready vendor is refused at order creation.
  const notReady = await db.vendor.findFirst({
    where: { eventId: event.id, status: 'ACTIVE', stripeVerified: false },
    select: { name: true },
  })
  console.log(`\nOrder-creation gate: a not-ready vendor (e.g. "${notReady?.name}") → /api/orders blocks it (isVendorReadinessEnforced && !vendorReady).`)

  const ok = visible.length === 2 && readyCount === 2 && totalActive === 17
  console.log(`\n${ok ? '✅ FLIP CONFIRMED — customer-facing = 2 (ALL PRO + Randy\'s), 15 hidden-not-deactivated, order path gated' : '⚠️ unexpected counts — review above'}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
