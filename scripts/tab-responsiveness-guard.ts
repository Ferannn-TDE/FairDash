/**
 * Vendor dashboard — tab responsiveness wiring guard.
 *
 * THE BUG: clicking a tab left the highlight on the PREVIOUS tab for ~half a second.
 * It was neither of the usual suspects — the state setter is synchronous
 * (`onClick={() => setActiveTab(tab.id)}`, no await), and the CSS transition is Tailwind's
 * 150ms default, far too fast to read as lag. The real cause was a BLOCKED PAINT: activeTab
 * drove BOTH the highlight and the panel, so React reconciled the entire order-card list in
 * the same render pass as the highlight and could not paint until it finished. Hence the
 * symptom — a freeze, then everything snapping at once (a slow transition would have
 * animated smoothly instead).
 *
 * THE FIX is a wiring split, and this test guards exactly that wiring:
 *   highlight  ← activeTab    (URGENT — paints on click)
 *   panel      ← deferredTab  (DEFERRED — the expensive work cannot block the click)
 *
 * Rebinding the highlight to deferredTab would silently restore the lag while still
 * compiling and still "working". That is what this guards. It proves the wiring, NOT the
 * perceived speed — measuring that needs a browser.
 *
 * Run:  npx tsx scripts/tab-responsiveness-guard.ts
 */

import { readFileSync } from 'node:fs'

const SRC = 'app/vendor/[fairSlug]/dashboard/page.tsx'
const src = readFileSync(SRC, 'utf8')

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

console.log('\n[1] the highlight is URGENT — driven by activeTab, so it paints on click')
// The tab button's active styling must compare against activeTab, never the deferred one.
assert(/activeTab === tab\.id/.test(src), 'tab highlight compares activeTab === tab.id')
assert(!/deferredTab === tab\.id/.test(src), 'the highlight is NOT bound to deferredTab (that would reintroduce the lag)')

console.log('\n[2] the panel is DEFERRED — the expensive card swap cannot block the paint')
const panelBindings = src.match(/deferredTab === '(incoming|active|ready|done)'/g) ?? []
assert(panelBindings.length === 4, `all 4 lane panels read deferredTab (found ${panelBindings.length})`)
const urgentPanels = src.match(/activeTab === '(incoming|active|ready|done)'/g) ?? []
assert(urgentPanels.length === 0, `no lane panel still reads activeTab (found ${urgentPanels.length})`)

console.log('\n[3] the deferral actually exists and the click stays synchronous')
assert(/useDeferredValue\(activeTab\)/.test(src), 'deferredTab = useDeferredValue(activeTab)')
assert(/onClick=\{\(\) => setActiveTab\(tab\.id\)\}/.test(src),
  'the click handler is SYNCHRONOUS — the selection never waits on data (a UI fact, not a data fact)')
assert(!/onClick=\{async/.test(src.slice(src.indexOf('xl:hidden flex border-b'), src.indexOf('xl:hidden flex border-b') + 600)),
  'the tab click handler is not async')

console.log('\n[4] pending feedback is honest — "working", not "nothing happened"')
assert(/tabSwitchPending/.test(src), 'a pending flag exists while the deferred panel catches up')
assert(/opacity-60/.test(src), 'the panel dims briefly during the swap rather than freezing silently')

console.log('\n[5] THE WHITE BAR: the indicator never fades through Tailwind\'s default border colour')
// tailwind.config sets no borderColor.DEFAULT, so preflight leaves it at #e5e7eb — a light
// grey that reads as WHITE on #0F0F0F. An inactive tab with a border WIDTH but no explicit
// border COLOUR therefore renders (and animates toward) near-white. The inactive state must
// name its colour explicitly.
// Strip comments first: the fix is DOCUMENTED in a comment that names `transition-all` as
// the thing removed, and a naive substring check would match that prose and "fail" on a
// correct file. Test the code, not the commentary.
const tabBtnRaw = src.slice(src.indexOf('xl:hidden flex border-b'), src.indexOf('xl:hidden flex border-b') + 1800)
const tabBtn = tabBtnRaw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
assert(/border-transparent/.test(tabBtn),
  'the INACTIVE tab pins border-transparent — it can never inherit the #e5e7eb default')
assert(!/transition-all/.test(tabBtn),
  'the tab does NOT use transition-all (which animated border-COLOUR and border-WIDTH together, producing the white fade)')
assert(/transition-colors/.test(tabBtn),
  'only colours transition — width is constant, so there is no layout shift either')
assert(/\bborder-b-2\b[\s\S]{0,200}?border-neon-pink/.test(tabBtn) || /border-b-2 transition-colors/.test(tabBtn),
  'border width is declared ONCE for both states (2px always), not toggled on/off')

console.log(`\n${'─'.repeat(64)}\n  ${pass} passed, ${fail} failed`)
console.log('  (wiring proven; perceived latency still needs a browser)')
console.log(`${'─'.repeat(64)}\n`)
process.exit(fail === 0 ? 0 : 1)
