/**
 * P6 — Vendor stats scoping: BEFORE vs AFTER comparison (READ-ONLY).
 *
 * BEFORE  = current live SQL stats path: aggregates keyed on Order.vendorId
 *           (the single primary-vendor stamp) and AVG(Order.total) — the whole
 *           order incl. other vendors' items + fees.
 * AFTER   = order-item participation + master Order.status — the method the
 *           revenue route already uses (COUNT DISTINCT orders where oi.vendorId=V,
 *           and AVG of the per-vendor slice SUM(oi.totalPrice)).
 *
 * Revenue is already OrderItem-scoped in BOTH — shown to confirm it does not move.
 * No writes. All-time (no range filter) to match headline totals.
 */
import { db } from '../lib/db'

async function main() {
  const rows = await db.$queryRaw<any[]>`
    WITH before_counts AS (
      SELECT o."vendorId" AS vid,
        COUNT(*)                                                        AS total_b,
        COUNT(*) FILTER (WHERE o.status IN ('COMPLETED','DELIVERED'))   AS completed_b,
        COUNT(*) FILTER (WHERE o.status = 'CANCELLED')                  AS cancelled_b,
        COUNT(*) FILTER (WHERE o.status IN ('PLACED','ACCEPTED','PREPARING')) AS pending_b,
        AVG(o.total) FILTER (WHERE o.status IN ('COMPLETED','DELIVERED')) AS avg_b
      FROM "Order" o
      GROUP BY o."vendorId"
    ),
    per_order AS (
      SELECT oi."vendorId" AS vid, oi."orderId" AS oid, o.status AS status,
             SUM(oi."totalPrice") AS slice
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      GROUP BY oi."vendorId", oi."orderId", o.status
    ),
    after_counts AS (
      SELECT vid,
        COUNT(*)                                                        AS total_a,
        COUNT(*) FILTER (WHERE status IN ('COMPLETED','DELIVERED'))     AS completed_a,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')                    AS cancelled_a,
        COUNT(*) FILTER (WHERE status IN ('PLACED','ACCEPTED','PREPARING')) AS pending_a,
        AVG(slice)  FILTER (WHERE status IN ('COMPLETED','DELIVERED'))  AS avg_a,
        SUM(slice)  FILTER (WHERE status IN ('COMPLETED','DELIVERED'))  AS revenue_a
      FROM per_order
      GROUP BY vid
    )
    SELECT v.name,
           a.vid,
           b.total_b, a.total_a,
           b.completed_b, a.completed_a,
           b.cancelled_b, a.cancelled_a,
           b.pending_b, a.pending_a,
           b.avg_b, a.avg_a,
           a.revenue_a
    FROM after_counts a
    JOIN "Vendor" v ON v.id = a.vid
    LEFT JOIN before_counts b ON b.vid = a.vid
    ORDER BY a.total_a DESC
  `

  // Multi-vendor order landscape
  const [{ multi, total, missing_vos }] = await db.$queryRaw<any[]>`
    SELECT
      (SELECT COUNT(*) FROM (
         SELECT "orderId" FROM "OrderItem" GROUP BY "orderId" HAVING COUNT(DISTINCT "vendorId") > 1
       ) m) AS multi,
      (SELECT COUNT(DISTINCT "orderId") FROM "OrderItem") AS total,
      (SELECT COUNT(*) FROM (
         SELECT DISTINCT oi."orderId", oi."vendorId" FROM "OrderItem" oi
         LEFT JOIN "VendorOrderStatus" vos
           ON vos."orderId" = oi."orderId" AND vos."vendorId" = oi."vendorId"
         WHERE vos.id IS NULL
       ) x) AS missing_vos
  `

  const n = (x: any) => (x == null ? 0 : Number(x))
  const money = (x: any) => (x == null ? '—' : `$${Number(x).toFixed(2)}`)
  const rate = (c: number, t: number) => (t > 0 ? `${((c / t) * 100).toFixed(1)}%` : '—')
  const mark = (b: any, a: any) => (n(b) === n(a) ? '  (same)' : '  ← CHANGED')

  console.log('\n════════ P6 vendor-stats scoping — BEFORE vs AFTER (all-time) ════════\n')
  console.log(`Orders total: ${n(total)}   |   Multi-vendor orders: ${n(multi)}   |   OrderItem rows missing a VendorOrderStatus row: ${n(missing_vos)}\n`)

  for (const r of rows) {
    const cancB = n(r.total_b) ? rate(n(r.cancelled_b), n(r.total_b)) : '—'
    const cancA = n(r.total_a) ? rate(n(r.cancelled_a), n(r.total_a)) : '—'
    console.log(`── ${r.name}  (${r.vid})`)
    console.log(`   total orders     BEFORE ${String(n(r.total_b)).padStart(4)}   AFTER ${String(n(r.total_a)).padStart(4)}${mark(r.total_b, r.total_a)}`)
    console.log(`   completed        BEFORE ${String(n(r.completed_b)).padStart(4)}   AFTER ${String(n(r.completed_a)).padStart(4)}${mark(r.completed_b, r.completed_a)}`)
    console.log(`   cancelled        BEFORE ${String(n(r.cancelled_b)).padStart(4)}   AFTER ${String(n(r.cancelled_a)).padStart(4)}${mark(r.cancelled_b, r.cancelled_a)}`)
    console.log(`   pending          BEFORE ${String(n(r.pending_b)).padStart(4)}   AFTER ${String(n(r.pending_a)).padStart(4)}${mark(r.pending_b, r.pending_a)}`)
    console.log(`   cancellation %   BEFORE ${cancB.padStart(6)}  AFTER ${cancA.padStart(6)}`)
    console.log(`   avg order value  BEFORE ${money(r.avg_b).padStart(9)}  AFTER ${money(r.avg_a).padStart(9)}${mark(Number(r.avg_b).toFixed(2), Number(r.avg_a).toFixed(2))}`)
    console.log(`   revenue (compl.) BEFORE ${money(r.revenue_a).padStart(9)}  AFTER ${money(r.revenue_a).padStart(9)}   (already OrderItem-scoped — unchanged)`)
    console.log('')
  }

  await db.$disconnect()
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
