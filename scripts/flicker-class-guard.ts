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

// ── [D] runner dashboard stats + online status (6th instance: the 0/0/100% flash) ──
console.log('\n[D] runner dashboard: skeletons, not 0/0/100% defaults; online status starts unknown')
assert(!/completionRate\s*\?\?\s*1/.test(runnerDash),
  'no "completionRate ?? 1" — 100% completion is a CLAIM, never a placeholder')
assert(/stats \? String\(stats\.deliveriesToday\) : null/.test(runnerDash) && runnerDash.includes('animate-pulse'),
  'TodayStats renders a skeleton (null branch) until the real stats load')
const runnerCtx = readFileSync('app/runner/[fairSlug]/_context/RunnerContext.tsx', 'utf8')
assert(/useState<boolean \| null>\(null\)/.test(runnerCtx),
  "isOnline starts null (unknown), not false — an online runner never flashes 'Offline'")
assert(/isOnline === null/.test(runnerDash),
  'dashboard handles the unknown online state (skeleton, not the go-online prompt)')
const shell = readFileSync('app/runner/[fairSlug]/RunnerPortalShell.tsx', 'utf8')
assert((shell.match(/isOnline === null/g) ?? []).length >= 2,
  'both shell status pills (desktop + mobile) show neutral while unknown, never a false Offline')

// ── [E] no fair display name is derived from a SLUG (7th instance) ──────────────
// The admin sidebar's per-fair header fell back to the slug while /api/admin/fairs was in
// flight, so every load flashed "SPRINGFIELD-STATE-FAIR-2026" (uppercased by its own CSS)
// before settling to the real name, "Italian Fest 2026". A slug looks like a name and is a
// different string — the plausible-but-wrong class, in its most literal form.
console.log('\n[E] fair display names come from event.name, never from a slug')
const shellSrc = readFileSync('app/admin/_components/AdminShell.tsx', 'utf8')

// The scan rule: a display name assigned from a slug identifier. Positive control FIRST —
// a broken regex must not let the real assertion pass vacuously.
const NAME_FROM_SLUG = /\b(name|title|label)\b[^\n=]*=\s*[^\n]*\?\?\s*[a-zA-Z]*[sS]lug\b/
assert(NAME_FROM_SLUG.test('  const name = fair?.name ?? slug'),
  '[0] positive control: the scanner DOES flag `name = fair?.name ?? slug` (the exact line that shipped the flash)')
assert(!NAME_FROM_SLUG.test('  const href = `/admin/${slug}/dashboard`'),
  '[0] baseline: using a slug in a URL is NOT flagged — only naming a thing after it')

assert(!NAME_FROM_SLUG.test(shellSrc),
  'AdminShell derives NO display name from a slug (the fair header waits for event.name)')
assert(/const name = fair\?\.name \?\? null/.test(shellSrc),
  'the fair header name is null until the fairs list resolves (→ skeleton, not a guess)')
assert(/loaded\s*$|loaded\s*\?/m.test(shellSrc) && /animate-pulse/.test(shellSrc),
  'the header distinguishes loading (skeleton) from loaded-but-unknown — two different states, two different renders')

// ── [F] a <select> whose options arrive late (8th instance) ─────────────────────
// The vendor filter rendered with only "All vendors" while the vendor list was in flight, then
// snapped wider when it landed — a narrow dropdown that appears to offer nothing is a
// plausible-but-wrong intermediate, and the reflow is the visible tell. The existing rules all
// key on defaulted STATE; none covered "options not fetched yet", so this is a new rule.
console.log('\n[F] a select with late-arriving options reserves space instead of rendering empty')
const ordersPage = readFileSync('app/admin/[eventSlug]/orders/page.tsx', 'utf8')

// The anti-pattern: mapping fetched options into a <select> with no loaded-flag guarding it.
const LOADED_GATE = /vendorsLoaded \?[\s\S]{0,400}<select/
assert(/const \[vendorsLoaded, setVendorsLoaded\] = useState\(false\)/.test(ordersPage),
  '[0] positive control: a loaded flag exists and starts FALSE (not-loaded is the initial truth)')
assert(LOADED_GATE.test(ordersPage),
  'the vendor select renders only once its options have loaded')
assert(/animate-pulse/.test(ordersPage) && /w-44 h-\[34px\]/.test(ordersPage),
  'a skeleton of the SAME footprint holds the space (no reflow when options land)')
assert(!/<select[\s\S]{0,200}vendorOptions\.map[\s\S]{0,80}<\/select>\s*\n\s*<select/.test(ordersPage),
  'the two filter selects are not rendered as a bare adjacent pair with unreserved widths')

// ── [G] update-during-render, and page numbers mirrored from clicks (9th instance) ──────
// The pagination control adapted for vendor order history came from a source that reconciled
// its previous digits INSIDE THE RENDER BODY:
//     if (prevDigits.join('') !== digits.join('')) { setPrevTicks(...); setPrevDigits(...) }
// That is this same class in its purest form — render a frame computed from the stale value,
// then setState to correct it. The fix was not to move it into an effect but to remove the
// need for remembered state entirely: AnimatePresence already knows a digit changed (the key
// changed), and the only thing a diff could add is the DIRECTION of travel, which the caller
// knows because it just handled the click.
//
// So the rule is structural: that component holds NO state. A component with no useState
// cannot setState during render.
console.log('\n[G] the pager holds no state, and the page number is derived from fetched data')
const pager = readFileSync('app/_components/ui/AnimatedPagination.tsx', 'utf8')

