/**
 * ORDER-ITEMIZATION GUARD — one helper describes what a customer paid and got back
 * (readiness 1.3), and nothing reads the deprecated Cancellation refund columns.
 *
 *   [1] BEHAVIOR — itemizeOrder on hand-built orders. Every expected number is a
 *       literal, never computed with the code under test.
 *   [2] WIRING — the customer and organizer order routes both go through itemizeOrder,
 *       and the customer order card renders it instead of adding up order fields.
 *   [3] EXPAND STEP — Cancellation.refundIssued/refundAmount are out of the Prisma model,
 *       and nothing in app/ or components/ mentions them in code.
 *   [4] SCANNER CONTROL — the [3] scanner catches a planted read and ignores a comment,
 *       so it can't pass vacuously.
 *
 * Run:  npx tsx scripts/order-itemization-guard.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { itemizeOrder, type ItemizationInput } from '../lib/order-itemization'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Two vendors: Taco Stand $12.00, Lemonade $8.00. Fee $2.00, delivery $5.99, tip $3.00.
const items = [
  { vendorId: 'vA', subtotal: 7.5, vendor: { name: 'Taco Stand' } },
  { vendorId: 'vB', subtotal: 8, vendor: { name: 'Lemonade' } },
  { vendorId: 'vA', subtotal: 4.5, vendor: { name: 'Taco Stand' } },
]
const base: ItemizationInput = {
  fulfillmentType: 'HOME_DELIVERY',
  subtotal: 20, fairSynqFee: 2, deliveryFee: 5.99, serviceCharge: null, tip: 3, total: 30.99,
  orderItems: items, refunds: [], tipRefundId: null, deliveryFeeRefundCents: null,
}

console.log('[1a] normal paid delivery order')
{
  const it = itemizeOrder(base)
  assert(eq(it.charges.map(l => [l.label, l.cents]), [['Subtotal', 2000], ['Delivery fee', 599], ['Tip', 300], ['Service fee', 200]]),
    'charge lines: Subtotal 2000, Delivery fee 599, Tip 300, Service fee 200')
  assert(it.linesSumCents === 3099 && it.totalCents === 3099 && it.reconciles, 'lines add up to the $30.99 total')
  assert(it.refunds.length === 0 && it.refundedCents === 0 && it.serviceFeeKept === null && !it.fullCancel, 'no refunds, no kept line')
  assert(it.netPaidCents === 3099 && it.refundSummary === '', 'net paid 3099, empty summary')
}

console.log('[1b] fully auto-cancelled: food per vendor + delivery & tip, service fee kept')
{
  const it = itemizeOrder({
    ...base,
    refunds: [{ vendorId: 'vB', status: 'COMPLETED', amountCents: 800 }, { vendorId: 'vA', status: 'COMPLETED', amountCents: 1200 }],
    tipRefundId: 're_owed', deliveryFeeRefundCents: 599,
  })
  assert(eq(it.refunds.map(r => [r.label, r.cents, r.status]), [
    ['Food · Taco Stand', 1200, 'REFUNDED'], ['Food · Lemonade', 800, 'REFUNDED'], ['Delivery & tip', 899, 'REFUNDED'],
  ]), 'lines: Taco Stand 1200, Lemonade 800 (item order, not row order), Delivery & tip 899')
  const dt = it.refunds.find(r => r.key === 'delivery_tip')
  assert(dt?.key === 'delivery_tip' && dt.tipCents === 300 && dt.feeCents === 599, 'delivery & tip splits as tip 300 + fee 599')
  assert(it.refundedCents === 2899 && it.netPaidCents === 200, 'refunded 2899, net 200')
  assert(it.fullCancel && it.serviceFeeKept?.label === 'Service fee (non-refundable)' && it.serviceFeeKept.cents === 200,
    'full cancel: kept line reads "Service fee (non-refundable)" $2.00')
  assert(it.refundSummary === 'Food refunded $20.00 · Delivery & tip refunded $8.99', `summary (got "${it.refundSummary}")`)
}

console.log('[1c] partial multi-vendor cancel: one vendor refunded, the delivery stood')
{
  const it = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'COMPLETED', amountCents: 1200 }] })
  assert(eq(it.refunds.map(r => [r.label, r.cents]), [['Food · Taco Stand', 1200]]), 'only Taco Stand food is refunded')
  assert(it.refundedCents === 1200 && it.netPaidCents === 1899, 'refunded 1200, net 1899')
  assert(!it.fullCancel && it.serviceFeeKept === null, 'partial cancel: no service fee line at all')
  assert(it.refundSummary === 'Food refunded $12.00', 'summary names food only')
}

console.log('[1d] marker written before the fee was owed back → tip only')
{
  const it = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'COMPLETED', amountCents: 1200 }, { vendorId: 'vB', status: 'COMPLETED', amountCents: 800 }], tipRefundId: 're_old' })
  const dt = it.refunds.find(r => r.key === 'delivery_tip')
  assert(dt?.label === 'Tip' && dt.cents === 300, 'label "Tip", 300')
  assert(it.refundedCents === 2300 && it.netPaidCents === 799, 'refunded 2300, net 799 (delivery fee not refunded)')
}

console.log('[1e] waived service-fee share shows as its own line')
{
  const it = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'COMPLETED', amountCents: 1320 }] })
  assert(eq(it.refunds.map(r => [r.key, r.cents]), [['food', 1200], ['service_fee', 120]]), 'food 1200 + service fee 120')
  assert(it.refundedCents === 1320 && it.serviceFeeKept === null, 'refunded 1320; partial, so no kept line')
  const both = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'COMPLETED', amountCents: 1320 }, { vendorId: 'vB', status: 'COMPLETED', amountCents: 880 }] })
  assert(both.fullCancel === true && both.serviceFeeKept === null, 'full cancel with the whole fee waived → nothing kept, no line')
  assert(it.refundSummary === 'Food refunded $12.00 · Service fee refunded $1.20', 'summary includes the waived fee')
}

console.log('[1f] partial override stays food; PENDING is processing; FAILED is ignored')
{
  const it = itemizeOrder({ ...base, refunds: [
    { vendorId: 'vA', status: 'COMPLETED', amountCents: 500 },
    { vendorId: 'vB', status: 'PENDING', amountCents: 800 },
  ] })
  assert(eq(it.refunds.map(r => [r.cents, r.status]), [[500, 'REFUNDED'], [800, 'PROCESSING']]), 'partial 500 refunded, 800 processing')
  assert(it.refundedCents === 500 && it.processingCents === 800 && it.netPaidCents === 2599, 'processing not counted as refunded')
  assert(!it.fullCancel && it.serviceFeeKept === null, 'a partial amount on one vendor is a partial cancel: no fee line')
  const pend = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'COMPLETED', amountCents: 1200 }, { vendorId: 'vB', status: 'PENDING', amountCents: 800 }] })
  assert(pend.fullCancel && pend.serviceFeeKept?.cents === 200, 'every slice back (one still processing) is a full cancel: fee line shown')
  const failed = itemizeOrder({ ...base, refunds: [{ vendorId: 'vA', status: 'FAILED', amountCents: 1200 }] })
  assert(failed.refunds.length === 0 && failed.refundedCents === 0 && failed.serviceFeeKept === null && !failed.fullCancel, 'FAILED row shows nothing and is not a cancel')
}

console.log('[1g] curbside and booth pickup labels')
{
  const curb = itemizeOrder({ ...base, fulfillmentType: 'CURBSIDE', tipRefundId: 're_c', deliveryFeeRefundCents: 599 })
  assert(curb.charges[1]?.label === 'Curbside fee', 'charge label "Curbside fee"')
  assert(curb.refunds[0]?.label === 'Curbside & tip' && curb.refunds[0].cents === 899, 'refund label "Curbside & tip" 899')
  const feeOnly = itemizeOrder({ ...base, tip: 0, total: 27.99, tipRefundId: 're_f', deliveryFeeRefundCents: 599 })
  assert(feeOnly.refunds[0]?.label === 'Delivery fee' && feeOnly.refunds[0].cents === 599, 'fee-only refund label "Delivery fee"')
  const booth = itemizeOrder({ ...base, fulfillmentType: 'BOOTH_PICKUP', deliveryFee: null, tip: null, total: 22 })
  assert(eq(booth.charges.map(l => l.key), ['subtotal', 'service_fee']) && booth.reconciles, 'booth pickup: subtotal + service fee, reconciles')
  const sc = itemizeOrder({ ...base, serviceCharge: 1.25, total: 32.24 })
  assert(sc.charges.some(l => l.label === 'Event service charge' && l.cents === 125) && sc.reconciles, 'event service charge is its own line')
}

console.log('[1h] a total that disagrees with its lines is flagged, and the charged total still shown')
{
  const it = itemizeOrder({ ...base, total: 31.5 })
  assert(!it.reconciles && it.totalCents === 3150 && it.linesSumCents === 3099, 'reconciles=false, totalCents is Order.total')
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('[2] wiring')
const src = (p: string) => readFileSync(p, 'utf8')
const customerRoute = src('app/api/orders/[id]/route.ts')
const organizerRoute = src('app/api/organizer/fairs/[fairSlug]/orders/[orderId]/route.ts')
const card = src('components/order/OrderComponents.tsx')
assert(/itemizeOrder\(/.test(customerRoute) && /itemization\b/.test(customerRoute), 'customer route returns itemizeOrder output')
assert(/refunds:\s*\{\s*select:/.test(customerRoute) && !/cancellation:\s*true/.test(customerRoute), 'customer route loads Refund rows and selects cancellation fields explicitly')
assert(/itemizeOrder\(/.test(organizerRoute) && !/refundedCents\s*=\s*order\.refunds/.test(organizerRoute), 'organizer route uses the helper, no inline refund sum')
assert(!/order\.(deliveryFee|serviceCharge|fairSynqFee|tip)\b/.test(card), 'order card reads no raw fee fields (renders itemization)')

// ─────────────────────────────────────────────────────────────────────────────
console.log('[3] expand step')
const fields = Object.keys(Prisma.CancellationScalarFieldEnum)
assert(fields.includes('reason') && !fields.includes('refundIssued') && !fields.includes('refundAmount'),
  `Cancellation model has reason but not refundIssued/refundAmount (fields: ${fields.join(', ')})`)

const BANNED = /\b(refundIssued|refundAmount)\b/
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const scan = (text: string) => BANNED.test(stripComments(text))
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p)
  }
  return out
}
const files = [...walk('app'), ...walk('components')]
const offenders = files.filter(f => scan(readFileSync(f, 'utf8')))
assert(files.length > 100, `scanned ${files.length} files in app/ and components/`)
assert(offenders.length === 0, `no code reads refundIssued/refundAmount${offenders.length ? ` — ${offenders.join(', ')}` : ''}`)

// ─────────────────────────────────────────────────────────────────────────────
console.log('[4] scanner control')
assert(scan('const x = order.cancellation.refundIssued'), 'catches a planted property read')
assert(scan('select: { refundAmount: true }'), 'catches a planted select key')
assert(!scan('// the deprecated refundIssued column\nconst y = 1'), 'ignores a line comment')
assert(!scan('/* refundAmount drifted */ const z = 2'), 'ignores a block comment')
assert(!scan('const refundAmountCents = 5'), 'does not match refundAmountCents')

console.log(`\n${fail === 0 ? '✅' : '❌'} order-itemization guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
