/**
 * SEALED DRY RUN — payout-safety fix. READ-ONLY: it runs only the reconciler's shared selection
 * functions and plain reads. It never calls the sweep, a pattern, enqueueOrderPayout,
 * processOrderPayout or Stripe, and writes nothing, so a mistake in this script cannot move
 * money. Run it against production BEFORE deploying the fix:
 *
 *   CONFIRM_PROD_DB=<ref> ./scripts/with-prod-db.sh npx tsx scripts/payout-safety-dryrun.ts
 *
 * It proves the deploy itself pays nothing and queues nothing:
 *   [1] Pattern C selects no order, now and with the clock moved to deploy + 4h, 12h, 24h, 48h.
 *       (completedAt on DELIVERED is forward-only; no existing order gains one.)
 *   [2] Pattern S selects no order at the same instants.
 *   [3] Pattern D finds no hold to drain.
 *   [4] The known stranded test earnings (Italian Fest Jul 17 + delivered) and the chargeback
 *       orphan are in none of those selections.
 *   [5] Pattern Y (new, alert-only) finds exactly the two chargeback-orphan earnings.
 *   [6] transfer_exists would block exactly those two, if a payout run ever reached them.
 *   [7] Legacy DELIVERED orders all still have a null completedAt (no backfill happened).
 * Exit 0 only if every expectation holds.
 */

import { db } from '../lib/db'
import { classifyVendorSlice } from '../lib/process-payout'
import { selectPatternCCandidates, selectPatternSCandidates, selectPatternDCandidates, selectTransferExistsEarnings } from '../lib/reconciler'

const HOUR = 3_600_000
const WINDOW_HOURS = 24 // the sweep's default windowHours
const ORPHAN_ORDER = 'cmrgp7oeq0001pcsd81dvtfit'
const ORPHAN_VENDORS = new Set(['cmni6x68q000211znxtpw0076', 'cmni6x6gz000611znpe5c5hhp'])

let pass = 0, fail = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const now = Date.now()
  const offsets = [0, 4, 12, 24, 48]
  const big = 10_000 // no cap: the dry run must see the whole candidate set, not the sweep's first 100

  console.log('[1][2] Pattern C and S selections, now and after deploy + N hours')
  const touched = new Set<string>()
  for (const h of offsets) {
    const at = new Date(now + h * HOUR)
    const windowStart = new Date(at.getTime() - WINDOW_HOURS * HOUR)
    const c = await selectPatternCCandidates({ windowStart, now: at, maxPerPattern: big })
    const s = await selectPatternSCandidates({ windowStart, maxPerPattern: big })
    c.forEach(x => touched.add(x.orderId)); s.forEach(x => touched.add(x.orderId))
    check(c.length === 0, `Pattern C selects nothing at +${h}h`, c.map(x => x.orderId).join(', '))
    check(s.length === 0, `Pattern S selects nothing at +${h}h`, s.map(x => x.orderId).join(', '))
  }

  console.log('\n[3] Pattern D')
  const d = await selectPatternDCandidates({ maxPerPattern: big })
  d.forEach(x => touched.add(x.orderId))
  check(d.length === 0, 'Pattern D finds no hold to drain', d.map(x => `${x.orderId}/${x.vendorId}`).join(', '))

  console.log('\n[4] known stranded earnings and the orphan are in no selection')
  const accrued = await db.vendorEarning.findMany({
    where: { status: 'accrued' },
    select: { id: true, orderId: true, vendorId: true, subtotalCents: true, eventId: true },
  })
  console.log(`  ${accrued.length} accrued earning(s), total $${(accrued.reduce((s, r) => s + r.subtotalCents, 0) / 100).toFixed(2)}`)
  for (const r of accrued) {
    check(!touched.has(r.orderId), `order ${r.orderId} vendor ${r.vendorId} (${r.subtotalCents}¢) is in no C/S/D selection`)
  }

  console.log('\n[5] Pattern Y selection')
  const y = await selectTransferExistsEarnings({ maxPerPattern: big })
  for (const r of y) console.log(`  · ${r.orderId} vendor ${r.vendorId} ${r.subtotalCents}¢ transfer ${r.transferId} (${r.transferStatus})`)
  check(y.length === 2 && y.every(r => r.orderId === ORPHAN_ORDER && ORPHAN_VENDORS.has(r.vendorId)),
    'Pattern Y finds exactly the two chargeback-orphan earnings', `found ${y.length}`)

  console.log('\n[6] transfer_exists, applied to every accrued earning')
  const payouts = await db.payout.findMany({
    where: { orderId: { in: [...new Set(accrued.map(r => r.orderId))] } },
    select: { orderId: true, vendorId: true },
  })
  const hasTransfer = new Set(payouts.map(p => `${p.orderId}:${p.vendorId}`))
  const blocked = accrued.filter(r =>
    classifyVendorSlice({ declined: false, earningStatus: 'accrued', connected: true, payoutsFrozen: false, transferCents: 1, transferExists: hasTransfer.has(`${r.orderId}:${r.vendorId}`) }).blockedReason === 'transfer_exists')
  check(blocked.length === 2 && blocked.every(r => r.orderId === ORPHAN_ORDER && ORPHAN_VENDORS.has(r.vendorId)),
    'transfer_exists would block exactly the two orphan earnings', blocked.map(r => `${r.orderId}/${r.vendorId}`).join(', '))

  console.log('\n[7] no backfill: DELIVERED orders and completedAt')
  const deliveredNull = await db.order.count({ where: { status: 'DELIVERED', completedAt: null } })
  const deliveredSet = await db.order.count({ where: { status: 'DELIVERED', completedAt: { not: null } } })
  console.log(`  DELIVERED with completedAt null: ${deliveredNull}; with completedAt set: ${deliveredSet}`)
  check(deliveredSet === 0, 'no DELIVERED order has a completedAt yet (none delivered since the fix; nothing backfilled)')

  console.log(`\n${'─'.repeat(60)}\n${fail === 0 ? '✅' : '❌'} payout-safety dry run: ${pass} passed, ${fail} failed`)
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => { await db.$disconnect(); process.exit(fail === 0 ? 0 : 1) })
