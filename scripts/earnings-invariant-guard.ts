/**
 * THE UNPAID-EARNINGS INVARIANT — an order the customer never paid for owes the vendor $0.
 *
 * WHAT WENT WRONG. `OrderForEarnings` did not carry `Order.status`, so `computeVendorOrderEarnings`
 * could not tell a paid order from one still awaiting Stripe. Its `else` branch — "no settled
 * payout yet, so quote a conservative estimate" — was therefore reachable by orders that had never
 * been paid for, and it quoted take-home for money that never arrived. A live vendor was shown
 * "~$10.94 pending" for a PENDING_PAYMENT order.
 *
 * WHY IT REACHED TWO SURFACES AND NOT FIVE. The invariant had nowhere to live inside the helper, so
 * each of the five readers enforced it (or didn't) in its own WHERE clause:
 *   • three used an explicit status ALLOWLIST                       → safe, by luck of shape
 *   • analytics scoped on `voidedAt: null` alone                    → leaked
 *   • admin-fair-reports used a `!== CANCELLED` DENYLIST            → leaked
 * `admin-fair-reports` even documents its own copy in a comment ("computeVendorOrderEarnings only
 * zeroes DECLINED, not CANCELLED…") — a call site hand-patching around the helper's blindness,
 * which patched one status and missed another. That comment is the whole argument for putting the
 * invariant in the TYPE rather than in a shared function: a function can be not-called; a required
 * field cannot be not-passed.
 *
 * WHAT THIS GUARD PROTECTS, in three parts:
 *   [1] the helper zeroes unpaid orders, and still does everything else it used to
 *   [2] every call site actually feeds it the status (a source scan — catches the NEXT query)
 *   [3] positive controls on the probes themselves
 *
 * [3] IS NOT OPTIONAL. This repo has been bitten three times by negative suites that passed
 * vacuously — an assertion that "X is absent" is worthless until you have proven the check can see
 * an X. Every negative below is paired with a control that MUST fail the same assertion.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  computeVendorOrderEarnings,
  sumVendorEarnings,
  type OrderForEarnings,
} from '../lib/vendor-earnings'
import { PAID_ORDER_STATUSES, isPaidOrderStatus } from '../lib/order-status'
import { POLLUTED_TRANSFER_IDS } from '../lib/pollution-cohort'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => {
  if (c) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const REAL_TX = 'tr_3Tvl9NHk5f3uB8J900UakK3u'

/** One vendor, one $12 slice. `status` and `payouts` are what each case varies. */
function order(over: Partial<OrderForEarnings> = {}): OrderForEarnings {
  return {
    total: 13.20,
    status: 'COMPLETED',
    orderItems: [{ vendorId: 'v1', subtotal: 12.00 }],
    payouts: [],
    refunds: [],
    vendorOrderStatuses: [{ vendorId: 'v1', status: 'COMPLETED' }],
    ...over,
  }
}
const settledPayout = [{ vendorId: 'v1', netAmount: 10.84, reversedAt: null, stripeTransferId: REAL_TX }]

// ── [1] the helper zeroes unpaid orders ───────────────────────────────────────
console.log('\n[1] an order the customer never paid for contributes $0')

// [0] BASELINE FIRST. Every assertion below claims "$0"; that claim is meaningless until a
// paid order has been shown to produce a NON-zero number through the same code path.
const paid = computeVendorOrderEarnings(order(), 'v1')
assert(paid.cents > 0 && paid.status === 'estimated',
  `[0] positive control: a PAID order still earns (got ${paid.cents}¢ / ${paid.status}) — "$0" is not vacuous`)

const unpaid = computeVendorOrderEarnings(order({ status: 'PENDING_PAYMENT' }), 'v1')
assert(unpaid.cents === 0 && unpaid.status === 'unpaid',
  `PENDING_PAYMENT + real slice + no payout → $0 (got ${unpaid.cents}¢ / ${unpaid.status})`)

