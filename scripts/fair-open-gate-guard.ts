/**
 * FAIR-OPEN GATE GUARD — the server refuses orders for a fair that isn't open, using the SAME
 * derivation the UI shows, and the preview bypass is the only way through.
 *
 * The bug: POST /api/orders gated on `Event.status` (the organizer's enablement flag) and never
 * on dates. Italian Fest is ACTIVE and starts Aug 5, so on Jul 23 the storefront said "Upcoming"
 * while the API accepted orders and created PaymentIntents. Two answers to "is the fair open",
 * and the API's answer was the one that took money — the through-line class on the write path.
 *
 *   [0] POSITIVE CONTROLS (first) — the derivation returns all three states, and the scanner
 *       flags a status-only gate, so the assertions below can't pass vacuously.
 *   [1] THE REAL FAIR — with the stored Aug 5–12 dates, "today" resolves to upcoming → the gate
 *       refuses. Asserted against the same function the route calls, not a restatement.
 *   [2] THE ROUTE — gates on liveState from the shared derivation, refuses with the NAMED
 *       FAIR_NOT_OPEN, and hand-rolls no second date comparison.
 *   [3] THE BYPASS — routed through the one server-side both-conditions decision.
 *   [4] NO OVER-REACH — settle paths (payout/refund/reconciler) are NOT gated: an order placed
 *       during a fair must still pay out after it ends, exactly like the archived-fair money
 *       carve-out. Gating those would strand money.
 *   [5] THE CLIENT — surfaces the server's sentence; no bare "failed to create order".
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/fair-open-gate-guard.ts
 */

import { readFileSync } from 'node:fs'
import { deriveEventLiveState } from '../lib/event-date'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

const route = stripComments(readFileSync('app/api/orders/route.ts', 'utf8'))
const lib   = stripComments(readFileSync('lib/preview-access.ts', 'utf8'))

// Italian Fest as stored.
const START = '2026-08-05T00:00:00.000Z', END = '2026-08-12T00:00:00.000Z'
const at = (iso: string) => new Date(iso).getTime()

console.log('[0] positive controls')
assert(deriveEventLiveState(START, END, at('2026-07-23T12:00:00Z')) === 'upcoming'
    && deriveEventLiveState(START, END, at('2026-08-08T12:00:00Z')) === 'live'
    && deriveEventLiveState(START, END, at('2026-08-13T12:00:00Z')) === 'ended',
  'the shared derivation returns all three states (the gate below is not gating on a constant)')
// A status-only gate is the shape that shipped; the scanner must recognise it.
const STATUS_ONLY = /event\.status\s*!==\s*EventStatus\.ACTIVE/
assert(STATUS_ONLY.test('if (event.status !== EventStatus.ACTIVE) { throw }'),
  'scanner recognises the status-only gate (the shape that was insufficient on its own)')

console.log('\n[1] the real fair, today: the gate refuses')
assert(deriveEventLiveState(START, END) !== 'live',
  `Italian Fest (Aug 5–12) is not live today → an order must be refused (state: ${deriveEventLiveState(START, END)})`)

console.log('\n[2] the route gates on the shared derivation, with a named refusal')
assert(/deriveEventLiveState\(event\.startDate, event\.endDate\)/.test(route),
  'the route derives live-state from the SHARED function, on the event it just loaded')
assert(/liveState !== 'live'/.test(route), 'it refuses whenever the fair is not live')
assert(/'FAIR_NOT_OPEN'/.test(route), 'the refusal is NAMED (FAIR_NOT_OPEN), not a generic 400')
assert(STATUS_ONLY.test(route), 'the enablement check REMAINS — status and dates must BOTH hold')
// No second date comparison: the route must not compare startDate/endDate itself.
assert(!/event\.startDate\s*[<>]/.test(route) && !/new Date\(\)\s*[<>]\s*event\./.test(route),
  'the route hand-rolls NO second date comparison (one derivation, not two)')

console.log('\n[3] the bypass is the one server-side decision')
assert(/hasPreviewAccess\(\)/.test(route), 'the route consults the shared preview decision')
assert(!/ALLOW_PREVIEW_BYPASS/.test(route) && !/computePreviewAccess\(/.test(route),
  'the route does NOT reimplement the two conditions')
assert(/export async function hasPreviewAccess/.test(lib) && /requireStrictAdminAuth/.test(lib) && /computePreviewAccess\(/.test(lib),
  'that decision ANDs the env flag with a real strict-admin check')

console.log('\n[4] no over-reach: settle paths stay ungated')
for (const f of ['lib/process-payout.ts', 'lib/process-refund.ts', 'lib/reconciler.ts']) {
  assert(!/deriveEventLiveState/.test(readFileSync(f, 'utf8')),
    `${f.split('/').pop()} does NOT gate on live-state — money placed during a fair must settle after it ends`)
}

console.log('\n[5] the client surfaces the reason')
const checkout = stripComments(readFileSync('app/fair/[fairSlug]/checkout/page.tsx', 'utf8'))
assert(/json\.error\?\.message/.test(checkout), 'checkout reads the server message')
assert(/toast\.error\(message \?\?/.test(checkout),
  'the server sentence is shown; the generic string is only a fallback, never the first choice')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} fair-open-gate-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
