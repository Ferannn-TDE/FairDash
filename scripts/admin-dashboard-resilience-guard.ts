/**
 * Admin dashboard resilience — locks the two fixes for the production 504.
 *
 * The 504 was NOT a slow query (measured: all DB work < 1s). It was the one unbounded
 * external call — the Firebase Realtime-DB heartbeat read — able to HANG on a cold
 * serverless start, past Vercel's ~10s ceiling. And the client swallowed the failure into an
 * eternal skeleton + fake zeros, so a timeout looked like an empty fair. Two structural
 * invariants keep both from silently returning:
 *
 *   1. the heartbeat read is TIME-BOUNDED (Promise.race with a timeout) — an external call in
 *      a request with a hard ceiling must never be able to hang it.
 *   2. the client SURFACES load failures (loadError) instead of swallowing them.
 *
 * Run:  npx tsx scripts/admin-dashboard-resilience-guard.ts
 */

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const route = readFileSync('app/api/admin/events/[id]/dashboard/route.ts', 'utf8')
const page  = readFileSync('app/admin/[eventSlug]/dashboard/page.tsx', 'utf8')

console.log('\n[1] the Firebase heartbeat read is TIME-BOUNDED (cannot hang the request)')
// The bound MOVED, it did not go away. It used to be an inline Promise.race in THIS route; the
// same 504 then recurred on the two organizer routes, which had been hand-copied from the same
// original and never received it. It now lives in ONE shared helper that every dashboard-class
// route calls, so the wrap cannot be present on some copies and missing on others. This suite
// therefore follows the bound to where it lives; scripts/rtdb-bound-guard.ts proves that NO
// route anywhere performs an unbounded read, which is the stronger form of this assertion.
const bound = readFileSync('lib/heartbeat-read.ts', 'utf8')
assert(/boundedHeartbeatRead\(/.test(route),
  'the route delegates its heartbeat read to the shared bounded helper')
assert(/Promise\.race\(/.test(bound) && /setTimeout\(/.test(bound),
  'that helper races the RTDB read against a timeout')
assert(!/rtdb\.ref\([^\n]*\)\.get\(\)/.test(route),
  'the RTDB .get() is NOT awaited bare in the route (the unbounded form that caused the 504)')

console.log('\n[2] the client SURFACES a load failure instead of swallowing it')
assert(/setLoadError/.test(page), 'the page has a loadError state')
assert(!/\.catch\(\(\) => \{\}\)/.test(page),
  'the fetch does NOT swallow errors with an empty .catch (the silent skeleton+zeros bug)')
assert(/if \(!r\.ok\)/.test(page),
  'a non-ok response (e.g. 504) is detected and thrown, not parsed as JSON')
assert(/loadError && !dashboardData/.test(page),
  'a failed first load renders the error (with retry), not the misleading skeleton/zeros')

console.log(`\n${'─'.repeat(62)}`)
if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log(`${'─'.repeat(62)}\n`)
process.exit(fail === 0 ? 0 : 1)
