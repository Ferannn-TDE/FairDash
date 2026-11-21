/**
 * RUNNER ORDER VIEW GUARD — audit H3.
 *
 * GET /api/runners/me/orders returned every Order column to any runner at the fair, approved or
 * not: customer name, phone, home address with GPS point, licence plate, Stripe ids and the
 * platform money split, for every order still waiting for a runner.
 *
 * The fix is lib/runner-order-view.ts: one select both route branches use, and one builder that
 * decides field by field what leaves the server. Customer data goes only to the runner the order
 * is assigned to, and only what that fulfillment type needs.
 *
 * This suite checks the builder by the EXACT set of keys it returns (an extra key fails, not just
 * a missing one), with a positive control so "no customer data" cannot pass on a row that never
 * had any. The route wiring is checked as source.
 *
 * Pure — no database, no server. Run: npx tsx scripts/runner-order-view-guard.ts
 */

import { readFileSync } from 'node:fs'
import {
  RUNNER_ORDER_SELECT,
  customerDisplayName,
  toRunnerOrderView,
  type RunnerOrderRow,
} from '../lib/runner-order-view'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

const keysOf = (o: object) => Object.keys(o).sort()
const sameKeys = (o: object, expected: readonly string[]) =>
  JSON.stringify(keysOf(o)) === JSON.stringify([...expected].sort())

const BASE_KEYS = [
  'id', 'status', 'runnerId', 'fulfillmentType', 'readyAt', 'collectedAt', 'returnRequestedAt',
  'deliveryFee', 'tip', 'vendor', 'orderItems',
] as const
const CURBSIDE_KEYS = ['customerName', 'customerPhone', 'vehicleMake', 'vehicleColor', 'vehiclePlate', 'pickupLocation'] as const
const DELIVERY_KEYS = [
  'customerPhone', 'deliveryStreet', 'deliveryUnit', 'deliveryCity', 'deliveryState', 'deliveryZip',
  'deliveryGeoPrecision',
] as const

/** Never in any runner response, whoever the runner is. */
const NEVER_KEYS = [
  'customerId', 'deliveryLat', 'deliveryLng',
  'stripePaymentIntentId', 'stripeChargeId', 'stripeTransferId', 'tipRefundId',
  'subtotal', 'total', 'fairSynqFee', 'vendorPayout', 'serviceCharge', 'cancellationFee', 'deliveryFeeRefundCents',
  'runnerVehicleMake', 'runnerVehicleColor', 'runnerVehiclePlate', 'runnerConfirmedLat', 'runnerConfirmedLng',
  'deliveryProofPath', 'cancelledBy', 'cancellationReason', 'voidedAt', 'voidReason', 'strandedReason', 'payoutStatus',
] as const
/** Every customer field: none of these may reach a runner who is not assigned the order. */
const CUSTOMER_KEYS = [...new Set([...CURBSIDE_KEYS, ...DELIVERY_KEYS])]

const ME = 'runner-me'
const OTHER = 'runner-other'

function row(fulfillmentType: RunnerOrderRow['fulfillmentType'], runnerId: string | null): RunnerOrderRow {
  return {
    id: 'order-1',
    status: runnerId ? 'RUNNER_COLLECTED' : 'READY',
    runnerId,
    fulfillmentType,
    readyAt: new Date('2026-11-09T18:00:00Z'),
    collectedAt: null,
    returnRequestedAt: null,
    deliveryFee: 5,
    tip: 2,
    vendor: { name: 'Taco Stand', boothNumber: 'B12' },
    orderItems: [{ id: 'item-1', quantity: 2, menuItem: { name: 'Taco' } }],
    customerName: 'Jane Doe',
    customerPhone: '+15550100',
    vehicleMake: 'Toyota',
    vehicleColor: 'Silver',
    vehiclePlate: 'ABC 1234',
    pickupLocation: 'Row A',
    deliveryStreet: '1 Main St',
    deliveryUnit: 'Apt 2',
    deliveryCity: 'Springfield',
    deliveryState: 'IL',
    deliveryZip: '62701',
    deliveryGeoPrecision: 'ROOFTOP',
  }
}

