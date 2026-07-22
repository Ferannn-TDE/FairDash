/**
 * DELIVERY-PROGRESS GUARD — one derivation, one bar, one message.
 *
 * The incident it closes: the tracking view had TWO status readers — StatusBanner (which
 * returned null once the runner collected, so the banner VANISHED in transit) and the
 * pill/percent bar (which mapped READY and RUNNER_COLLECTED both to "Ready / 80%"). Two
 * readers, two different lies about the same order. deriveDeliveryProgress is now the only
 * wording of a runner-fulfilled order's state.
 *
 *   [1] STAGE MAP — every stage lands on the right segment with a non-empty message; the
 *       transit stages (the ones the banner used to go dark on) say something.
 *   [2] CLAIMED ≠ PICKED UP — master RUNNER_COLLECTED without collectedAt stays at Ready
 *       (the bag is still on the counter); collectedAt is what advances the bar.
 *   [3] TERMINALS — delivered/completed finish the bar; failed statuses (incl. REFUNDED)
 *       read failed, never a progress percent.
 *   [4] SOURCE SHAPE — SingleOrderTracking has no PROGRESS_PERCENT map and no pill/banner
 *       on the runner path; the driver card reads ONLY snapshot vehicle fields (never the
 *       runner's mutable profile).
 *
 * Run:  npx tsx scripts/delivery-progress-guard.ts
 */

import { readFileSync } from 'node:fs'
import { deriveDeliveryProgress, DELIVERY_SEGMENTS } from '../lib/delivery-progress'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

import type { DeliveryProgressInput } from '../lib/delivery-progress'
const base: DeliveryProgressInput = { vendorStatus: 'PLACED', masterStatus: 'PLACED', runnerId: null, collectedAt: null, estimatedReadyAt: null }

console.log('[1] stage map: 7 segments, every stage worded')
assert(DELIVERY_SEGMENTS.length === 7, 'exactly 7 segments')
const stages: [Partial<DeliveryProgressInput>, number][] = [
  [{}, 0],
  [{ vendorStatus: 'ACCEPTED' }, 1],
  [{ vendorStatus: 'PREPARING' }, 2],
  [{ vendorStatus: 'READY' }, 3],
  [{ vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' }, 5],
  [{ vendorStatus: 'COMPLETED', masterStatus: 'DELIVERED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' }, 6],
]
for (const [over, want] of stages) {
  const p = deriveDeliveryProgress({ ...base, ...over })
  assert(p.activeIndex === want && p.message.length > 0,
    `${over.masterStatus ?? over.vendorStatus ?? 'PLACED'}${over.collectedAt ? '+collected' : ''} → segment ${want} ("${p.message.slice(0, 40)}…")`)
}
const transit = deriveDeliveryProgress({ ...base, vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: '2026-07-22T12:00:00Z' })
assert(transit.state === 'active' && transit.message.includes('on the way'), 'IN TRANSIT has a message (the stage the old banner went dark on)')

console.log('\n[2] claimed ≠ picked up — collectedAt is the custody truth')
const claimed = deriveDeliveryProgress({ ...base, vendorStatus: 'READY', masterStatus: 'RUNNER_COLLECTED', runnerId: 'r1', collectedAt: null })
assert(claimed.activeIndex === 3, 'claimed-not-collected stays at Ready (bag still on the counter)')
assert(claimed.message.includes('heading to the booth'), 'and says the runner is heading to the booth')

console.log('\n[3] terminals')
assert(deriveDeliveryProgress({ ...base, vendorStatus: 'COMPLETED', masterStatus: 'COMPLETED' }).state === 'complete', 'vendor-completed (customer-walks curbside) finishes the bar')
for (const s of ['REFUNDED', 'CANCELLED', 'UNDELIVERABLE']) {
  const p = deriveDeliveryProgress({ ...base, vendorStatus: s })
  assert(p.state === 'failed' && p.message.length > 0, `${s} reads failed with its own message`)
}
assert(deriveDeliveryProgress({ ...base, vendorStatus: 'PREPARING' }).state === 'active', 'positive control: an active stage does NOT read failed')

console.log('\n[4] source shape: the dual readers are gone')
const single = readFileSync(new URL('../components/order/SingleOrderTracking.tsx', import.meta.url), 'utf8')
assert(!single.includes('PROGRESS_PERCENT'), 'SingleOrderTracking has NO local percent map (the second reader)')
assert(single.includes('deriveDeliveryProgress'), 'SingleOrderTracking renders from the one derivation')
assert(/\{!isRunnerOrder && <StatusPill/.test(single), 'no status pill on the runner path (bar + line are the only indicators)')
const driver = readFileSync(new URL('../components/order/DeliveryTracking.tsx', import.meta.url), 'utf8')
assert(driver.includes('runnerVehicleColor') && !driver.includes('order.vehicleMake'), 'driver card reads SNAPSHOT vehicle fields only — never the customer vehicle or a mutable profile')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} delivery-progress-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
