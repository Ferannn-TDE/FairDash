/**
 * ACTIVE-SHAPE GUARD — /api/vendors/:id/orders/active must return what its consumers read.
 *
 * Third instance of the partial-rows class forced the class fix: the route returned a subset
 * while the dashboard's hand-written interface promised customerName/phone, delivery address,
 * and vehicle fields — home-delivery cards rendered "undefined, undefined" (street, city).
 * Instance two was bf981f2's vacuous ready-lane gate (missing fulfillmentType).
 *
 * The contract now lives in lib/vendor-active-order (one type + one mapper) and is enforced at
 * COMPILE time in both directions — proven by positive control on 2026-07-21: deleting
 * deliveryCity from the route's select fails `tsc --noEmit` with "Property 'deliveryCity' is
 * missing … required in type 'VendorActiveOrderRow'". The `typecheck` suite runs tsc in the
 * gate, so that enforcement fires on every batch run, not only at deploy.
 *
 * This guard pins the WIRING the compiler can't see the intent of:
 *   [1] BEHAVIOR — the real mapper fills every contract field from a full row (and scopes
 *       items + subtotal to the vendor, never the whole order).
 *   [2] SOURCE SHAPE — route uses the shared mapper (no inline re-mapping); dashboard imports
 *       the shared type (no hand-written VendorOrder interface can drift back in).
 *
 * Run:  npx tsx scripts/active-shape-guard.ts
 */

import { readFileSync } from 'node:fs'
import { toVendorActiveOrder, type VendorActiveOrder, type VendorActiveOrderRow } from '../lib/vendor-active-order'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

console.log('[1] behavior: the shared mapper fills the whole contract, scoped to the vendor')
const row: VendorActiveOrderRow = {
  id: 'o1', status: 'PLACED', placedAt: new Date(), total: 45,
  fulfillmentType: 'HOME_DELIVERY',
  customerName: 'Cust', customerPhone: '+15550001111',
  vehicleMake: null, vehicleColor: null, vehiclePlate: null,
  deliveryStreet: '1 Fair Way', deliveryCity: 'Fairville', collectedAt: null,
  vendorOrderStatuses: [{ vendorId: 'v1', status: 'ACCEPTED', version: 3 }],
  payouts: [], refunds: [],
  orderItems: [
    { id: 'i1', quantity: 2, unitPrice: 10, subtotal: 20, itemName: 'Tacos', vendorId: 'v1' },
    { id: 'i2', quantity: 1, unitPrice: 25, subtotal: 25, itemName: 'OtherVendorThing', vendorId: 'v2' },
  ],
}
const dto = toVendorActiveOrder(row, 'v1')

// Every contract field present — `undefined` can never reach a card again.
const missing = (Object.keys(dto) as (keyof VendorActiveOrder)[]).filter(k => dto[k] === undefined)
assert(missing.length === 0, `no contract field is undefined (missing: ${missing.join(', ') || 'none'})`)
for (const k of ['customerName', 'customerPhone', 'deliveryStreet', 'deliveryCity'] as const) {
  assert(dto[k] === row[k], `${k} passes through (the field that used to render "undefined")`)
}
assert(dto.status === 'ACCEPTED' && dto.version === 3, 'status + version come from THIS vendor\'s VOS row')
assert(dto.vendorSubtotal === 20 && dto.orderItems.length === 1, 'items + subtotal scoped to the vendor slice, never the full order')
assert(dto.earningsStatus === 'estimated', 'pre-payout earnings honestly marked estimated')

console.log('\n[2] source shape: producer and consumer are wired to the ONE contract')
const route = readFileSync(new URL('../app/api/vendors/[id]/orders/active/route.ts', import.meta.url), 'utf8')
assert(route.includes("from '@/lib/vendor-active-order'") && route.includes('toVendorActiveOrder(o, vendorId)'), 'route maps through the shared toVendorActiveOrder')
assert(!route.includes('earningsStatus:'), 'route has NO inline field-by-field mapper to drift')
const dash = readFileSync(new URL('../app/vendor/[fairSlug]/dashboard/page.tsx', import.meta.url), 'utf8')
assert(dash.includes("from '@/lib/vendor-active-order'"), 'dashboard imports the shared contract type')
assert(!/interface VendorOrder\s*\{/.test(dash), 'dashboard has NO hand-written VendorOrder interface (the hope that lied)')
assert(dash.includes('order.customerName') && dash.includes('<CustomerLine'), 'kitchen cards render the customer line (name + fulfillment detail) from the contract')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} active-shape-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