// [0] POSITIVE CONTROLS — a scanner that cannot see a useState would pass this vacuously.
const HOLDS_STATE = /\buseState\s*[<(]|\buseReducer\s*[<(]/
assert(HOLDS_STATE.test('const [prevDigits, setPrevDigits] = useState<string[]>([])'),
  '[0] positive control: the scanner DOES flag a useState (the exact line the source used)')
assert(!HOLDS_STATE.test('const digits = String(value).split("")'),
  '[0] baseline: a derived value is NOT flagged — only remembered state')

assert(!HOLDS_STATE.test(pager),
  'AnimatedPagination declares no useState/useReducer — update-during-render is impossible by construction')
assert(!/\buseEffect\s*\(/.test(pager),
  'AnimatedPagination declares no useEffect either — it derives everything from props (FluidTabBar precedent)')
assert(/direction/.test(pager),
  'the roll direction arrives as a PROP (the caller knows which way it moved; the pager does not guess)')

// The other half of the same bug: a pager that counts its own clicks will read "3 of 8" over
// page 2's rows the moment a fetch fails or races. The page must be derived from the cursor
// stack that actually fetched the rows on screen.
const ordersHistory = readFileSync('app/vendor/[fairSlug]/orders/page.tsx', 'utf8')
assert(/const page = cursorStack\.length \+ 1/.test(ordersHistory),
  'order history DERIVES the page from the cursor stack, never from a click counter')
assert(!/useState[^\n]*\b(currentPage|pageNumber)\b/.test(ordersHistory),
  'there is no mirrored page-number state to drift from the fetched page')

// The third way this indicator can lie, and the easiest one to introduce by accident: the page
// SIZE is written twice — once as the fetch `take` (how many rows a page really holds) and once
// as the totalPages divisor (what the pager claims about it). Change one and "1 of 7" sits over
// pages of a different size. One constant makes the drift unexpressible; this keeps it that way.
// Both checks below are NEGATIVE ("this bad shape is absent"), which is the kind that passes
// for free when the pattern is wrong. So each regex is tested against the exact line it exists
// to catch BEFORE it is trusted — and against the good line, so it isn't matching everything.
const BARE_DIVISOR = /Math\.ceil\([^)]*\/\s*\d/
const BARE_TAKE = /take:\s*String\(\s*\d/

assert(BARE_DIVISOR.test('Math.ceil(totalForTab / 50)'),
  '[0] positive control: the divisor scanner DOES flag a hard-coded /50')
assert(!BARE_DIVISOR.test('Math.ceil(totalForTab / ORDER_HISTORY_PAGE_SIZE)'),
  '[0] baseline: the divisor scanner does NOT flag the constant')
assert(BARE_TAKE.test('take: String(50),'),
  '[0] positive control: the take scanner DOES flag a hard-coded take')
assert(!BARE_TAKE.test('take: String(ORDER_HISTORY_PAGE_SIZE),'),
  '[0] baseline: the take scanner does NOT flag the constant')

// Every list on the pager gets the same treatment: its own constant, read by BOTH its fetch
// take and its divisor. Own, not shared — these are different surfaces with different densities
// (25 / 50 / 50), and one shared number would mean neither could be tuned alone.
const PAGED_LISTS: { file: string; constant: string; label: string }[] = [
  { file: 'app/vendor/[fairSlug]/orders/page.tsx',            constant: 'ORDER_HISTORY_PAGE_SIZE',     label: 'vendor order history' },
  { file: 'app/admin/[eventSlug]/orders/page.tsx',            constant: 'ADMIN_ORDERS_PAGE_SIZE',      label: 'admin order log' },
  { file: 'app/organizer/fairs/[fairSlug]/orders/page.tsx',   constant: 'ORGANIZER_ORDERS_PAGE_SIZE',  label: 'organizer order log' },
]

for (const { file, constant, label } of PAGED_LISTS) {
  const src = readFileSync(file, 'utf8')
  assert(new RegExp(`const ${constant} = \\d+`).test(src),
    `${label}: page size is a single named constant`)
  assert(!BARE_DIVISOR.test(src),
    `${label}: the totalPages divisor is NOT a bare number — it reads the constant`)
  assert(!BARE_TAKE.test(src),
    `${label}: the fetch take is NOT a bare number — it reads the same constant`)
  assert((src.match(new RegExp(constant, 'g')) ?? []).length >= 3,
    `${label}: the fetch take and the divisor both read that one constant`)
  // A pager whose page came from a click counter would caption the wrong rows.
  assert(/const page = cursorStack\.length \+ 1/.test(src),
    `${label}: the page is DERIVED from the cursor stack, not counted on click`)
}

console.log(`\n${'─'.repeat(64)}`)
if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
console.log(`${'─'.repeat(64)}\n`)
process.exit(fail === 0 ? 0 : 1)
