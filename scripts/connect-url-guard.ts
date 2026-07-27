/**
 * CONNECT ONBOARDING URLs — no payee can be returned to localhost from production.
 *
 * THE DEFECT: Stripe Connect onboarding in production returned the payee to `localhost`. It was
 * NOT the `process.env.X ?? 'http://localhost:3000'` fallback shape — that does not exist in
 * this repo. All three routes already threw when NEXT_PUBLIC_APP_URL was UNSET. They validated
 * PRESENCE and never VALUE, so a var set to `http://localhost:3000` passed `if (!appUrl)` and
 * produced a syntactically perfect, completely dead link.
 *
 * WHY IT MATTERS BEYOND ONE TEST: every vendor, runner and organizer onboarding builds its link
 * this way. A payee who finishes Stripe's flow and lands on a dead page cannot tell that the
 * Stripe side actually succeeded — they will assume it failed, and some will not come back.
 * Stripe onboarding is the longest-lead pre-fair item and the one that cannot be compressed.
 *
 *   [0] positive controls on the probe
 *   [1] the validator REJECTS a loopback origin in production (the actual bug)
 *   [2] and still ALLOWS it in development (this must not break local work)
 *   [3] unset / malformed / non-http are rejected with a named error
 *   [4] ALL THREE onboarding routes use the one source — none re-derives the base URL
 *   [5] no localhost literal can reach a Connect URL (comment-stripped)
 *
 * Pure logic/file reader. Run:  npx tsx scripts/connect-url-guard.ts
 */

import { readFileSync } from 'node:fs'
import { requireAppBaseUrl, AppUrlMisconfigured, isProductionRuntime } from '../lib/app-url'
import { stripComments } from './_strip-comments'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

/** Env fixtures — passed in explicitly so NODE_ENV is never mutated globally. */
const prod = (url?: string) => ({ NODE_ENV: 'production', ...(url ? { NEXT_PUBLIC_APP_URL: url } : {}) }) as NodeJS.ProcessEnv
const dev = (url?: string) => ({ NODE_ENV: 'development', ...(url ? { NEXT_PUBLIC_APP_URL: url } : {}) }) as NodeJS.ProcessEnv

const throws = (env: NodeJS.ProcessEnv): { threw: boolean; named: boolean; msg: string } => {
  try { requireAppBaseUrl(env); return { threw: false, named: false, msg: '' } }
  catch (e) { return { threw: true, named: e instanceof AppUrlMisconfigured, msg: e instanceof Error ? e.message : String(e) } }
}

const ROUTES = [
  'app/api/vendors/[id]/stripe/onboarding-link/route.ts',
  'app/api/organizer/stripe/onboarding-link/route.ts',
  'app/api/runners/me/stripe/onboarding-link/route.ts',
]

console.log('[0] positive controls on the probe')
assert(isProductionRuntime(prod()) && !isProductionRuntime(dev()), 'the production predicate distinguishes the two envs')
assert(requireAppBaseUrl(prod('https://fair-synq.vercel.app')) === 'https://fair-synq.vercel.app',
  'a correct production origin passes through unchanged (not a constant rejector)')
assert(requireAppBaseUrl(prod('https://fair-synq.vercel.app/')) === 'https://fair-synq.vercel.app',
  'a trailing slash is stripped once, here, instead of at three call sites')

console.log('\n[1] ⛔ a LOOPBACK origin is REJECTED in production — the actual bug')
for (const host of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000', 'https://localhost']) {
  const r = throws(prod(host))
  assert(r.threw && r.named, `${host} → throws AppUrlMisconfigured`)
}
const lb = throws(prod('http://localhost:3000'))
assert(/localhost/.test(lb.msg) && /REDEPLOY|redeploy/.test(lb.msg),
  'the error names the offending host AND the redeploy requirement (NEXT_PUBLIC_* is baked at build time)')

console.log('\n[2] and it is STILL ALLOWED in development — this must not break local work')
assert(requireAppBaseUrl(dev('http://localhost:3000')) === 'http://localhost:3000',
  'localhost is fine in development (the rule is about production, not about localhost)')

console.log('\n[3] unset / malformed / non-http are rejected with a NAMED error')
assert(throws(prod()).named, 'UNSET → AppUrlMisconfigured (the pre-existing check, preserved)')
assert(throws(prod('   ')).named, 'whitespace-only → rejected (an empty-ish value is not a value)')
assert(throws(prod('not a url')).named, 'malformed → rejected')
assert(throws(prod('ftp://example.com')).named, 'non-http(s) scheme → rejected')
assert(/not configured/.test(throws(prod()).msg), 'the unset message still names the variable')

console.log('\n[4] all three onboarding routes use the ONE source')
for (const r of ROUTES) {
  const src = stripComments(readFileSync(r, 'utf8'))
  const leg = r.split('/')[2]
  assert(/requireAppBaseUrl\(\)/.test(src), `${leg}: builds its base from requireAppBaseUrl()`)
  // The old shape must be gone — a route that still reads the raw env re-introduces the hole.
  assert(!/process\.env\.NEXT_PUBLIC_APP_URL/.test(src),
    `${leg}: does NOT read process.env.NEXT_PUBLIC_APP_URL directly (one derivation, not three)`)
  assert(/returnUrl:/.test(src) && /refreshUrl:/.test(src), `${leg}: still supplies both return and refresh URLs`)
}

console.log('\n[5] no localhost literal can reach a Connect URL')
for (const r of [...ROUTES, 'lib/stripe-connect.ts', 'lib/app-url.ts']) {
  const src = stripComments(readFileSync(r, 'utf8'))
  // lib/app-url.ts legitimately NAMES loopback hosts in its reject-list; that is the opposite
  // of a fallback, so it is allowed to mention them — but never as a `??` default.
  assert(!/\?\?\s*['"`]https?:\/\/(localhost|127\.0\.0\.1)/.test(src),
    `${r.split('/').slice(-2).join('/')}: no \`?? 'http://localhost…'\` fallback (the plausible-value class)`)
}
const appUrlSrc = stripComments(readFileSync('lib/app-url.ts', 'utf8'))
assert(/LOOPBACK_HOSTS/.test(appUrlSrc) && /isProductionRuntime\(env\)/.test(appUrlSrc),
  'the loopback rejection is gated on production, not applied unconditionally')

console.log(`\n${'─'.repeat(52)}`)
console.log(fail === 0 ? `✅ connect-url-guard: ${pass} passed, 0 failed` : `❌ connect-url-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
