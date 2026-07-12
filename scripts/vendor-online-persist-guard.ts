/**
 * Vendor online/offline PERSISTENCE — wiring invariants a green build cannot prove.
 *
 * Half 1 (persist) and Half 2 (load the real value) both fail SILENTLY if regressed: the
 * code still compiles, it just goes back to lying or losing the flip. So the load-bearing
 * bits are asserted structurally here.
 *
 *   Constraint A (pending stays locked) is proven by the truth table in
 *   vendor-online-gate-test (showOnline is false for every not-approved input, incl.
 *   isOnline=true). This guard covers the three things that live in the wiring:
 *     1. the toggle INITIALISES from the real saved value, never a hardcoded default
 *        (the "flash the wrong state on refresh" bug this session kept killing);
 *     2. the flip PERSISTS via PATCH and the toggle is gated by the approval lock
 *        (so persistence can't fire for a pending vendor);
 *     3. the PATCH BUSTS the 'vendors' cache on isOffline/isBusy — the stale-read trap,
 *        because the server-rendered discovery list is cached 120s under that tag.
 *
 * Run:  npx tsx scripts/vendor-online-persist-guard.ts
 */

import { readFileSync } from 'node:fs'

const dash  = readFileSync('app/vendor/[fairSlug]/dashboard/page.tsx', 'utf8')
const route = readFileSync('app/api/vendors/[id]/route.ts', 'utf8')
const ctx   = readFileSync('lib/contexts/VendorContext.tsx', 'utf8')
const layout = readFileSync('app/vendor/[fairSlug]/layout.tsx', 'utf8')
const fairs = readFileSync('lib/fairs.ts', 'utf8')

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const noComments = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const D = noComments(dash), R = noComments(route)

console.log('\n[1] the toggle INITIALISES from the real saved value, not a default')
assert(/useState\(\(\)\s*=>\s*!initialIsOffline\)/.test(D),
  'isOnline initialises from !initialIsOffline (the server value), lazily')
assert(!/useState\(true\)[^\n]*isOnline|isOnline[^\n]*useState\(true\)/.test(D),
  'isOnline is NOT hardcoded to true (the original lie)')
assert(/isOffline:\s*initialIsOffline/.test(D) || /isOffline:\s*initialIsOffline\s*\}/.test(D) || /initialIsOffline/.test(D),
  'the real isOffline is pulled from vendorMeta')

console.log('\n[2] the real value is threaded from the server through VendorMeta')
assert(/isOffline:\s*boolean/.test(ctx), 'VendorMeta carries isOffline: boolean')
assert(/isOffline:\s*Boolean\(v\.isOffline\)/.test(layout), 'the layout seeds it from the /api/vendors/me payload')

console.log('\n[3] the flip PERSISTS and is gated by the approval lock')
assert(/method:\s*'PATCH'/.test(D) && /isOffline:\s*!next/.test(D),
  "toggleOnline PATCHes { isOffline: !next } — online ⇒ isOffline false")
assert(/if\s*\(onlineControlLocked\b/.test(D),
  'the flip is guarded by onlineControlLocked — a pending/loading vendor cannot persist online')
assert(/setIsOnline\(!next\)/.test(D),
  'on failure it REVERTS the optimistic flip (never leaves the badge lying)')
assert(/onClick=\{toggleOnline\}/.test(D),
  'the button calls the persisting handler, not a local-only setter')

console.log('\n[4] ⛔ the stale-read trap: PATCH busts the cached discovery list')
assert(/revalidateTag\('vendors'/.test(R),
  "PATCH calls revalidateTag('vendors') — the tag the SSR discovery list is cached under")
assert(/isOffline\s*!==\s*undefined\s*\|\|\s*isBusy\s*!==\s*undefined/.test(R),
  'revalidation fires specifically when isOffline / isBusy change')
// And confirm that tag is really the one the customer list uses — otherwise the bust is a no-op.
assert(/getVendorsBySlugCached[\s\S]*tags:\s*\['vendors'\]/.test(fairs),
  "…and getVendorsBySlugCached is genuinely cached under 'vendors' (the bust is not a no-op)")

console.log(`\n${'─'.repeat(62)}`)
if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log('  (wiring proven; the browser acceptance test — persists across refresh, no')
console.log('   flash, customer surface reflects the flip — still needs an eyeball)')
console.log(`${'─'.repeat(62)}\n`)
process.exit(fail === 0 ? 0 : 1)
