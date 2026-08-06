/**
 * VENDOR OPERATOR ADMITTANCE — STEP 3: the portal door + gate screen.
 *
 * Step 2 proved the admin CAN decide. This proves the decision now BITES: a PENDING or REJECTED
 * operator no longer reaches the vendor portal. It is the commit where the axis stops being
 * bookkeeping, so the negatives here are the point.
 *
 *   ⛔ PENDING  is walled          — the state every operator starts in
 *   ⛔ REJECTED is walled, WITH THE REASON — the payload the required-reason rule exists for
 *   ✅ APPROVED is admitted        — the grandfathered operators keep working, mid-fair
 *   ✅ CARVE-OUT survives all three states — onboarding + settings stay reachable, or the gate
 *      is a deadlock: refused for being incomplete, locked out of the screens that complete it
 *
 * NOT VACUOUS. Every negative has a positive control on the SAME function and SAME input shape,
 * and step [0] proves the probe can distinguish admitted from walled at all before any ⛔ below
 * is allowed to mean anything. Assertions name the OUTCOME ('DECLINED', the reason text), never
 * merely "didn't render" — a screen that renders nothing for every input would pass that.
 *
 * WHAT THIS SUITE CAN AND CANNOT SEE. The decision is a pure function (vendorOperatorState) and
 * a pure path test (isVendorGateCarveOut); both are exercised directly, unmocked — the same code
 * the door runs. What it CANNOT prove is that the layout renders in a browser: the last attempt
 * at this feature passed the full suite AND `tsc --noEmit` twice while dying on first page load,
 * because a `'use client'` file reached a server-only module and dragged Prisma into the browser
 * bundle. Type-checking cannot see a bundle boundary. So [6] reads the import graph as TEXT and
 * refuses the shapes that caused it, and `npm run build` remains a REQUIRED gate for this
 * commit — this suite passing is necessary, not sufficient.
 *
 * Run: npx tsx scripts/vendor-operator-gate-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import {
  vendorOperatorState,
  isVendorGateCarveOut,
  VENDOR_GATE_CARVE_OUT_SEGMENTS,
  VENDOR_PORTAL_NAV_KEYS,
  vendorCarveOutPath,
  vendorShellNavKeys,
  type VendorOperatorFacts,
} from '../lib/vendor-operator-state'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const APPROVED: VendorOperatorFacts = { approvalStatus: 'APPROVED', rejectionReason: null }
const PENDING:  VendorOperatorFacts = { approvalStatus: 'PENDING',  rejectionReason: null }
const rejected = (reason: string | null): VendorOperatorFacts =>
  ({ approvalStatus: 'REJECTED', rejectionReason: reason })

/** Mirrors the layout's decision EXACTLY: gated unless admitted, carved out, or admin preview. */
function doorAdmits(memberships: VendorOperatorFacts[], pathname: string, previewAdmin = false): boolean {
  const view = vendorOperatorState(memberships)
  if (view.state === 'ADMITTED') return true
  if (isVendorGateCarveOut(pathname)) return true
  return previewAdmin
}

const PORTAL = '/vendor/italian-fest/dashboard'

