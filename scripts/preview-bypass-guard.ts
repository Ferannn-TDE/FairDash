/**
 * PREVIEW-BYPASS GUARD — the temporary pre-fair preview unlock requires BOTH an env flag AND an
 * admin session, is OFF by default, and changes ACCESS only — never what a surface SAYS.
 *
 * Why guarded: this is scaffolding that deliberately opens a closed storefront. The failure modes
 * are (a) it opens for a signed-out visitor, (b) it ships enabled, (c) a previewing tester sees
 * copy claiming the fair is live, and then swears the badge was wrong. Each is asserted below.
 *
 * REMOVAL (2026-08-05, when the fair opens): delete lib/preview-access.ts,
 * app/api/preview-access/, the hook + banner in app/fair/[fairSlug]/page.tsx, the health flag,
 * and this file. `grep -ri preview` finds all of it.
 *
 *   [0] POSITIVE CONTROLS (first) — computePreviewAccess actually returns true for the one
 *       allowed combination, so the three refusals below aren't vacuous.
 *   [1] BOTH CONDITIONS — flag-only, admin-only, and neither are all refused. Default is OFF.
 *   [2] SERVER-SIDE — the flag is never NEXT_PUBLIC_ (unflippable from a bundle), and the API
 *       runs a real admin check per request.
 *   [3] ACCESS ONLY, NOT WORDING — no display surface consults the bypass: the badge derives from
 *       liveState alone, the hardcoded "Live Now" is gone, and the banner states the fair is not
 *       live AND that orders are real.
 *
 * Pure file-reader + pure-function. Run:  npx tsx scripts/preview-bypass-guard.ts
 */

import { readFileSync } from 'node:fs'
import { computePreviewAccess, isPreviewBypassEnabled } from '../lib/preview-access'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

// Scan CODE, not the comments documenting what is deliberately avoided — a guard that can't tell
// code from its own rationale forces the rationale to be deleted to stay green (same stance as
// delivery-address-guard and live-badge-guard).
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

const lib   = stripComments(readFileSync('lib/preview-access.ts', 'utf8'))
const route = stripComments(readFileSync('app/api/preview-access/route.ts', 'utf8'))
const page  = readFileSync('app/fair/[fairSlug]/page.tsx', 'utf8')

console.log('[0] positive control: the one allowed combination IS allowed')
assert(computePreviewAccess({ flagEnabled: true, isAdmin: true }) === true,
  'flag ON + admin → allowed (so the refusals below are not vacuous)')

console.log('\n[1] both conditions required; off by default')
assert(computePreviewAccess({ flagEnabled: true, isAdmin: false }) === false,
  'flag ON + NOT admin → refused (a signed-out visitor never gets through)')
assert(computePreviewAccess({ flagEnabled: false, isAdmin: true }) === false,
  'flag OFF + admin → refused (an admin alone cannot open a closed fair)')
assert(computePreviewAccess({ flagEnabled: false, isAdmin: false }) === false, 'neither → refused')
assert(isPreviewBypassEnabled() === (process.env.ALLOW_PREVIEW_BYPASS === 'true'),
  'the flag reads exactly ALLOW_PREVIEW_BYPASS === "true" (no other truthy spelling)')
assert(!/ALLOW_PREVIEW_BYPASS\s*!==\s*'false'|\?\?\s*true/.test(lib), 'no default-ON fallback anywhere in the decision')

console.log('\n[2] the decision is server-side and unflippable from a bundle')
assert(!/NEXT_PUBLIC_/.test(lib) && !/NEXT_PUBLIC_/.test(route),
  'the flag is NOT NEXT_PUBLIC_ — it cannot be set in client code')
// Assert the FLOW, not which file holds a string: the decision lives in one function, that
// function does the admin check and ANDs via the pure core, and every caller routes through it.
// (These previously keyed on the API route file and broke the moment the decision was shared
// with the order path — a guard matching locations is defeated by moving the code.)
assert(/export async function hasPreviewAccess/.test(lib), 'ONE server-side decision function exists')
assert(/requireStrictAdminAuth/.test(lib), 'the decision runs a real admin check per request')
assert(/computePreviewAccess\(/.test(lib), 'the decision ANDs both conditions through the pure core')
assert(/hasPreviewAccess\(\)/.test(route), 'the storefront probe routes through the shared decision')
assert(!/requireStrictAdminAuth/.test(route) && !/computePreviewAccess\(/.test(route),
  'the probe does NOT reimplement the decision (one copy, not two)')
assert(!/computePreviewAccess\(/.test(page) && !/ALLOW_PREVIEW_BYPASS/.test(page),
  'the client never computes access itself — it consumes the server boolean')

console.log('\n[3] access only: no display surface consults the bypass')
// The badge must key on liveState alone. If `previewing` appeared in the badge expression, a
// previewing admin would be told the fair is live.
const badgeBlock = page.slice(page.indexOf('State badge'), page.indexOf('State badge') + 700)
assert(/liveState === 'live'/.test(badgeBlock), 'the hero badge derives from liveState')
assert(!/previewing/.test(badgeBlock), 'the hero badge does NOT consult `previewing` (preview never claims live)')
assert(!/{\/\* Live badge \*\/}/.test(page), 'the old hardcoded "Live Now" badge is gone')
assert(/Orders placed here are REAL/.test(page), 'the banner states orders are real rows')
assert(/not live yet/.test(page), 'the banner states the fair is not live')
assert(/previewAllowed === true/.test(page) && /previewAllowed/.test(page),
  'the gate opens only on an explicit true — a null (in-flight) probe keeps it closed')

console.log('\n[4] the flag is visible per environment')
const health = readFileSync('app/api/health/route.ts', 'utf8')
assert(/previewBypass:\s*isPreviewBypassEnabled\(\)/.test(health),
  '/api/health reports the effective flag (no silent local/prod drift)')

console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} preview-bypass-guard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
