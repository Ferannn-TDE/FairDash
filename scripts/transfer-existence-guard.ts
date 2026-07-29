/**
 * TRANSFER-EXISTENCE — every stored transfer id must resolve in Stripe.
 *
 * Pattern X2 finds a transfer with no ledger row. This is the INVERSE, which did not exist: a
 * ledger row could claim payment against an id Stripe has never had, and every screen would stay
 * perfectly consistent with itself and wrong.
 *
 * Run once by hand it found 76 `Payout` rows — and 76 `VendorEarning` rows marked `paid` —
 * pointing at ids that do not exist. FOURTH test-pollution incident on this database; the first
 * three were each found by accident. This check would have caught all four the day they landed.
 *
 * ── THE TRAP THIS SUITE EXISTS TO PIN SHUT ──────────────────────────────────────────────────
 * The obvious way to declare the known 76 is a DATE WINDOW. It is unsafe, and that is measured,
 * not argued: 34 LEGITIMATE payouts fall inside the same 2026-07-12→17 range. A window would
 * have silently suppressed real rows from a money check. Membership is an explicit id set, and
 * [3] asserts it stays one.
 *
 *   [0] positive controls on the probe
 *   [1] membership is ABSENCE FROM STRIPE, never id shape
 *   [2] the acknowledged set is explicit, closed, and sized
 *   [3] ⛔ no date/heuristic membership rule may creep back in
 *   [4] it is NOT wired into the 60s sweep
 *
 * Offline: asserts the SHAPE of the check, never calling Stripe (the gate has no network).
 * The live run is scripts/transfer-existence-audit.ts.
 *
 * Run:  npx tsx scripts/transfer-existence-guard.ts
 */

import { readFileSync } from 'node:fs'
import { ACKNOWLEDGED_MISSING_TRANSFERS } from '../lib/transfer-existence'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const lib = stripComments(readFileSync('lib/transfer-existence.ts', 'utf8'))
const A = ACKNOWLEDGED_MISSING_TRANSFERS

console.log('[0] positive controls on the probe')
assert(A.ids instanceof Set && A.ids.size > 0, 'the acknowledged set loads and is non-empty')
assert(A.ids.has('tr_jx4n2ms5'), 'a known polluted id IS declared (the probe reads the real set)')
assert(!A.ids.has('tr_3Tvl9NHk5f3uB8J900UakK3u'),
  '⛔ and a REAL transfer — the runner payout proven in production — is NOT in it')

console.log('\n[1] membership is ABSENCE FROM STRIPE, never id shape')
assert(/const acknowledged = \(r: TransferCheckRow\) => A\.ids\.has\(r\.transferId\)/.test(lib),
  'suppression keys on the explicit id set')
assert(/missing: !live\.has\(/.test(lib), 'and `missing` is computed from Stripe membership, not from the id string')
assert(/shapeDisagreements: rows\.filter\(r => r\.missing !== r\.shortShaped\)/.test(lib),
  'shape is reported only as CORROBORATION — a disagreement surfaces as a finding')
assert(!/if \(shortShaped\(/.test(lib) && !/shortShaped\(.*\)\s*\)\s*return/.test(lib),
  '⛔ shape never GATES anything — a heuristic must not decide a money row')

console.log('\n[2] the acknowledged set is explicit, closed and sized')
assert(A.ids.size === 76, `exactly 76 declared ids (got ${A.ids.size}) — the measured pollution, not a range`)
assert([...A.ids].every(id => /^tr_[A-Za-z0-9]+$/.test(id)), 'every entry is a well-formed transfer id')
assert(new Set([...A.ids]).size === A.ids.size, 'no duplicates')
assert(/TEMPORARY/.test(readFileSync('lib/transfer-existence.ts', 'utf8')),
  'the set is marked TEMPORARY — it is pending a cleanup decision, not a permanent exemption')
assert(/CURRENT_STATE/.test(A.reason), 'and its reason points at where the decision is recorded')

console.log('\n[3] ⛔ no date or heuristic membership rule may creep back in')
// THE MEASURED REASON: 34 legitimate payouts share the polluted rows' date range.
assert(!/windowStart|windowEnd/.test(lib),
  'no date-window fields remain — a window would have suppressed 34 REAL payouts from a money check')
assert(!/createdAt >= A\.|createdAt < A\./.test(lib), 'and nothing compares a row date against the acknowledged set')
// The ids and their reasoning live in the shared cohort module now — assert it there, which is
// where someone reaching for a date rule would actually be editing.
const cohort = readFileSync('lib/pollution-cohort.ts', 'utf8')
assert(/WHY IDS AND NOT A DATE WINDOW/.test(cohort),
  'the reason a window is unsafe is recorded where the next person would reach for one')
// Assert the DEPENDENTS BY NAME, not a "TWO PLACES" phrase — the count changed (a third
// consumer, patternX, was added after Pattern X2 resurrected the whole cohort), and a guard
// pinned to a magic phrase makes the doc harder to correct than to leave wrong.
assert(/PERMANENT/.test(cohort) && /DO NOT PRUNE/.test(cohort),
  'the set is marked PERMANENT — the retirement is what makes it load-bearing, not what ends it')
for (const dependent of ['lib/transfer-existence.ts', 'lib/vendor-earnings.ts', 'lib/reconciler.ts']) {
  assert(cohort.includes(dependent), `  ↳ names its dependent ${dependent}, so pruning it has a visible cost`)
}
assert(/patternX|Pattern X2/.test(cohort),
  '  ↳ and names Pattern X2 specifically — the consumer that silently resurrects the cohort if this set is deleted')
assert(!/^import /m.test(cohort),
  'the cohort module imports NOTHING — the vendor display path must not pull in Stripe or the DB to read it')

console.log('\n[4] it is NOT wired into the 60s sweep')
const reconciler = stripComments(readFileSync('lib/reconciler.ts', 'utf8'))
assert(!/transfer-existence|checkTransferExistence/.test(reconciler),
  '⛔ the reconciler does NOT import it — a Stripe outage must not read as a sweep failure')
assert(/transfers\.list/.test(lib) && !/transfers\.retrieve/.test(lib),
  'bulk list, not per-row retrieve (measured ~11× cheaper: 69 transfers in one 792ms call)')
assert(/has_more/.test(lib), 'and it paginates, so it does not silently stop at 100')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ transfer-existence-guard: ${pass} passed, 0 failed` : `❌ transfer-existence-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
