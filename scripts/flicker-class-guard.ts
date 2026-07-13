/**
 * Flicker-class guard — "never render a plausible-but-WRONG value before the data loads."
 *
 * This class of bug has been fixed FIVE times across the session (homepage empty list, vendor
 * $0, false "live updates paused" banner, white tab ghost, and now the admin slug-as-name).
 * Each was a component rendering something it had instantly — a URL slug, a zero, a default
 * status — as if it were the answer, then correcting it after a fetch. This guard makes the
 * class fail a suite instead of being re-discovered by accident.
 *
 * A skeleton / spinner / null-with-a-loading-branch is FINE (it says "I don't know yet").
 * A slug, a fake status, or a default that looks like real data is NOT.
 *
 * Run:  npx tsx scripts/flicker-class-guard.ts
 */

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

// ── CLASS A: a URL param rendered as a display value fallback (the exact slug-as-name bug) ──
console.log('\n[A] no page uses a URL param (?? params.…) as a display fallback')
// grep the whole app tree for the smell. `?? params.` means "if the real value is missing,
// show this URL fragment" — which is precisely rendering a slug/id as if it were the answer.
let paramFallbacks = ''
try {
  paramFallbacks = execSync(`grep -rn '?? params\\.' app --include='*.tsx' || true`, { encoding: 'utf8' }).trim()
} catch { /* grep exit 1 = no matches */ }
if (paramFallbacks) {
  for (const line of paramFallbacks.split('\n')) console.log(`     ↳ ${line}`)
}
assert(paramFallbacks === '', 'zero "?? params.<x>" display fallbacks in app/ (a slug/id must never stand in for a name)')

// ── Regression locks on the three sites fixed in this sweep ──
console.log('\n[B] the admin dashboard shows a skeleton, not the slug/status, while loading')
const dash = readFileSync('app/admin/[eventSlug]/dashboard/page.tsx', 'utf8')
assert(!/eventName\s*=\s*[^\n]*\?\?\s*params\.eventSlug/.test(dash),
  'eventName does NOT fall back to params.eventSlug')
assert(/const eventName = dashboardData\?\.event\.name \?\? null/.test(dash),
  'eventName is null (→ skeleton) until the real name loads')
assert(/useState<EventStatus \| null>\(null\)/.test(dash),
  'eventStatus starts null (not a fake "UPCOMING") — badge + action buttons wait for the truth')

console.log('\n[C] the runner approval status is null until loaded (no "APPROVED" flash)')
const ctx = readFileSync('app/runner/[fairSlug]/_context/RunnerContext.tsx', 'utf8')
assert(/useState<ApprovalStatus \| null>\(null\)/.test(ctx),
  'approvalStatus starts null, not \'APPROVED\' (an unapproved runner never flashes the approved UI)')
assert(!/useState<ApprovalStatus>\('APPROVED'\)/.test(ctx),
  'the old \'APPROVED\' default is gone')
const runnerDash = readFileSync('app/runner/[fairSlug]/dashboard/page.tsx', 'utf8')
assert(/approvalStatus && approvalStatus !== 'APPROVED'/.test(runnerDash),
  'the pending banner renders only once the status has loaded (guards the null loading state)')

console.log(`\n${'─'.repeat(64)}`)
if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log(`${'─'.repeat(64)}\n`)
process.exit(fail === 0 ? 0 : 1)