function main() {
  console.log('\n══ RUNNER ORDER VIEW (H3) ══')

  // ── [1] an order not assigned to me shows only the base fields ─────────────────────────────
  console.log('\n[1] an order not assigned to this runner carries no customer data')
  for (const type of ['CURBSIDE', 'HOME_DELIVERY'] as const) {
    for (const [label, owner] of [['unassigned', null], ["another runner's", OTHER]] as const) {
      const view = toRunnerOrderView(row(type, owner), ME)
      assert(sameKeys(view, BASE_KEYS), `${type}, ${label}: keys are exactly the base set (got ${keysOf(view).join(',')})`)
      const leaked = [...CUSTOMER_KEYS, ...NEVER_KEYS].filter(k => k in view)
      assert(leaked.length === 0, `${type}, ${label}: no customer or forbidden key (leaked: [${leaked.join(', ')}])`)
    }
  }

  // ── [2] own CURBSIDE ────────────────────────────────────────────────────────────────────────
  console.log('\n[2] own CURBSIDE order: base + what the curbside handoff needs')
  const curb = toRunnerOrderView(row('CURBSIDE', ME), ME)
  assert(sameKeys(curb, [...BASE_KEYS, ...CURBSIDE_KEYS]), `keys are exactly base + curbside (got ${keysOf(curb).join(',')})`)
  assert('customerName' in curb && curb.customerName === 'Jane D.', 'the name is first name + last initial, not the full name')
  assert(!('deliveryStreet' in curb), 'no address keys on a curbside order')

  // ── [3] own HOME_DELIVERY ───────────────────────────────────────────────────────────────────
  console.log('\n[3] own HOME_DELIVERY order: base + phone + the address the current page shows')
  const home = toRunnerOrderView(row('HOME_DELIVERY', ME), ME)
  assert(sameKeys(home, [...BASE_KEYS, ...DELIVERY_KEYS]), `keys are exactly base + delivery (got ${keysOf(home).join(',')})`)
  assert(!('customerName' in home), 'no customer name on a delivery order')
  assert(!('vehiclePlate' in home), 'no vehicle on a delivery order')
  const homeNever = NEVER_KEYS.filter(k => k in home)
  assert(homeNever.length === 0, `no GPS point, Stripe id or platform money (leaked: [${homeNever.join(', ')}])`)

  // ── [4] own BOOTH_PICKUP: the builder's fallback ────────────────────────────────────────────
  console.log('\n[4] an own order of any other type falls back to the base fields')
  const booth = toRunnerOrderView(row('BOOTH_PICKUP', ME), ME)
  assert(sameKeys(booth, BASE_KEYS), `BOOTH_PICKUP: keys are exactly the base set (got ${keysOf(booth).join(',')})`)

  // ── [5] positive control ────────────────────────────────────────────────────────────────────
  console.log('\n[5] positive control: the same rows DO carry customer data for their own runner')
  assert('customerPhone' in curb && curb.customerPhone === '+15550100', 'own curbside order carries the phone')
  assert('deliveryStreet' in home && home.deliveryStreet === '1 Main St', 'own delivery order carries the street')
  assert(row('CURBSIDE', null).customerPhone !== null, 'the input row for [1] really had customer data to leak')

  // ── [6] nested objects ──────────────────────────────────────────────────────────────────────
  console.log('\n[6] vendor and items carry only what the pages show')
  assert(sameKeys(curb.vendor, ['name', 'boothNumber']), `vendor keys are name, boothNumber (got ${keysOf(curb.vendor).join(',')})`)
  assert(curb.orderItems.every(i => sameKeys(i, ['id', 'quantity', 'menuItem']) && sameKeys(i.menuItem, ['name'])),
    'each item is id, quantity and menuItem.name only')

  // ── [7] customerDisplayName ─────────────────────────────────────────────────────────────────
  console.log('\n[7] first name + last initial, server-side')
  const names: Array<[string | null, string | null]> = [
    ['Jane Doe', 'Jane D.'],
    ['Cher', 'Cher'],
    ['  Mary  Ann  Smith ', 'Mary S.'],
    ['jane doe', 'jane D.'],
    ['Zoë Ångström', 'Zoë Å.'],
    ['', null],
    ['   ', null],
    [null, null],
  ]
  for (const [input, expected] of names) {
    const got = customerDisplayName(input)
    assert(got === expected, `${JSON.stringify(input)} → ${JSON.stringify(expected)} (got ${JSON.stringify(got)})`)
  }

  // ── [8] the select itself ───────────────────────────────────────────────────────────────────
  console.log('\n[8] RUNNER_ORDER_SELECT never loads a forbidden column')
  const selectKeys = Object.keys(RUNNER_ORDER_SELECT)
  const inSelect = NEVER_KEYS.filter(k => selectKeys.includes(k))
  assert(inSelect.length === 0, `no forbidden column is selected (found: [${inSelect.join(', ')}])`)
  assert(selectKeys.includes('customerPhone'), 'positive control: the select does load the customer phone the builder gates')

  // ── [9] route wiring, read as source ────────────────────────────────────────────────────────
  console.log('\n[9] the route uses the select and the builder in both branches, behind the approval gate')
  const raw = readSource('app/api/runners/me/orders/route.ts')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert(/audit H3/.test(raw) && !/audit H3/.test(src), '[0] control: comment stripping works on this file')
  assert((src.match(/select: RUNNER_ORDER_SELECT/g) ?? []).length === 2, 'both queries use select: RUNNER_ORDER_SELECT')
  assert(!/include:/.test(src), 'no include: is left in the route')
  assert(/success\(\{ order: toRunnerOrderView\(order, runner\.id\) \}\)/.test(src), 'the single-order response goes through the builder')
  assert(/orders: orders\.map\(o => toRunnerOrderView\(o, runner\.id\)\)/.test(src), 'the list response goes through the builder')
  const gate = src.search(/if \(runner\.approvalStatus !== 'APPROVED'\) \{\s*return apiError\('Runner account is not approved', 403, 'RUNNER_NOT_APPROVED'\)/)
  const firstOrderRead = src.indexOf('db.order.')
  assert(gate > 0 && firstOrderRead > gate, 'the approval gate (403 RUNNER_NOT_APPROVED) runs before any order is read')
  assert(src.includes('runnerFeedWhere(') && src.includes('runnerOrderDetailWhere('), 'the shared feed predicates are still used')

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