// The no-VOS-row case: the order the live leak was actually made of. It is unpaid AND has no
// VendorOrderStatus row, and each of those alone used to be invisible to the estimator.
const noVos = computeVendorOrderEarnings(
  order({ status: 'PENDING_PAYMENT', vendorOrderStatuses: [] }), 'v1')
assert(noVos.cents === 0 && noVos.status === 'unpaid',
  `unpaid AND no VendorOrderStatus row → $0 (got ${noVos.cents}¢ / ${noVos.status})`)

// A measurement outranks a prediction: the guard suppresses the ESTIMATE branch, never a real
// transfer. If money genuinely moved, hiding it would understate a balance the vendor has.
const unpaidButTransferred = computeVendorOrderEarnings(
  order({ status: 'PENDING_PAYMENT', payouts: settledPayout }), 'v1')
assert(unpaidButTransferred.status === 'settled' && unpaidButTransferred.cents === 1084,
  'an unpaid order with a REAL settled transfer still reports settled — the guard suppresses predictions, not measurements')

console.log('\n[1b] aggregation: an unpaid order lands in NO bucket and NO tally')
const mixed = sumVendorEarnings([
  order({ payouts: settledPayout }),          // settled 1084¢
  order({ status: 'PENDING_PAYMENT' }),       // unpaid — must vanish entirely
], 'v1')
assert(mixed.settledCents === 1084, `settledCents unaffected by the unpaid order (got ${mixed.settledCents}¢)`)
assert(mixed.estimatedCents === 0, `estimatedCents is 0 — the unpaid order is NOT "pending" (got ${mixed.estimatedCents}¢)`)
assert(mixed.settledOrders === 1 && mixed.pendingOrders === 0,
  `counts too: settledOrders=1 pendingOrders=0 (got ${mixed.settledOrders}/${mixed.pendingOrders})`)
// The control for the pair above: with the unpaid order made PAID, both DO move — proving the
// zeros come from the invariant and not from a fixture that never contributes anything.
const control = sumVendorEarnings([order({ payouts: settledPayout }), order()], 'v1')
assert(control.estimatedCents > 0 && control.pendingOrders === 1,
  `[0] positive control: the same fixture PAID does populate pending (got ${control.estimatedCents}¢ / ${control.pendingOrders})`)

console.log('\n[1c] regression pins — the states that already worked must keep working')
assert(computeVendorOrderEarnings(order({ vendorOrderStatuses: [{ vendorId: 'v1', status: 'DECLINED' }] }), 'v1').cents === 0,
  'DECLINED → $0')
assert(computeVendorOrderEarnings(order({ payouts: [{ ...settledPayout[0], reversedAt: new Date() }] }), 'v1').status === 'reversed',
  'a reversed payout (chargeback clawback) → reversed')
assert(computeVendorOrderEarnings(order({ payouts: [{ ...settledPayout[0], stripeTransferId: [...POLLUTED_TRANSFER_IDS][0] }] }), 'v1').status === 'excluded',
  'a fabricated transfer → excluded (renders as nothing at all)')
const refunded = computeVendorOrderEarnings(
  order({ payouts: settledPayout, refunds: [{ vendorId: 'v1', status: 'COMPLETED', amountCents: 500 }] }), 'v1')
assert(refunded.status === 'refunded' && refunded.cents === 584,
  `a completed refund leaves the remainder (got ${refunded.cents}¢ / ${refunded.status})`)

// ── [2] PAID_ORDER_STATUSES is an allowlist, and an exhaustive one ────────────
console.log('\n[2] the status allowlist')
assert(!isPaidOrderStatus('PENDING_PAYMENT'), 'PENDING_PAYMENT is NOT a paid status')
assert(isPaidOrderStatus('COMPLETED') && isPaidOrderStatus('DELIVERED'),
  '[0] positive control: COMPLETED/DELIVERED ARE paid — the predicate is not simply always-false')
assert(isPaidOrderStatus('CANCELLED'),
  'CANCELLED counts as paid: money WAS captured; whether the vendor keeps it is the refund engine\'s call')
assert(!isPaidOrderStatus('NOT_A_REAL_STATUS'),
  'an unknown status is not paid — a new enum member is $0 until someone decides otherwise')

