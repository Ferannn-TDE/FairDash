/**
 * PROTECTED-EVENT MEMBERSHIP — the live fair is actually on the protected list.
 *
 * WHY THIS EXISTS SEPARATELY. `prod-write-guard-test` proves the MECHANISM: given a protected
 * id, writes to it are blocked. Once that test runs against a seeded fixture on the isolated
 * test database — which it must, now that suites no longer touch production — it stops proving
 * anything about the REAL fair. A perfectly working guard protecting an empty list would pass.
 * That is the vacuity class: a green test about the wrong subject.
 *
 * So membership is asserted here, on its own. CONSTANT-ONLY — no database, no container, no
 * network — which is precisely why it can be trusted to run everywhere and never be skipped.
 *
 * Run: npx tsx scripts/protected-events-membership-guard.ts
 */

import {
  PROTECTED_EVENT_IDS,
  PROTECTED_EVENT_SLUGS,
  LIVE_PROTECTED_EVENT_ID,
  LIVE_PROTECTED_EVENT_SLUG,
  __protectEventForTest,
} from '../lib/prod-write-guard'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

console.log('\n════ PROTECTED-EVENT MEMBERSHIP ════')
console.log('\n[1] the LIVE fair is on the protected list')

assert(PROTECTED_EVENT_IDS.has(LIVE_PROTECTED_EVENT_ID),
  `the live event id (${LIVE_PROTECTED_EVENT_ID}) is in PROTECTED_EVENT_IDS`)
assert(PROTECTED_EVENT_SLUGS.has(LIVE_PROTECTED_EVENT_SLUG),
  `the live event slug (${LIVE_PROTECTED_EVENT_SLUG}) is in PROTECTED_EVENT_SLUGS`)
assert(PROTECTED_EVENT_IDS.size >= 1 && PROTECTED_EVENT_SLUGS.size >= 1,
  'neither protected set is EMPTY (an empty set makes the whole guard vacuous)')

// The slug is Springfield-era while the event is named Italian Fest 2026 — deliberate, see
// PROJECT_INVARIANTS → "Things that look like bugs but aren't". Asserted so a well-meaning
// tidy-up that "fixes" the mismatch also has to come through here.
assert(LIVE_PROTECTED_EVENT_SLUG === 'springfield-state-fair-2026',
  'the frozen slug is the Springfield one — renaming the fair must NOT change it')

console.log('\n[2] the test seam cannot weaken the live entry')
const undo = __protectEventForTest('cmTESTFIXTUREevent000000')
assert(PROTECTED_EVENT_IDS.has('cmTESTFIXTUREevent000000'), 'a fixture id can be added for a test')
assert(PROTECTED_EVENT_IDS.has(LIVE_PROTECTED_EVENT_ID), 'adding a fixture does not displace the live id')
undo()
assert(!PROTECTED_EVENT_IDS.has('cmTESTFIXTUREevent000000'), 'the undo removes the fixture')
assert(PROTECTED_EVENT_IDS.has(LIVE_PROTECTED_EVENT_ID), 'the undo does NOT remove the live id')

// POSITIVE CONTROL: the seam refuses to delete the live id even when asked directly.
const undoLive = __protectEventForTest(LIVE_PROTECTED_EVENT_ID)
undoLive()
assert(PROTECTED_EVENT_IDS.has(LIVE_PROTECTED_EVENT_ID),
  '[0] POSITIVE CONTROL: undoing a seam registered for the LIVE id still leaves it protected')

console.log('\n────────────────────────────────────')
console.log(failed === 0 ? `  ✅ ${passed} passed, 0 failed` : `  ❌ ${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
