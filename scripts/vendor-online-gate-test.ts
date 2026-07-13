/**
 * Vendor online-badge approval gate — truth table.
 *
 * THE BUG: the dashboard showed a hardcoded "Online" badge next to an "Application under
 * review" banner — the screen contradicting itself, and an unapproved vendor presenting as
 * available. This proves the derived badge state, against the SAME helper the dashboard
 * uses (lib/vendor-online-state), so the two cannot drift.
 *
 * The load-bearing property: an unapproved vendor can NEVER read Online, no matter what the
 * local toggle says — the gate wins over the vendor's own choice.
 *
 * Run:  npx tsx scripts/vendor-online-gate-test.ts
 */

import { deriveOnlineState, type ReadinessLike } from '../lib/vendor-online-state'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const approved: ReadinessLike   = { steps: [{ key: 'application', waiting: false }, { key: 'stripe', waiting: false }] }
const underReview: ReadinessLike = { steps: [{ key: 'application', waiting: true }] }

console.log('\n[1] ⛔ application UNDER REVIEW → locked, never Online, even if toggled on')
for (const isOnline of [true, false]) {
  const s = deriveOnlineState(underReview, isOnline)
  assert(s.locked === true, `locked (isOnline=${isOnline})`)
  assert(s.showOnline === false, `⛔ NOT shown online (isOnline=${isOnline}) — the gate beats the local toggle`)
  assert(s.label === 'Offline · Awaiting approval', `label reads "${s.label}"`)
}

console.log('\n[2] ⛔ readiness NOT LOADED yet → locked, never Online (no flash while waiting)')
const loading = deriveOnlineState(null, true)
assert(loading.locked === true, 'locked while readiness is null')
assert(loading.showOnline === false, '⛔ NOT shown online before the real state is known')

console.log('\n[3] APPROVED + toggled ON → unlocked, Online')
const on = deriveOnlineState(approved, true)
assert(on.locked === false, 'unlocked once approved')
assert(on.showOnline === true, 'shows Online')
assert(on.label === 'Online', 'label reads "Online"')

console.log('\n[4] APPROVED + toggled OFF → unlocked, Offline (the toggle works normally)')
const off = deriveOnlineState(approved, false)
assert(off.locked === false, 'unlocked')
assert(off.showOnline === false, 'shows Offline')
assert(off.label === 'Offline', 'label reads "Offline" (not the awaiting-approval variant)')

console.log('\n[6] ⛔ STICKY: an organizer-PAUSED vendor cannot flip themselves back Online')
for (const isOnline of [true, false]) {
  const s = deriveOnlineState(approved, isOnline, 'PAUSED')
  assert(s.locked === true, `paused → locked (isOnline=${isOnline})`)
  assert(s.showOnline === false, `⛔ paused → NOT online even with isOnline=${isOnline} — the vendor can't self-release`)
  assert(s.organizerLocked === true, 'organizerLocked flag set')
  assert(s.lockReason === 'paused' && s.label === 'Taken offline by organizer', `label "${s.label}"`)
}

console.log('\n[7] SUSPENDED / REJECTED also lock (organizer action)')
assert(deriveOnlineState(approved, true, 'SUSPENDED').showOnline === false, 'suspended → not online')
assert(deriveOnlineState(approved, true, 'SUSPENDED').label === 'Suspended by organizer', 'suspended label')
assert(deriveOnlineState(approved, true, 'REJECTED').locked === true, 'rejected → locked')

console.log('\n[8] an ACTIVE (approved, not paused) vendor toggles normally — status did not break it')
assert(deriveOnlineState(approved, true, 'ACTIVE').showOnline === true, 'ACTIVE + on → Online')
assert(deriveOnlineState(approved, false, 'ACTIVE').showOnline === false, 'ACTIVE + off → Offline')
assert(deriveOnlineState(approved, true, undefined).showOnline === true, 'no status passed → behaves as before (back-compat)')

console.log('\n[9] precedence: an organizer PAUSE outranks the approval/loading reasons')
assert(deriveOnlineState(underReview, true, 'PAUSED').lockReason === 'paused',
  'paused + under-review → reports the PAUSE (the more specific, actionable reason)')

console.log('\n[5] the gate is DECISIVE: no readiness state lets an unapproved vendor be Online')
// Exhaustive over the small input space — approval is the ONLY thing that unlocks Online.
const cases: Array<[ReadinessLike | null, boolean]> = [
  [null, true], [null, false], [underReview, true], [underReview, false],
]
const anyLeak = cases.some(([r, o]) => deriveOnlineState(r, o).showOnline)
assert(!anyLeak, 'across every not-approved input, showOnline is false — the badge cannot lie')

console.log(`\n${'─'.repeat(60)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(60)}\n`)
process.exit(fail === 0 ? 0 : 1)
