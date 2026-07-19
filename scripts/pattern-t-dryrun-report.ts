/**
 * Pattern T dry-run report — what the phantom-accrual backstop WOULD cancel. READ-ONLY.
 * Replicates Pattern T's detection + the reverser in dryRun (which applies the safety predicate,
 * so nothing payable can appear). No live cancel — this is the diff to review before flipping
 * RECONCILER_PATTERN_T_ENABLED=true. Run: npx tsx scripts/pattern-t-dryrun-report.ts
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { reverseAccrualForRefundedPortion } from '../lib/reverse-accrual'
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const NON_PAYABLE = ['REFUNDED', 'DECLINED', 'CANCELLED']

async function main() {
  const candidates = await p.vendorEarning.findMany({
    where: { status: 'accrued', order: { voidedAt: null, vendorOrderStatuses: { some: { status: { in: NON_PAYABLE } } } } },
    select: { orderId: true, vendorId: true, subtotalCents: true, eventId: true,
      order: { select: { vendorOrderStatuses: { select: { vendorId: true, status: true } }, event: { select: { name: true } } } } },
  })
  const wouldCancel: { orderId: string; vendorId: string; cents: number; vos: string; event: string }[] = []
  let refusedPayable = 0
  for (const e of candidates) {
    const vos = e.order.vendorOrderStatuses.find(v => v.vendorId === e.vendorId)?.status ?? ''
    if (!NON_PAYABLE.includes(vos)) continue // this vendor's own portion is payable — skip (safety)
    // Confirm via the reverser's dryRun (same predicate the live run uses)
    const r = await reverseAccrualForRefundedPortion({ orderId: e.orderId, vendorId: e.vendorId, actor: { id: 'reconciler', type: 'reconciler' }, reason: 'dryrun-report', dryRun: true })
    if (r.reversed) wouldCancel.push({ orderId: e.orderId, vendorId: e.vendorId, cents: e.subtotalCents, vos, event: e.order.event.name })
    else refusedPayable++
  }

  const total = wouldCancel.reduce((s, x) => s + x.cents, 0)
  const byVendor: Record<string, { n: number; cents: number }> = {}
  const byEvent: Record<string, number> = {}
  for (const x of wouldCancel) {
    const k = x.vendorId.slice(-6); byVendor[k] = { n: (byVendor[k]?.n ?? 0) + 1, cents: (byVendor[k]?.cents ?? 0) + x.cents }
    byEvent[x.event] = (byEvent[x.event] ?? 0) + x.cents
  }

  // Current event payable (Italian Fest) for the exact delta
  const EVENT = 'cmni6x63n000011znjwlln5k2'
  const payableNow = (await p.vendorEarning.findMany({ where: { eventId: EVENT, status: 'accrued' }, select: { subtotalCents: true } })).reduce((s, r) => s + r.subtotalCents, 0)
  const ifDelta = wouldCancel.filter(x => x.event === 'Italian Fest 2026').reduce((s, x) => s + x.cents, 0)

  console.log('════ PATTERN T DRY-RUN — WOULD CANCEL (read-only, no live change) ════')
  console.log(`Phantom accrued rows Pattern T would cancel: ${wouldCancel.length}  ($${(total/100).toFixed(2)})`)
  console.log(`Rows the reverser REFUSED as still-payable (safety held): ${refusedPayable}`)
  console.log(`\nBy vendor:`); for (const [v, x] of Object.entries(byVendor)) console.log(`   …${v}: ${x.n} rows, $${(x.cents/100).toFixed(2)}`)
  console.log(`\nBy event:`); for (const [ev, c] of Object.entries(byEvent)) console.log(`   ${ev}: $${(c/100).toFixed(2)}`)
  console.log(`\nEXACT payable delta (Italian Fest): $${(payableNow/100).toFixed(2)} → $${((payableNow - ifDelta)/100).toFixed(2)}  (−$${(ifDelta/100).toFixed(2)})`)
  console.log(`\nSet (first 20 of ${wouldCancel.length}):`)
  for (const x of wouldCancel.slice(0, 20)) console.log(`   #${x.orderId.slice(-8).toUpperCase()} v=${x.vendorId.slice(-6)} ${x.cents}¢ VOS=${x.vos}`)
  if (wouldCancel.length > 20) console.log(`   … +${wouldCancel.length - 20} more`)
  console.log(`\n⏸  No live cancel. To act: review this set, then set RECONCILER_PATTERN_T_ENABLED=true on the worker (or run the sweep with patternTEnabled:true) — attributed to the reconciler.`)
}
main().finally(()=>p.$disconnect())
