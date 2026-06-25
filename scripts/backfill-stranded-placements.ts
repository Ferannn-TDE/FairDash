/**
 * One-off recovery for orders left HALF-PLACED by the pre-fix placePaidOrder
 * race (status=PLACED but missing VendorOrderStatus rows → invisible to vendors,
 * never fulfilled, never paid out). See lib/place-order.ts fix.
 *
 * For each target order (real, paid — verified before running) this:
 *   - creates the missing per-vendor VendorOrderStatus rows (PLACED), idempotent
 *   - pushes each vendor's Firebase node so it appears on the dashboard
 *   - does NOT schedule the accept-timeout: these orders are old, and the 2-min
 *     timeout would immediately auto-cancel/refund them. They are surfaced for
 *     MANUAL handling — accept/complete them by hand to test payout.
 *
 * Idempotent: re-running creates no duplicates (skipDuplicates) and re-pushes
 * the same Firebase payload. Prints what it did per order.
 *
 * Usage: npx tsx scripts/backfill-stranded-placements.ts
 */
import { PrismaClient } from '@prisma/client'
import { getRealtimeDb } from '../lib/firebase-admin'

const db = new PrismaClient()

// Explicit, verified targets (paid orders, status=PLACED, 0 vendor rows).
const TARGET_ID_SUFFIXES = ['m56fr4cr', 'w82l2rbe', 'iefq1sz1']

async function main() {
  const rtdb = getRealtimeDb()
  console.log(`Firebase RTDB: ${rtdb ? 'available' : 'UNAVAILABLE (rows still created; refresh dashboard to see)'}\n`)

  for (const suffix of TARGET_ID_SUFFIXES) {
    const order = await db.order.findFirst({
      where: { id: { endsWith: suffix } },
      include: {
        orderItems: { include: { menuItem: { select: { name: true } } } },
        vendorOrderStatuses: { select: { vendorId: true } },
      },
    })
    if (!order) { console.log(`#${suffix.toUpperCase()}: NOT FOUND — skipped`); continue }

    const short = order.id.slice(-8).toUpperCase()
    if (order.status !== 'PLACED') {
      console.log(`#${short}: status=${order.status} (not PLACED) — skipped`)
      continue
    }

    const uniqueVendorIds = [...new Set(order.orderItems.map(oi => oi.vendorId))]
    const existing = new Set(order.vendorOrderStatuses.map(v => v.vendorId))
    const missing = uniqueVendorIds.filter(v => !existing.has(v))

    // Create missing rows (idempotent).
    const created = await db.vendorOrderStatus.createMany({
      data: uniqueVendorIds.map(vid => ({ orderId: order.id, vendorId: vid, status: 'PLACED' as const })),
      skipDuplicates: true,
    })

    // Firebase push per vendor (per-vendor slice).
    const byVendor: Record<string, { lines: string[]; subtotal: number; count: number }> = {}
    for (const oi of order.orderItems) {
      const b = (byVendor[oi.vendorId] ??= { lines: [], subtotal: 0, count: 0 })
      b.lines.push(`${oi.itemName || oi.menuItem.name} ×${oi.quantity}`)
      b.subtotal += oi.subtotal
      b.count += oi.quantity
    }
    let pushed = 0
    if (rtdb) {
      for (const [vid, b] of Object.entries(byVendor)) {
        await rtdb.ref(`fairs/${order.eventId}/orders/${vid}/${order.id}`).set({
          orderId: order.id,
          status: 'PLACED',
          fulfillmentType: order.fulfillmentType,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          subtotal: parseFloat(b.subtotal.toFixed(2)),
          total: parseFloat(b.subtotal.toFixed(2)),
          itemCount: b.count,
          itemSummary: b.lines.join(', '),
          placedAt: order.placedAt ? order.placedAt.getTime() : Date.now(),
        })
        pushed++
      }
    }

    console.log(
      `#${short}: rows created=${created.count} (missing was ${missing.length}/${uniqueVendorIds.length}), ` +
      `firebase pushed=${pushed}, accept-timeout NOT scheduled (manual handling)`,
    )
  }
  console.log('\nDone. Accept/complete these by hand on the vendor dashboards to test payout.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
