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
 *   [6] ⛔ the RECEIPT reports what the writes RETURNED — a no-op writer must print zero
 *   [7] ⛔ Pattern X2 cannot re-heal the cohort — the 2026-07-28 incident, reproduced
 *   [8] ⛔ Pattern X2's heal is AUDITED, in the same transaction (atomicity proven by rollback)
 *
 * ⚠️ [5] IS TEXT, [6]–[8] ARE BEHAVIOUR. [5] greps the remediation script's source, and a
 * regex suite of exactly that kind passed on the night the apply run printed "76 rows cancelled"
 * against a ledger where nothing had stuck. Text checks pin the shape; only [6] and [7] execute
 * the receipt and the sweep, which is where both defects actually lived.
 *
 * [8] exists because X2 changed 76 money rows in prod with no AdminMoneyAction, and was found
 * only by forensics. Its load-bearing assertion is the ROLLBACK one: move the audit outside the
 * transaction and every field check still passes while that single assertion fails.
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
import {
  applyCohortRetirement, verifyCohort, formatCohortReceipt, type CohortPlanRow,
} from '../lib/retire-cohort'
import { patternX, type SweepSummary } from '../lib/reconciler'
import { classifyVendorSlice } from '../lib/process-payout'
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
  status: 'COMPLETED',
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
      status: 'COMPLETED',
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
    // The receipt TEXT itself now lives in lib/retire-cohort.ts and is asserted by BEHAVIOUR in
    // §[6]. What this line still owns is that the script routes through that tested formatter
    // rather than growing a second, untested one inline — which is how the first version lied.
    assert(/formatCohortReceipt/.test(script) && /measured AFTER/.test(script),
      'it prints its receipt through the tested formatter, plus the measured global paid= figure')
    assert(/THE LEDGER IS STILL UNCORRECTED/.test(script),
      'the dry run states plainly that the ledger is uncorrected until it runs')
    assert(!/reverseAccrualForRefundedPortion/.test(script),
      '⛔ it does NOT call the shared reverser — that guard refuses `paid` rows by design and must stay that way')

    // ─────────────────────────────────────────────────────────────────────────────────────
    console.log('\n[6] ⛔ THE RECEIPT REPORTS WHAT THE WRITES RETURNED, NOT THE PLAN')
    // THE INCIDENT (2026-07-28): the receipt was built by pushing PLAN rows after each await,
    // never reading what the write returned. It printed "76 rows cancelled" against a ledger
    // that had 76 rows still `paid`. Every check here is behavioural — §[5] above is regex over
    // source text, which is exactly the kind of test that passed while the receipt lied.
    const planRow = (i: number): CohortPlanRow => ({
      id: `e${i}`, orderId: `o${i}`, vendorId: 'v1', eventId: 'ev1', netCents: 100 + i, subtotalCents: 200,
    })
    const PLAN = [planRow(1), planRow(2), planRow(3)]

    // BASELINE — a writer that really changes rows produces a full receipt. Without this the
    // zero-assertions below could pass on a receipt that is broken in every direction.
    const good = await applyCohortRetirement(PLAN, async () => 1)
    assert(good.cancelled === 3 && good.rows.length === 3,
      `BASELINE: a writer reporting 1 change/row yields 3 cancelled rows (got ${good.cancelled})`)
    assert(good.centsCancelled === 101 + 102 + 103,
      `BASELINE: and their cents are summed (got ${good.centsCancelled})`)

    // ⛔ THE CONTROL THIS SECTION EXISTS FOR. The write is a NO-OP; the receipt must say ZERO.
    // The pre-incident code would have reported 3 here — it counted loop iterations.
    const noop = await applyCohortRetirement(PLAN, async () => 0)
    assert(noop.cancelled === 0, `⛔ a NO-OP writer yields 0 rows cancelled (got ${noop.cancelled})`)
    assert(noop.centsCancelled === 0, '⛔ …and 0¢, not the plan\'s total')
    assert(noop.rows.length === 0, '⛔ …and an EMPTY row list, not the 3 rows it intended to change')
    assert(noop.planned === 3, 'while `planned` still reports 3 — intent and result are both shown, never conflated')
    assert(noop.noop.length === 3, 'and the 3 zero-change writes are named as no-ops')

    // A run that changes nothing must SAY so — a property of the printed text, not just counts.
    const noopText = formatCohortReceipt(noop, verifyCohort([{ orderId: 'o1', status: 'paid' }]),
      { timestamp: 'T', actor: 'A', alreadyCancelled: 0 })
    assert(/NOTHING CHANGED/.test(noopText), '⛔ and the printed receipt is headed "NOTHING CHANGED"')
    assert(!/o1 {2}vendor/.test(noopText), '…with no row list, because there is nothing to list')

    // Partial: only CONFIRMED changes count. A silent zero in the middle must not be papered over.
    const partial = await applyCohortRetirement(PLAN, async (r) => (r.id === 'e2' ? 0 : 1))
    assert(partial.cancelled === 2 && partial.noop.length === 1,
      `a mixed run reports exactly the confirmed changes (got ${partial.cancelled} cancelled, ${partial.noop.length} no-op)`)
    assert(partial.centsCancelled === 101 + 103, 'and only the confirmed rows contribute cents')

    // A throwing writer is RECORDED, not swallowed, and never counts as a cancel.
    const threw = await applyCohortRetirement(PLAN, async (r) => { if (r.id === 'e2') throw new Error('boom'); return 1 })
    assert(threw.cancelled === 2 && threw.failed.length === 1, 'a throwing write is recorded as failed, not counted as cancelled')
    assert(threw.failed[0]?.error === 'boom', 'and its error text is kept for the receipt')

    // FINAL-STATE ASSERTION — the check that actually caught the X2 re-heal.
    assert(verifyCohort([{ orderId: 'o1', status: 'cancelled' }]).ok === true,
      'BASELINE: an all-cancelled cohort verifies ok')
    const stuck = verifyCohort([{ orderId: 'o1', status: 'cancelled' }, { orderId: 'o2', status: 'paid' }])
    assert(stuck.ok === false && stuck.stillPaid === 1,
      "⛔ a cohort with ANY row still 'paid' does NOT verify — however good the receipt looked")
    const stuckText = formatCohortReceipt(good, stuck, { timestamp: 'T', actor: 'A', alreadyCancelled: 0 })
    assert(/FINAL STATE WRONG/.test(stuckText) && /Pattern X2/.test(stuckText),
      '…and the receipt says so loudly, naming Pattern X2 as the first suspect')
    assert(/NOT VERIFIED/.test(formatCohortReceipt(good, null, { timestamp: 'T', actor: 'A', alreadyCancelled: 0 })),
      'a failed re-read reports UNKNOWN rather than implying success')

    const scriptSrc = stripComments(readFileSync('scripts/retire-pollution-cohort.ts', 'utf8'))
    assert(/applyCohortRetirement/.test(scriptSrc), 'the script builds its receipt through the tested path…')
    assert(/updateMany/.test(scriptSrc) && /res\.count/.test(scriptSrc),
      '…using updateMany().count as the change count, not a hardcoded 1')
    assert(/status: 'paid'/.test(scriptSrc) && /res\.count === 0/.test(scriptSrc),
      "…guards on status:'paid' IN THE WHERE and writes NO audit when 0 rows change (no un-backed audit row)")
    assert(/process\.exit\(1\)/.test(scriptSrc) && /verification\.ok/.test(scriptSrc),
      '…and exits non-zero when the ledger disagrees with the receipt')

    // ─────────────────────────────────────────────────────────────────────────────────────
    console.log('\n[7] ⛔ Pattern X2 CANNOT re-heal the cohort (the 2026-07-28 incident, reproduced)')
    // On the night, X2 read the 76 fabricated Payout rows as "money moved, ledger lags" and
    // flipped every cancelled row back to `paid` 250ms after the remediation finished. Both
    // directions are asserted: the cohort is immune, and a NON-cohort row is still healed —
    // otherwise this passes by having broken Pattern X entirely.
    const mkHealCase = async (transferId: string) => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: cust.id, vendorId: ven.id, status: 'COMPLETED', fulfillmentType: 'BOOTH_PICKUP',
        subtotal: 29.79, fairSynqFee: 3, total: 33.1, vendorPayout: 29.79, customerName: 'C', customerPhone: '+10000000000',
        placedAt: OLD, completedAt: OLD, stripeChargeId: `ch_${rand()}`,
        orderItems: { create: [{ vendor: { connect: { id: ven.id } }, menuItem: { connect: { id: mi.id } }, itemName: 'X', quantity: 1, unitPrice: 29.79, totalPrice: 29.79, subtotal: 29.79 }] },
        vendorOrderStatuses: { create: [{ vendorId: ven.id, status: 'COMPLETED' }] },
      } })
      await prisma.payout.create({ data: {
        eventId: ev.id, orderId: o.id, vendorId: ven.id, grossAmount: 33.1, fairSynqFee: 3,
        netAmount: 29.79, stripeTransferId: transferId, stripeStatus: 'paid', reversedAt: null,
      } })
      const e = await prisma.vendorEarning.create({ data: {
        eventId: ev.id, orderId: o.id, vendorId: ven.id, subtotalCents: 2979, netCents: 2979, status: 'cancelled',
      } })
      return { earningId: e.id, orderId: o.id, transferId }
    }
    const cohortCase = await mkHealCase(POLLUTED)
    const real       = await mkHealCase(`tr_real_${rand()}`)
    const cohortEarningId = cohortCase.earningId, realEarningId = real.earningId

    const sum: SweepSummary = {
      startedAt: new Date().toISOString(), finishedAt: '', durationMs: 0,
      dryRun: false, patternEEnabled: false, backstopEnabled: false,
      scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
      repaired: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 },
      details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [], X: [] },
      alerted: [], suppressed: [], ambiguousSkipped: 0, backstopWarnings: [],
    }
    await patternX(sum, { scanCeiling: 5000, maxPerPattern: 5000, dryRun: false, windowStart: new Date(Date.now() - 24 * 3600_000) })

    const afterReal   = await prisma.vendorEarning.findUniqueOrThrow({ where: { id: realEarningId }, select: { status: true } })
    const afterCohort = await prisma.vendorEarning.findUniqueOrThrow({ where: { id: cohortEarningId }, select: { status: true } })
    assert(afterReal.status === 'paid',
      `BASELINE: X2 DOES still heal a genuine settled transfer (cancelled → ${afterReal.status}) — the probe is live`)
    assert(afterCohort.status === 'cancelled',
      `⛔ a POLLUTED transfer is NOT healed — stays 'cancelled' (got '${afterCohort.status}'). This is the incident.`)
    assert(sum.suppressed.some(s => s.includes(POLLUTED)),
      'and the skip is SUPPRESSED, never dropped — the cohort still rides the sweep summary count')
    assert(!sum.alerted.some(s => s.includes(POLLUTED)),
      '…without costing an alert line a sweep (nothing here needs a human)')

    // ── X IS THE ONLY PATTERN THAT CAN RESURRECT A COHORT ROW — LOCKED ────────────────────
    // Audited 2026-07-29 across all 16 repaired-incrementing patterns. X is the only one that
    // WRITES VendorEarning, and the only UNWINDOWED consumer of Payout (C is windowed on
    // completedAt and the cohort is 12.6–18.0 days old). If a future pattern grows a
    // VendorEarning write, the cohort skip stops being sufficient at X's loop and belongs in a
    // shared helper — this assertion is what forces that conversation instead of a silent
    // second resurrection.
    const rec = stripComments(readFileSync('lib/reconciler.ts', 'utf8'))
    const veWrites = rec.match(/vendorEarning\.(update|updateMany|upsert|create|createMany|delete|deleteMany)/g) ?? []
    assert(veWrites.length === 1,
      `⛔ exactly ONE VendorEarning write in the whole reconciler (found ${veWrites.length}: ${veWrites.join(', ')}) — a second one needs its own cohort skip`)
    const xBody = rec.slice(rec.indexOf('export async function patternX'))
    assert(xBody.indexOf('isPollutedTransfer') < xBody.indexOf('vendorEarning.updateMany'),
      '…and the cohort skip sits BEFORE that write in patternX, not after it')

    // The C/D chain reaches a VendorEarning write through processOrderPayout. Its gate is what
    // stops a cancelled cohort row being re-paid — asserted here as BEHAVIOUR, both directions.
    const slice = (earningStatus: string | null) => classifyVendorSlice({
      declined: false, earningStatus, connected: true, payoutsFrozen: false, transferCents: 2979,
    })
    assert(slice('cancelled').outcome === 'blocked' && slice('cancelled').blockedReason === 'admin_cancelled',
      "⛔ the C/D chain: processOrderPayout BLOCKS a 'cancelled' slice, so it never reaches the mark-paid write")
    assert(slice('accrued').outcome === 'pay',
      'BASELINE: …while a normal accrued slice still pays — the gate is not blocking everything')

    // The S chain re-accrues through an upsert whose UPDATE branch must never touch status.
    const accrueSrc = stripComments(readFileSync('lib/process-payout.ts', 'utf8'))
    const upsert = accrueSrc.slice(accrueSrc.indexOf('vendorEarning.upsert'), accrueSrc.indexOf('vendorEarning.upsert') + 400)
    assert(/update: \{ subtotalCents \}/.test(upsert),
      "⛔ the S chain: re-accrual's UPDATE branch is `{ subtotalCents }` only — a cancelled row survives re-accrual")

    // ─────────────────────────────────────────────────────────────────────────────────────
    console.log('\n[8] ⛔ Pattern X2 LEAVES A RECORD — the heal is audited, in the same transaction')
    // On 2026-07-28 X2 changed 76 money rows in production and wrote NO AdminMoneyAction. It was
    // reconstructed forensically from paidAt + stripeTransferId, days later. Every assertion here
    // is scoped to the rows seeded above — never a table-wide count.
    const healAudits = await prisma.adminMoneyAction.findMany({
      where: { orderId: real.orderId }, // ← MY fixture only
      select: { actorId: true, actorType: true, action: true, payeeType: true, payeeId: true,
        earningId: true, amountCents: true, reason: true, metadata: true, eventId: true },
    })
    assert(healAudits.length === 1, `⛔ the heal wrote exactly ONE audit row for my order (got ${healAudits.length})`)
    const a = healAudits[0]
    assert(a?.actorType === 'reconciler' && a?.actorId === 'reconciler',
      `actor is reconciler/reconciler — the vocabulary Pattern T already uses (got ${a?.actorType}/${a?.actorId})`)
    assert(a?.action === 'LEDGER_HEAL', `action is LEDGER_HEAL, not a reused payee verb (got ${a?.action})`)
    assert(a?.payeeType === 'vendor' && a?.payeeId === ven.id, 'payee is the vendor whose earning moved')
    assert(a?.earningId === realEarningId, 'it names the exact earning row it changed')
    assert(a?.amountCents === 2979, `and the amount (got ${a?.amountCents})`)
    assert(a?.eventId === ev.id, 'scoped to the event, like every other money audit')
    const md = (a?.metadata ?? {}) as Record<string, unknown>
    assert(md.previousStatus === 'cancelled' && md.newStatus === 'paid',
      `⛔ it records the TRANSITION (${md.previousStatus} → ${md.newStatus}) — the thing forensics had to infer`)
    assert(md.stripeTransferId === real.transferId,
      'and the transfer id it acted on, so a reader need not join back to Payout')
    assert(md.pattern === 'X2', 'and names the pattern')
    assert(/moved NO money/.test(a?.reason ?? ''),
      '⛔ the reason states the reconciler moved no money — a heal is a LEDGER correction, not a payment')

    // The cohort row: no heal, and therefore no audit either. Silence must be complete.
    const cohortAudits = await prisma.adminMoneyAction.count({ where: { orderId: cohortCase.orderId } })
    assert(cohortAudits === 0,
      `⛔ the SKIPPED cohort row wrote no audit at all (got ${cohortAudits}) — a skip is not an action`)

    // ── THE ATOMICITY PROOF ──────────────────────────────────────────────────────────────
    // This is what separates an audit from a log line. A trigger makes the audit INSERT fail;
    // if the write is genuinely in the same transaction, the heal must roll back with it and
    // the earning must survive as 'cancelled'. Test DB only, dropped in `finally`.
    const blocked = await mkHealCase(`tr_real_${rand()}`)
    try {
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION __block_heal() RETURNS trigger AS $$ BEGIN
           RAISE EXCEPTION 'audit blocked for atomicity test'; END; $$ LANGUAGE plpgsql;`)
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER __block_heal_trg BEFORE INSERT ON "AdminMoneyAction"
           FOR EACH ROW WHEN (NEW.action = 'LEDGER_HEAL') EXECUTE FUNCTION __block_heal();`)
      let threw = false
      try {
        await patternX(sum, { scanCeiling: 5000, maxPerPattern: 5000, dryRun: false, windowStart: new Date(Date.now() - 24 * 3600_000) })
      } catch { threw = true }
      assert(threw, 'BASELINE: with the audit insert blocked, the heal transaction THROWS (the probe is live)')
      const after = await prisma.vendorEarning.findUniqueOrThrow({ where: { id: blocked.earningId }, select: { status: true } })
      assert(after.status === 'cancelled',
        `⛔ THE ATOMICITY ASSERTION: a heal whose audit fails ROLLS BACK — earning stayed 'cancelled' (got '${after.status}'). ` +
        `If this reads 'paid', the audit is a log line beside the write, not a record of it.`)
      const orphan = await prisma.adminMoneyAction.count({ where: { orderId: blocked.orderId } })
      assert(orphan === 0, '…and no audit row survives either — neither half committed')
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS __block_heal_trg ON "AdminMoneyAction";`)
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS __block_heal();`)
    }

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `✅ pollution-cohort-guard: ${pass} passed, 0 failed` : `❌ pollution-cohort-guard: ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('[pollution-cohort-guard] FAILED:', e); await cleanup(); process.exit(1) })
