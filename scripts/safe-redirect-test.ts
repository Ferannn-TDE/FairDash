/**
 * SIGN-IN REDIRECTS STAY ON THE SITE (lib/safe-redirect.ts) — static, no DB.
 *
 * 2026-11-17: '/<TAB>/evil.com' passed safeRedirect, and browsers strip tab/newline from URLs,
 * so it navigated as '//evil.com'. Every sign-in page, /onboarding, /login and /account/redirect
 * run ?redirect= through safeRedirect, so this suite pins it.
 *
 *   [0] probe controls: the resolver used below DOES see the tab trick leave the site (on the
 *       pre-fix logic), and DOES keep a normal path on the site
 *   [1] every input that must be refused returns the caller's fallback
 *   [2] encoded forms (%09 %0A %0D), decoded the way the page reads ?redirect=, are refused
 *   [3] positive controls: checkout, order tracking and order history pass unchanged
 *   [4] invariant: whatever comes back resolves on www.fairsynq.com
 *
 * Run:  npx tsx scripts/safe-redirect-test.ts
 */
import { safeRedirect } from '../lib/safe-redirect'

let pass = 0, fail = 0
const assert = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const SITE = 'https://www.fairsynq.com'
const FALLBACK = '/fairs' // the customer card's fallback (RoleAuthCard redirectTo)
// Where a browser ends up for a returned value: the same parser browsers use.
const landsOn = (v: string) => new URL(v, SITE).origin
// What the page reads: RoleAuthCard calls searchParams.get('redirect'), which percent-decodes.
const fromQuery = (raw: string) => new URLSearchParams(`redirect=${raw}`).get('redirect')

// The logic before 2026-11-17, kept here only as the probe's positive control.
function preFix(value: string, fallback: string): string {
  if (value[0] !== '/') return fallback
  if (value[1] === '/') return fallback
  if (value.includes('\\')) return fallback
  if (value.includes('://')) return fallback
  return value
}

console.log('[0] probe controls')
assert(landsOn(preFix('/\t/evil.com', FALLBACK)) === 'https://evil.com',
  'the old check let /<TAB>/evil.com through and it lands on evil.com (the probe can see the bug)')
assert(landsOn('/fair/x/checkout') === SITE, 'a normal path lands on the site (the probe can see a pass)')
assert(fromQuery('/%09/evil.com') === '/\t/evil.com', '%09 in the query decodes to a real tab, as the page reads it')

console.log('\n[1] refused inputs fall back')
const refused: Array<[string, string | null | undefined]> = [
  ['https://evil.com', 'https://evil.com'],
  ['//evil.com', '//evil.com'],
  ['/\\evil.com', '/\\evil.com'],
  ['/<TAB>/evil.com', '/\t/evil.com'],
  ['/<LF>/evil.com', '/\n/evil.com'],
  ['/<CR>/evil.com', '/\r/evil.com'],
  ['/<DEL>/evil.com', '/\x7f/evil.com'],
  ['/<NUL>/evil.com', '/\x00/evil.com'],
  ['leading space before //evil.com', ' //evil.com'],
  ['/<TAB>\\evil.com', '/\t\\evil.com'],
  ['\\\\evil.com', '\\\\evil.com'],
  ['javascript:alert(1)', 'javascript:alert(1)'],
  ['empty value', ''],
  ['missing (null)', null],
  ['missing (undefined)', undefined],
]
for (const [label, v] of refused) {
  assert(safeRedirect(v, FALLBACK) === FALLBACK, `${label} → ${FALLBACK}`)
}
assert(safeRedirect('//evil.com', '/vendor') === '/vendor', "the caller's own fallback is used (vendor → /vendor)")

console.log('\n[2] encoded forms, as read from ?redirect=')
for (const enc of ['%09', '%0A', '%0D', '%0a', '%0d']) {
  const v = fromQuery(`/${enc}/evil.com`)
  assert(safeRedirect(v, FALLBACK) === FALLBACK, `?redirect=/${enc}/evil.com → ${FALLBACK}`)
}
assert(safeRedirect(fromQuery('%2F%2Fevil.com'), FALLBACK) === FALLBACK, '?redirect=%2F%2Fevil.com → /fairs')
// Not decoded (a literal "%09" left in a path) is just an odd on-site path, never off-site.
assert(landsOn(safeRedirect('/%09/evil.com', FALLBACK)) === SITE, 'a literal "/%09/evil.com" path stays on the site')

console.log('\n[3] positive controls pass unchanged')
for (const v of ['/fair/x/checkout', '/account/orders/cmabc123', '/account/orders', '/fair/italian-fest/checkout?step=2#pay']) {
  assert(safeRedirect(v, FALLBACK) === v, `${v} is kept`)
}
assert(safeRedirect(fromQuery(encodeURIComponent('/fair/x/checkout')), FALLBACK) === '/fair/x/checkout',
  'an encoded checkout path survives the round trip through ?redirect=')

console.log('\n[4] invariant: every result lands on the site')
const all = [...refused.map(([, v]) => v), '/fair/x/checkout', '/account/orders', '/%09/evil.com']
assert(all.every(v => landsOn(safeRedirect(v, FALLBACK)) === SITE), `all ${all.length} inputs resolve on ${SITE}`)

console.log(`\n${fail === 0 ? '✅' : '❌'} safe redirect: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
