/**
 * RUNNER-FEE ACTIVATION GATE GUARD — enabling runner delivery with a 0% split is a DECISION,
 * not a silent default. The failure prevented is 0-BY-ABSENCE (nobody set the split → a runner
 * earns $0 on a fee delivery); the escape hatch is 0-BY-INTENT (runnerTipsOnlyAck).
 *
 *   [1] BLOCKS 0-by-absence — home delivery OR runner-delivers curbside + percent 0 + no ack.
 *   [2] ALLOWS every intended path — percent > 0, OR the tips-only ack, OR no runner leg at all
 *       (positive controls: the gate must SAY YES to legitimate configs, not just NO).
 *   [3] curbside METHOD matters — customer-walks curbside has no runner fee leg, so 0 is fine.
 *   [4] SOURCE SHAPE — the admin fulfillment route runs the gate and persists the ack column.
 *
 * Run:  npx tsx scripts/runner-fee-gate-guard.ts
 */

import { readFileSync } from 'node:fs'
import { checkRunnerFeeActivation, type FeeActivationInput } from '../lib/runner-fee-gate'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const cfg = (o: Partial<FeeActivationInput>): FeeActivationInput => ({
  homeDeliveryEnabled: false, curbsideEnabled: false, curbsideMethod: null,
  runnerFeePercent: 0, runnerTipsOnlyAck: false, ...o,
})

console.log('[1] BLOCKS 0-by-absence')
const b1 = checkRunnerFeeActivation(cfg({ homeDeliveryEnabled: true }))
assert(!b1.ok && b1.code === 'RUNNER_FEE_UNACKNOWLEDGED', 'home delivery + 0% + no ack → blocked BY NAME')
assert(!b1.ok && b1.message.includes('tips only'), 'message explains the tips-only consequence')
const b2 = checkRunnerFeeActivation(cfg({ curbsideEnabled: true, curbsideMethod: 'RUNNER_DELIVERS' }))
assert(!b2.ok, 'runner-delivers curbside + 0% + no ack → blocked')

console.log('\n[2] ALLOWS every intended path (positive controls — the gate can say YES)')
assert(checkRunnerFeeActivation(cfg({ homeDeliveryEnabled: true, runnerFeePercent: 50 })).ok, 'home delivery + 50% → allowed')
assert(checkRunnerFeeActivation(cfg({ homeDeliveryEnabled: true, runnerTipsOnlyAck: true })).ok, 'home delivery + 0% + tips-only ACK → allowed (0 by intent)')
assert(checkRunnerFeeActivation(cfg({ homeDeliveryEnabled: false, curbsideEnabled: false })).ok, 'no runner leg (booth only) + 0% → allowed (split irrelevant)')

console.log('\n[3] curbside METHOD matters')
assert(checkRunnerFeeActivation(cfg({ curbsideEnabled: true, curbsideMethod: 'CUSTOMER_WALKS' })).ok, 'customer-walks curbside + 0% → allowed (no runner fee leg)')
assert(!checkRunnerFeeActivation(cfg({ curbsideEnabled: true, curbsideMethod: 'RUNNER_DELIVERS' })).ok, 'runner-delivers curbside + 0% → blocked (control: method flips the verdict)')

console.log('\n[4] SOURCE SHAPE')
const route = readFileSync(new URL('../app/api/admin/events/[id]/fulfillment/route.ts', import.meta.url), 'utf8')
assert(route.includes('checkRunnerFeeActivation'), 'fulfillment route runs the activation gate')
assert(route.includes('merged.ok') && route.includes('merged.code'), 'route rejects with the gate verdict + its code')
assert(/runnerTipsOnlyAck:\s*body\.runnerTipsOnlyAck/.test(route), 'route persists the ack column (create + update)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} runner-fee-gate-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
