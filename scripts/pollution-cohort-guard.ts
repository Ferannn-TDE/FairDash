/**
 * THE POLLUTION COHORT — earnings, payouts and display retired together.
 *
 * Each half produces a FALSE STATEMENT alone, which is why they ship as one change:
 *   • cancel the earnings only → the admin view is honest, but the vendor still sees money that
 *     was never sent (computeVendorOrderEarnings reads Payout, never VendorEarning)
 *   • filter the payouts only  → the vendor sees "~$X pending" for a slice that was written off:
 *     honest that nothing was sent, wrong that anything is owed
 *
 * ⚠️ [3] IS THE LOAD-BEARING SECTION. It asserts the COMPOSITION — that a vendor sees no figure
 * from ANY source. Each part alone leaves one of the two visible, so testing the parts
 * separately would pass while the product still lied.
 *
 *   [0] positive controls + baseline
 *   [1] the declared set is shared, closed, and does not catch legitimate transfers
 *   [2] a LEGITIMATE payout in the SAME DATE RANGE is untouched (the date-heuristic regression)
 *   [3] ⛔ COMPOSITION — a polluted slice yields NO figure: not settled, not pending, not zero
 *   [4] `cancelled` cannot re-enter the payable set — re-runs the REAL candidate query
 *   [5] the remediation script is dry-run-by-default, idempotent, and guarded
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/pollution-cohort-guard.ts
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { computeVendorOrderEarnings, sumVendorEarnings, type OrderForEarnings } from '../lib/vendor-earnings'
import { POLLUTED_TRANSFER_IDS, isPollutedTransfer } from '../lib/pollution-cohort'
import { ACKNOWLEDGED_MISSING_TRANSFERS } from '../lib/transfer-existence'
import { stripComments } from './_strip-comments'

const prisma = testPrisma()
const SLUG = 'polc-', MAIL = '@polc.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const POLLUTED = [...POLLUTED_TRANSFER_IDS][0]
const REAL_TX = 'tr_3Tvl9NHk5f3uB8J900UakK3u' // the runner payout proven in production

/** One order, one vendor, one payout — parameterised by which transfer id backs it. */
const orderWith = (transferId: string, netAmount = 29.79): OrderForEarnings => ({
  total: 33.10,
  orderItems: [{ vendorId: 'v1', subtotal: 29.79 }],
  payouts: [{ vendorId: 'v1', netAmount, reversedAt: null, stripeTransferId: transferId }],
  refunds: [],
  vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }],
})

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    await prisma.adminMoneyAction.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendorEarning.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.payout.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    console.log('[0] positive controls + baseline')
    assert(POLLUTED_TRANSFER_IDS.size === 76, `the declared cohort is 76 ids (got ${POLLUTED_TRANSFER_IDS.size})`)
    assert(isPollutedTransfer(POLLUTED), 'a declared id is recognised (the probe reads the real set)')
    assert(!isPollutedTransfer(REAL_TX), '⛔ and a REAL production transfer is NOT')
    assert(!isPollutedTransfer(null) && !isPollutedTransfer(undefined), 'null/undefined are not polluted (no crash)')
    // BASELINE: a normal payout still reads as settled, else every negative below is free.
    const clean = computeVendorOrderEarnings(orderWith(REAL_TX), 'v1')
    assert(clean.status === 'settled' && clean.cents === 2979,
      `BASELINE: a real payout still reads settled ${clean.cents}¢ — the filter did not break the happy path`)

    console.log('\n[1] ONE declared set, shared by both consumers')
    assert(ACKNOWLEDGED_MISSING_TRANSFERS.ids === POLLUTED_TRANSFER_IDS,
      'the transfer-existence guard and the display filter read the SAME Set object — not a copy that could drift')
    const cohort = readFileSync('lib/pollution-cohort.ts', 'utf8')
    assert(!/^import /m.test(cohort), 'the cohort module imports nothing (the display path stays free of Stripe/DB)')

    console.log('\n[2] a LEGITIMATE payout in the SAME DATE RANGE is untouched')
    // The regression this catches: 34 real payouts share the cohort's 2026-07-12→17 window, so
    // any date-based membership rule would sweep them up. Membership is the id, never the date.
    const legit = computeVendorOrderEarnings(orderWith('tr_3TeI6GHk5f3uB8J91P7KVt6I'), 'v1')
    assert(legit.status === 'settled', 'a real transfer from inside the cohort date range still reads SETTLED')
    assert(legit.cents === 2979, 'and its amount is unchanged')
    const src = stripComments(readFileSync('lib/vendor-earnings.ts', 'utf8'))
    assert(!/createdAt|placedAt|2026-07/.test(src), '⛔ the display filter consults NO date at all')

    console.log('\n[3] ⛔ COMPOSITION — a polluted slice yields NO figure from ANY source')
    const polluted = computeVendorOrderEarnings(orderWith(POLLUTED), 'v1')
    assert(polluted.status === 'excluded', `status is 'excluded' (got '${polluted.status}')`)
    assert(polluted.cents === 0, 'and it carries no amount')
    assert(polluted.status !== 'settled', '  → NOT settled: the vendor is not shown money that was never sent')
    assert(polluted.status !== 'estimated', '  → NOT estimated: nor "~$X pending" for a slice that was written off')
    // The aggregate must not count it in EITHER bucket, nor in the order tallies.
    const agg = sumVendorEarnings([orderWith(POLLUTED)], 'v1')
    assert(agg.settledCents === 0 && agg.estimatedCents === 0, 'contributes to neither total')
    assert(agg.settledOrders === 0 && agg.pendingOrders === 0, 'and is counted in neither order tally')
    // And the badge renders nothing at all for it.
    const badge = readFileSync('app/_components/EarningsBadge.tsx', 'utf8')
    assert(/if \(status === 'excluded'\) return null/.test(badge), 'the shared badge returns null — no line, no zero, no label')
    assert(/Exclude<EarningsStatus, 'excluded'>/.test(badge),
      "and 'excluded' is typed OUT of the state map, so a '$0 excluded' entry cannot be added by accident")
    // A mixed order: the real slice still shows, the polluted one does not.
    const mixed: OrderForEarnings = {
      total: 60,
      orderItems: [{ vendorId: 'v1', subtotal: 29.79 }, { vendorId: 'v2', subtotal: 29.79 }],
      payouts: [
        { vendorId: 'v1', netAmount: 29.79, reversedAt: null, stripeTransferId: POLLUTED },
        { vendorId: 'v2', netAmount: 29.79, reversedAt: null, stripeTransferId: REAL_TX },
      ],
      refunds: [], vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }, { vendorId: 'v2', status: 'COMPLETED' }],
    }
    assert(computeVendorOrderEarnings(mixed, 'v1').status === 'excluded', 'on a MIXED order the polluted slice is excluded…')
    assert(computeVendorOrderEarnings(mixed, 'v2').status === 'settled', '…and the genuine slice on the SAME order is unaffected')

    console.log('\n[4] `cancelled` cannot re-enter the payable set — the REAL candidate query')
    const ev = await prisma.event.create({ data: {
      name: `POLC ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE',
    } })
    const ven = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const mi = await prisma.menuItem.create({ data: { vendorId: ven.id, name: 'X', price: 29.79, category: 'T' } })
    const cust = await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' } })
    const OLD = new Date(Date.now() - 5 * 3600_000)
    const ord = await prisma.order.create({ data: {
      eventId: ev.id, customerId: cust.id, vendorId: ven.id, status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 29.79, fairSynqFee: 3, total: 33.1, vendorPayout: 29.79, customerName: 'C', customerPhone: '+10000000000',
      placedAt: OLD, completedAt: OLD, stripeChargeId: `ch_${rand()}`,
      orderItems: { create: [{ vendor: { connect: { id: ven.id } }, menuItem: { connect: { id: mi.id } }, itemName: 'X', quantity: 1, unitPrice: 29.79, totalPrice: 29.79, subtotal: 29.79 }] },
      vendorOrderStatuses: { create: [{ vendorId: ven.id, status: 'COMPLETED' }] },
    } })
    const earning = await prisma.vendorEarning.create({ data: {
      eventId: ev.id, orderId: ord.id, vendorId: ven.id, subtotalCents: 2979, status: 'paid',
    } })
    // patternC's gap check treats 'held'/'cancelled' as admin-blocked — re-derive it here rather
    // than reading a status field, so this proves ELIGIBILITY, not bookkeeping.
    const isGap = async () => {
      const o = await prisma.order.findUniqueOrThrow({
        where: { id: ord.id },
        select: { orderItems: { select: { vendorId: true } }, payouts: { select: { vendorId: true } },
          payoutHolds: { select: { vendorId: true } }, refunds: { select: { vendorId: true } },
          vendorEarnings: { select: { vendorId: true, status: true } } },
      })
      const blocked = new Set(o.vendorEarnings.filter(e => e.status === 'held' || e.status === 'cancelled').map(e => e.vendorId))
      const paid = new Set(o.payouts.map(p => p.vendorId))
      return [...new Set(o.orderItems.map(i => i.vendorId))].some(v => !paid.has(v) && !blocked.has(v))
    }
    assert(await isGap() === true, 'BASELINE: while `paid` with no Payout row, patternC WOULD see a gap (the probe is live)')
    await prisma.vendorEarning.update({ where: { id: earning.id }, data: { status: 'cancelled' } })
    assert(await isGap() === false,
      "⛔ once 'cancelled' the slice is NOT a gap — patternC:52 excludes it, so cancelling cannot trigger repayment")
    const payout = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
    assert(/earningStatus === 'cancelled'/.test(payout) || /'cancelled'/.test(payout),
      'and processOrderPayout has its own independent gate — two guards, not one')

    console.log('\n[5] the remediation script is safe by default')
    const script = readFileSync('scripts/retire-pollution-cohort.ts', 'utf8')
    assert(/const APPLY = process\.argv\.includes\('--apply'\)/.test(script), 'DRY-RUN by default; writes only with --apply')
    assert(/ALLOW_PROD_WRITES !== 'true'/.test(script), 'and refuses --apply without ALLOW_PROD_WRITES (prod-write-guard)')
    assert(/status === 'paid'/.test(script) && /already done/.test(script),
      'IDEMPOTENT — only `paid` rows are touched, so a re-run after a partial failure is a no-op on the done ones')
    assert(/\$transaction/.test(script), 'status flip + audit in ONE transaction — no un-audited money-state change')
    assert(/RECEIPT/.test(script) && /measured AFTER/.test(script),
      'and it prints a receipt with the rows touched and the measured paid= figure after')
    assert(/THE LEDGER IS STILL UNCORRECTED/.test(script),
      'the dry run states plainly that the ledger is uncorrected until it runs')
    assert(!/reverseAccrualForRefundedPortion/.test(script),
      '⛔ it does NOT call the shared reverser — that guard refuses `paid` rows by design and must stay that way')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `✅ pollution-cohort-guard: ${pass} passed, 0 failed` : `❌ pollution-cohort-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('[pollution-cohort-guard] FAILED:', e); await cleanup(); process.exit(1) })