// The list must stay exhaustive over the Prisma enum. Reading the schema rather than importing
// the enum keeps this honest when the client is stale.
const schema = readFileSync('prisma/schema.prisma', 'utf8')
const enumBody = schema.match(/enum OrderStatus \{([\s\S]*?)\}/)?.[1] ?? ''
const enumValues = enumBody.split('\n').map(l => l.trim().split(/[\s/]/)[0]).filter(Boolean)
assert(enumValues.length > 5, `[0] probe anchor: parsed ${enumValues.length} OrderStatus values from the schema`)
const unclassified = enumValues.filter(v => v !== 'PENDING_PAYMENT' && !isPaidOrderStatus(v))
assert(unclassified.length === 0,
  `every OrderStatus is classified paid/unpaid — unclassified: [${unclassified.join(', ')}]`)

// ── [3] SOURCE SCAN — every earnings reader hands the helper a status ─────────
// This is the part that catches the NEXT query rather than the two already fixed. Comments are
// stripped FIRST: the same code-vs-prose trap that let an unfiltered nav pass its own check.
console.log('\n[3] every call site feeds the helper a status (source scan)')

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, acc)
    else if (/\.tsx?$/.test(e.name)) acc.push(p)
  }
  return acc
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const callers = sources('app').concat(sources('lib'))
  .filter(f => !f.endsWith('lib/vendor-earnings.ts'))
  .filter(f => /computeVendorOrderEarnings|sumVendorEarnings/.test(strip(readFileSync(f, 'utf8'))))

assert(callers.length >= 4, `[0] probe anchor: found ${callers.length} earnings call sites to scan (not zero)`)

/**
 * ONE regex, used by the scan AND by its controls below — deliberately not two copies. A probe
 * whose positive control uses a different pattern than the check proves nothing about the check.
 *
 * Three legal spellings, because a status reaches the helper three ways:
 *   `status: true`     a Prisma select   (analytics, admin money)
 *   `status: o.status` a forwarded row   (admin-fair-reports)
 *   `status: string`   a declared row type, with the select in the route that fills it
 *                      (vendor-active-order, vendor-order-history)
 *
 * NOTE the real enforcement is `tsc`: `OrderForEarnings.status` is REQUIRED, so any of these
 * going missing fails the build before this suite runs. This scan is the readable second opinion
 * — it names the file in the gate output instead of leaving a type error to be interpreted.
 */
const PASSES_STATUS = /\bstatus:\s*(true|string|[A-Za-z_$][\w$]*\.status)/

for (const f of callers) {
  assert(PASSES_STATUS.test(strip(readFileSync(f, 'utf8'))),
    `${f} passes a status to the earnings helper`)
}

// The control for the scan: a select that omits status MUST be flagged. Without this, a regex
// that silently matched everything would report all-green forever.
assert(PASSES_STATUS.test(`select: { total: true, status: true, orderItems: { select: { vendorId: true } } }`),
  '[0] positive control: the scanner PASSES a select that includes status: true')
assert(!PASSES_STATUS.test(`select: { total: true, orderItems: { select: { vendorId: true } } }`),
  '[0] positive control: the scanner FLAGS a select that omits it')

// ── [4] the badge union is not a second hand-written copy ────────────────────
console.log('\n[4] the display badge derives its states from the helper')
const badge = strip(readFileSync('app/_components/EarningsBadge.tsx', 'utf8'))
assert(/export type \{ EarningsStatus \} from '@\/lib\/vendor-earnings'/.test(badge),
  'EarningsBadge RE-EXPORTS the union rather than redeclaring it (it used to be a hand-written copy)')
assert(!/export type EarningsStatus =\s*'/.test(badge),
  'no literal union is declared in the badge — a new earnings state cannot go unrendered')
assert(/unpaid:\s*\{/.test(badge),
  "the badge has a shape for 'unpaid' (the state map is TOTAL over the union)")

console.log(`\n${'─'.repeat(64)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(64)}`)
process.exit(fail === 0 ? 0 : 1)