async function main() {
  // ── [0] POSITIVE CONTROL ON THE PROBE ITSELF ────────────────────────────────
  // Before any ⛔ below can mean anything, prove doorAdmits() can return BOTH answers. A probe
  // wired to always-false would make every negative in this file pass while proving nothing.
  console.log('\n[0] the probe can distinguish admitted from walled (baseline — not a feature test)')
  assert(doorAdmits([APPROVED], PORTAL) === true,  'probe returns TRUE for an approved operator')
  assert(doorAdmits([PENDING], PORTAL) === false, 'probe returns FALSE for a pending one — it can fail')

  // ── [1] ⛔ PENDING IS WALLED ────────────────────────────────────────────────
  console.log('\n[1] ⛔ a PENDING operator does not reach the portal')
  const pendingView = vendorOperatorState([PENDING])
  assert(doorAdmits([PENDING], PORTAL) === false, 'the door refuses them')
  assert(pendingView.state === 'AWAITING',
    `named outcome: AWAITING (got '${pendingView.state}') — not a generic refusal, so the screen can say "under review"`)
  assert(pendingView.reason === null, 'no reason shown — nobody refused them, we simply have not decided')
  assert((pendingView.message ?? '').length > 0, 'a message is carried for the screen to show')

  // ── [2] ⛔ REJECTED IS WALLED, AND THE REASON SURVIVES ──────────────────────
  console.log('\n[2] ⛔ a REJECTED operator is walled — WITH the admin\'s reason')
  const REASON = 'food handler certificate expired'
  const declinedView = vendorOperatorState([rejected(REASON)])
  assert(doorAdmits([rejected(REASON)], PORTAL) === false, 'the door refuses them')
  assert(declinedView.state === 'DECLINED',
    `named outcome: DECLINED (got '${declinedView.state}') — distinct from AWAITING`)
  assert(declinedView.reason === REASON,
    `the reason reaches the screen verbatim (got ${JSON.stringify(declinedView.reason)}) — the sibling booth-reject route drops its reason on the floor; this must not`)
  // A rejection recorded with no reason must still be a clean DECLINED, not a crash.
  assert(vendorOperatorState([rejected(null)]).state === 'DECLINED', 'a reasonless rejection still declines cleanly')

  // ── [3] ✅ APPROVED IS ADMITTED (the production-critical positive) ──────────
  console.log('\n[3] ✅ an APPROVED operator gets the portal — the grandfathered four keep working')
  const approvedView = vendorOperatorState([APPROVED])
  assert(approvedView.state === 'ADMITTED', `named outcome: ADMITTED (got '${approvedView.state}')`)
  assert(doorAdmits([APPROVED], PORTAL) === true, 'the door admits them to a normal portal page')
  assert(approvedView.message === null && approvedView.reason === null,
    'nothing to show — an admitted operator never renders the gate screen')

  // ── [4] MULTI-MEMBERSHIP: one APPROVED admits; findFirst would have walled them ─────────
  console.log('\n[4] admitted-for-any-booth — an APPROVED row is not masked by a PENDING/REJECTED one')
  assert(vendorOperatorState([PENDING, APPROVED]).state === 'ADMITTED', 'PENDING + APPROVED → admitted')
  assert(vendorOperatorState([rejected('x'), APPROVED]).state === 'ADMITTED', 'REJECTED + APPROVED → admitted')
  assert(vendorOperatorState([rejected('x'), PENDING]).state === 'AWAITING',
    'REJECTED + PENDING → AWAITING — an in-flight review outranks a superseded refusal')

  // ── [5] ✅ THE CARVE-OUT — no deadlock, in ALL THREE states ─────────────────
  console.log('\n[5] ✅ onboarding + settings stay reachable while gated (deadlock check)')
  for (const leaf of VENDOR_GATE_CARVE_OUT_SEGMENTS) {
    const path = `/vendor/italian-fest/${leaf}`
    assert(doorAdmits([PENDING], path) === true,        `PENDING  reaches ${leaf}`)
    assert(doorAdmits([rejected(REASON)], path) === true, `REJECTED reaches ${leaf}`)
    assert(doorAdmits([APPROVED], path) === true,       `APPROVED reaches ${leaf}`)
  }
  assert(VENDOR_GATE_CARVE_OUT_SEGMENTS.includes('settings' as never),
    'settings is carved out — it is where Stripe Connect is launched, so walling it strands an operator with no payout destination')

  console.log('\n[5b] ⛔ the carve-out does NOT leak the portal')
  assert(doorAdmits([PENDING], PORTAL) === false, 'dashboard is still gated')
  assert(doorAdmits([PENDING], '/vendor/italian-fest/orders') === false, 'orders is still gated')
  assert(doorAdmits([PENDING], '/vendor/italian-fest/menu') === false, 'menu is still gated')
  assert(doorAdmits([PENDING], '/vendor/italian-fest') === false, 'the fair root is still gated')
  // THE SLUG-COLLISION TRAP. `/vendor/settings` is `[fairSlug]` with the slug "settings" — a fair
  // page, NOT the carve-out. A suffix match would hand the portal to anyone who named a fair well.
  assert(isVendorGateCarveOut('/vendor/settings') === false,
    '/vendor/settings is a FAIR page (slug "settings"), not the carve-out — segment count is the defence')
  assert(isVendorGateCarveOut('/vendor/onboarding') === false, '/vendor/onboarding likewise')
  assert(isVendorGateCarveOut('/vendor/a/settings/deep') === false, 'nothing deeper than three segments')
  assert(isVendorGateCarveOut('/vendor/italian-fest/settings/') === true, 'a trailing slash still matches')
  assert(isVendorGateCarveOut('/vendor/italian-fest/settings?tab=payouts') === true, 'a query string still matches')

  // ── [6] 🔴 CLIENT-BUNDLE PURITY — the failure that type-checking cannot see ─
  console.log('\n[6] 🔴 no client file on this path reaches a server-only module')
  const SERVER_ONLY = ['lib/db', '@prisma/client', 'stripe', 'ioredis', 'firebase-admin', '@clerk/nextjs/server']
  const stateSrc  = readFileSync('lib/vendor-operator-state.ts', 'utf8')
  const screenSrc = readFileSync('app/vendor/_components/VendorOperatorGateScreen.tsx', 'utf8')

  assert(/^'use client'/m.test(screenSrc), 'positive control: the gate screen really is a client component')
  // The policy module is what the client file imports, so it is the edge that must stay clean.
  // Zero imports is the invariant, stated as such rather than as a blocklist it could outgrow.
  assert(/^\s*import\s/m.test(stateSrc) === false,
    'lib/vendor-operator-state.ts has NO imports at all — nothing for a bundler to follow into the server graph')
  // The '@/' path alias matters: the real import is `from '@/lib/db'`, so a bare
  // includes("from 'lib/db") misses the exact shape that killed the portal. The positive
  // control below caught precisely that — it is not decoration.
  const importsServerOnly = (src: string, mod: string) =>
    new RegExp(`from\\s+['"](?:@/)?${mod.replace(/[/@.]/g, '\\$&')}(?:['"/])`).test(src)

  for (const mod of SERVER_ONLY) {
    assert(!importsServerOnly(screenSrc, mod), `the gate screen does not import ${mod}`)
  }
  // Positive control on THIS probe: it must detect the banned shape in BOTH import spellings.
  assert(importsServerOnly(`'use client'\nimport { db } from '@/lib/db'\n`, 'lib/db'),
    'positive control: the probe flags a client file importing @/lib/db (aliased)')
  assert(importsServerOnly(`import Stripe from 'stripe'\n`, 'stripe'),
    'positive control: the probe flags a bare server-only package import')
  // …and does NOT over-fire on a lookalike path, which would make the ban unmaintainable.
  assert(!importsServerOnly(`import x from '@/lib/dbg-helpers'\n`, 'lib/db'),
    'sanity: the probe does not fire on a lookalike path (@/lib/dbg-helpers)')

  // ── [7] the hand-written status union matches the real enum ─────────────────
  console.log('\n[7] the local ApprovalStatus union has not drifted from schema.prisma')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const enumBlock = schema.match(/enum ApprovalStatus\s*\{([^}]*)\}/)?.[1] ?? ''
  const values = enumBlock.split('\n').map(s => s.trim()).filter(Boolean)
  assert(values.length === 3, `the enum still has 3 values (got ${values.length}: ${values.join(',')})`)
  for (const v of values) {
    assert(stateSrc.includes(`'${v}'`), `'${v}' is handled in vendor-operator-state.ts`)
  }

  // ── [8] the door is wired — the gate is actually CALLED by the layout ───────
  console.log('\n[8] app/vendor/layout.tsx actually runs this gate (wiring, not just existence)')
  const layout = readFileSync('app/vendor/layout.tsx', 'utf8')
  assert(layout.includes('vendorOperatorState('), 'the layout calls vendorOperatorState')
  assert(layout.includes('isVendorGateCarveOut('), 'the layout applies the carve-out')
  assert(layout.includes('VendorOperatorGateScreen'), 'the layout renders the gate screen')
  assert(layout.includes('hasPreviewAccess('), 'the admin preview bypass still applies')
  assert(layout.includes('findMany'), 'the membership read is findMany — findFirst could mask an APPROVED row')
  // CODE, not prose: the comment above this line in the layout EXPLAINS why getVendorAuth is
  // avoided, so a bare /getVendorAuth/ match fires on the explanation. Test the import and the
  // call — the two shapes that would actually route the decision through the 600s cache.
  assert(!/import[^\n]*getVendorAuth/.test(layout) && !/getVendorAuth\s*\(/.test(layout),
    'the door does NOT read through getVendorAuth — a 600s cached membership would wall/unwall ~10 min late')
  assert(/getVendorAuth/.test(layout),
    'positive control: the layout DOES discuss getVendorAuth in a comment — so the assertion above is testing code, not the absence of the word')

  // ── [9] the admin panel does not UNDERSTATE what a click there does ────────
  // The panel shipped with a truthful "recorded, not enforced" banner. This commit made that
  // false. A stale version of it is at its most dangerous precisely when it stops being true:
  // an admin told a rejection is inert, while it locks an operator out of a booth mid-fair.
  console.log('\n[9] the admin panel tells the truth about enforcement')
  const panelRaw = readFileSync('app/admin/_components/VendorOperatorsPanel.tsx', 'utf8')
  // Strip comments first: the doc block above the banner QUOTES the old wording to explain why
  // it was retired, and a whole-file scan fires on that explanation rather than on anything an
  // admin can read. Same code-vs-prose distinction as [8]. What ships to the screen is the
  // subject here, so only non-comment source is scanned.
  const panel = panelRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert(/recorded,\s*not enforced/i.test(panelRaw),
    'positive control: the retired wording IS still quoted in the file (so the strip below is doing real work, not passing by absence)')
  assert(!/recorded,\s*not enforced/i.test(panel),
    'no RENDERED text claims decisions are "recorded, not enforced"')
  assert(!/does not check operator approval yet/i.test(panel),
    'no rendered text claims the portal skips the approval check')
  assert(/take effect immediately/i.test(panel),
    'positive control: the panel states that decisions take effect immediately — the banner was flipped, not merely deleted')

  // ── [10] THE ESCAPE BUTTONS ACTUALLY WORK ──────────────────────────────────
  // [5] proved the carve-out routes are REACHABLE. That is only half the deadlock check, and the
  // half that was already green while both buttons were dead: reachability says nothing about
  // where the screen POINTS, or about whether clicking it navigates at all. Both halves live
  // here now.
  console.log('\n[10] the gate screen links to exactly the routes the door carves out')
  const screen = readFileSync('app/vendor/_components/VendorOperatorGateScreen.tsx', 'utf8')

  // (a) ROUND-TRIP: every path the screen can build is one the door lets through. Derived from
  //     the shared builder, so this cannot drift into two hand-written copies of the path set.
  for (const seg of VENDOR_GATE_CARVE_OUT_SEGMENTS) {
    const href = vendorCarveOutPath('vogfixture-fair', seg)
    assert(isVendorGateCarveOut(href), `the door lets through the exact href the screen builds: ${href}`)
    assert(doorAdmits([rejected(REASON)], href) === true, `a REJECTED operator clicking '${seg}' is not bounced back`)
  }
  // Positive control on the round-trip: the builder feeds the SAME matcher that refuses a
  // non-carved route, so the assertions above are not true of every string.
  assert(isVendorGateCarveOut('/vendor/vogfixture-fair/dashboard') === false,
    'positive control: the matcher still refuses a non-carve-out route built the same way')

  // (b) ONE SOURCE: the screen must derive hrefs, not hand-write them. A hand-written
  //     `/vendor/${slug}/settings` is what allows the screen and the allowlist to disagree.
  assert(screen.includes('vendorCarveOutPath('),
    'the screen builds hrefs with vendorCarveOutPath — one source shared with the door')
  assert(!/href=\{`\/vendor\//.test(screen),
    'the screen hand-writes no /vendor/... href — that is the two-copies-one-lies shape')

  // (c) THE CLICK MUST NAVIGATE. next/link is a SOFT navigation, and these targets sit under the
  //     layout that rendered this screen — which Next does not re-execute on soft nav, so the
  //     gate screen stays mounted and the button does nothing. This is the bug that shipped.
  // Anchor on the rendered exit block, not the whole file: the support/sign-out exits below it
  // legitimately stay <Link> (they leave the /vendor segment, so the layout really is torn down).
  const exitStart = screen.indexOf('VENDOR_GATE_CARVE_OUT_SEGMENTS.map')
  assert(exitStart > 0, 'probe anchor: the exit block renders from the shared segment constant')
  const exitBlock = screen.slice(exitStart, exitStart + 400)
  assert(/<a\b/.test(exitBlock),
    'the carve-out exits are plain <a> — a full document request re-runs the layout so the door re-evaluates')
  assert(!/<Link\b/.test(exitBlock),
    'no carve-out exit is a <Link> — a soft navigation does not re-run the gated layout, so the button would do nothing')

  // ── [11] NO NAVIGATION BACK INTO THE PORTAL WHILE GATED ────────────────────
  // The hole this closes: a REJECTED operator legitimately sitting on a carve-out page got the
  // full portal shell around them, and its Dashboard link soft-navigated them back inside. The
  // page gate does not re-run on soft nav, so the carve-out built to prevent a deadlock was
  // handing out a working way back in.
  console.log('\n[11] a gated operator is offered the exits and nothing that re-enters the portal')

  /** Names the offending links rather than reporting a bare boolean. */
  const portalOnly = VENDOR_PORTAL_NAV_KEYS.filter(
    k => !(VENDOR_GATE_CARVE_OUT_SEGMENTS as readonly string[]).includes(k),
  )
  const offenders = (state: 'ADMITTED' | 'AWAITING' | 'DECLINED') =>
    vendorShellNavKeys(state).filter(k => (portalOnly as readonly string[]).includes(k))

  for (const state of ['AWAITING', 'DECLINED'] as const) {
    const found = offenders(state)
    assert(found.length === 0, `${state}: no portal link is offered — offenders: [${found.join(', ')}]`)
    const keys = vendorShellNavKeys(state)
    assert(keys.length === VENDOR_GATE_CARVE_OUT_SEGMENTS.length,
      `${state}: the nav is exactly the carve-out set (got [${keys.join(', ')}])`)
    // ROUND-TRIP: every link the gated shell offers is one the DOOR actually admits. A shell
    // offering a route the door refuses would bounce the operator into the wall — the deadlock
    // wearing a different hat.
    for (const key of keys) {
      assert(isVendorGateCarveOut(`/vendor/vogfixture-fair/${key}`),
        `${state}: the offered link '${key}' is a route the door lets through`)
    }
  }

  // POSITIVE CONTROLS — the checker must be able to FAIL and to NAME the link.
  const poisoned = ['dashboard', 'settings'] as const
  const named = poisoned.filter(k => (portalOnly as readonly string[]).includes(k))
  assert(named.length === 1 && named[0] === 'dashboard',
    `positive control: the offender check NAMES a reintroduced Dashboard link (named: [${named.join(', ')}])`)
  assert(portalOnly.length > 0,
    `positive control: there ARE portal-only keys to catch (${portalOnly.join(', ')}) — not vacuous`)
  // …and the ADMITTED case must still get the full portal, or this "fix" just broke the portal.
  assert(offenders('ADMITTED').length === portalOnly.length,
    'an ADMITTED operator still gets the full portal nav — the filter is conditional, not a deletion')
  assert(vendorShellNavKeys('ADMITTED').includes('dashboard'),
    'positive control: ADMITTED still sees Dashboard')

  // ── [12] the gate screen offers ZERO portal navigation ─────────────────────
  console.log('\n[12] the ACCESS DECLINED screen links nowhere into the portal')
  for (const key of portalOnly) {
    assert(!new RegExp(`/${key}\\b`).test(screen), `the gate screen has no '${key}' link`)
  }
  assert(/vendorCarveOutPath\(/.test(screen),
    'positive control: the gate screen DOES render links (the exits) — so "no portal link" is not "no links at all"')
  // It is rendered BARE by the layout — no portal chrome — matching OrganizerGateScreen.
  const layoutSrc = readFileSync('app/vendor/layout.tsx', 'utf8')
  assert(/return <VendorOperatorGateScreen[^>]*\/>/.test(layoutSrc),
    'the gate screen is returned standalone, not wrapped in the portal shell')

  // ── [13] both nav surfaces are filtered, and from the SHARED source ────────
  console.log('\n[13] the shell derives its nav from the door\'s verdict (both surfaces)')
  const shellRaw = readFileSync('app/vendor/[fairSlug]/_components/VendorPortalShell.tsx', 'utf8')
  // Strip comments FIRST. A raw count of `vendorShellNavKeys(` silently included the phrase from
  // a doc comment, so unfiltering the mobile nav still left two "call sites" and this check
  // passed while the hole was open. Same code-vs-prose trap as [8] and [9]; caught by the
  // negative control, which is the only reason it is not still wrong.
  const shell = shellRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // Assert PER NAV SURFACE, by name, so a failure says WHICH one is unfiltered rather than
  // reporting a count that two different bugs could produce.
  for (const fn of ['SidebarContent', 'MobileBottomNav']) {
    const start = shell.indexOf(`function ${fn}`)
    assert(start > 0, `probe anchor: ${fn} exists in the shell`)
    // Slice to the NEXT top-level declaration, not to the first `\n}`: these components
    // destructure their props across lines, so `}: {` puts a brace in column 0 *inside the
    // parameter list* and a naive scan ended the body before it started — which made this check
    // fail on correct code. Found by the negative control, not by reading.
    const after = shell.slice(start + 1)
    const nextDecl = after.search(/\n(?:export default function |export function |function |const \w+ = \()/)
    const body = nextDecl === -1 ? after : after.slice(0, nextDecl)
    assert(/vendorShellNavKeys\(/.test(body),
      `${fn} filters its nav through the door's verdict — an unfiltered surface hands a gated operator a way back in`)
    assert(!/VENDOR_PORTAL_NAV_KEYS/.test(body),
      `${fn} does not reach past the filter to the full portal key set`)
  }
  assert(!/const NAV_ITEMS\s*=/.test(shell),
    'the shell no longer hand-rolls its own nav list — the key set is shared with the door')
  assert(/useVendorAdmittance\(/.test(shell),
    'the shell reads the DOOR\'s verdict rather than deriving admittance a second time')
  const provider = readFileSync('app/vendor/_components/VendorAdmittanceProvider.tsx', 'utf8')
  for (const mod of SERVER_ONLY) {
    assert(!importsServerOnly(provider, mod), `the admittance provider does not import ${mod} (§7)`)
  }

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
