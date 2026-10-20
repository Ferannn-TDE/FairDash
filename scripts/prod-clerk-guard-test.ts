/**
 * PROD-CLERK GUARD TEST — a local process refuses the production Clerk instance's keys
 * (lib/prod-clerk-guard.ts), and every Clerk client construction outside the request path
 * is behind the guard.
 *
 *   [0] POSITIVE CONTROL — the key decoder reads the host back out of a key built here.
 *   [1] DECISION — production host / live keys refused locally; another dev app allowed;
 *       deployed runtimes exempt; CONFIRM_PROD_CLERK must name the host exactly.
 *   [2] CHOKEPOINTS — proxy, role-sync, onboarding, and every script that builds a client.
 *   [3] SCANNER CONTROL — the [2] scan catches a planted unguarded construction.
 *
 * Run:  npx tsx scripts/prod-clerk-guard-test.ts
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { clerkHostFromPublishableKey, decideClerkAccess, assertNotProductionClerk, PRODUCTION_CLERK_HOSTS } from '../lib/prod-clerk-guard'

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

const pkFor = (host: string, kind = 'test') => `pk_${kind}_${Buffer.from(`${host}$`).toString('base64')}`
const PROD = 'noble-tahr-47.clerk.accounts.dev'
const LOCAL = 'quiet-otter-12.clerk.accounts.dev'
const local = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'development', ...extra })

console.log('[0] positive control')
assert(clerkHostFromPublishableKey(pkFor(PROD)) === PROD, 'decodes the host from a test key')
assert(clerkHostFromPublishableKey(pkFor('clerk.fairsynq.com', 'live')) === 'clerk.fairsynq.com', 'decodes a live key')
assert(clerkHostFromPublishableKey('not-a-key') === null, 'garbage → null')
assert(PRODUCTION_CLERK_HOSTS.includes(PROD), 'the production host list names the instance www runs on')

console.log('[1] decision')
assert(!decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD), CLERK_SECRET_KEY: 'sk_test_x' })).allowed, 'local + production instance → refused')
assert(decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(LOCAL), CLERK_SECRET_KEY: 'sk_test_x' })).allowed, 'local + its own dev application → allowed')
assert(!decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor('clerk.fairsynq.com', 'live') })).allowed, 'local + live publishable key → refused')
assert(!decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(LOCAL), CLERK_SECRET_KEY: 'sk_live_x' })).allowed, 'local + live secret key → refused')
assert(decideClerkAccess(local()).allowed, 'no Clerk keys → allowed (nothing to protect)')
assert(!decideClerkAccess(local({ CLERK_SECRET_KEY: 'sk_test_x' })).allowed, 'secret key with no publishable key → refused (instance unknown)')
assert(decideClerkAccess({ NODE_ENV: 'production', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD) }).allowed, 'deployed (NODE_ENV=production) → exempt')
assert(decideClerkAccess({ VERCEL: '1', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD) }).allowed, 'deployed (VERCEL) → exempt')
assert(decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD), CONFIRM_PROD_CLERK: PROD })).allowed, 'CONFIRM_PROD_CLERK=<host> → allowed')
assert(!decideClerkAccess(local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD), CONFIRM_PROD_CLERK: 'true' })).allowed, 'CONFIRM_PROD_CLERK=true does not satisfy it')
let threw = false
try { assertNotProductionClerk('test', local({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pkFor(PROD) })) } catch (e) { threw = (e as Error).name === 'ProdClerkAccessRefused' }
assert(threw, 'assertNotProductionClerk throws ProdClerkAccessRefused')

console.log('[2] chokepoints')
const src = (p: string) => readFileSync(p, 'utf8')
assert(/decideClerkAccess\(process\.env\)/.test(src('proxy.ts')) && /status: 503/.test(src('proxy.ts')), 'proxy refuses every request with production keys locally')
const CONSTRUCT = /createClerkClient\(\{|await clerkClient\(\)/
function unguarded(text: string): boolean {
  const lines = text.split('\n')
  return lines.some((ln, i) => CONSTRUCT.test(ln) && !/^\s*(import|\/\/|\*)/.test(ln)
    && !lines.slice(Math.max(0, i - 3), i).some(p => /assertNotProductionClerk\(/.test(p)))
}
const files = [...readdirSync('scripts').map(f => join('scripts', f)), ...readdirSync('lib').map(f => join('lib', f)), 'app/onboarding/page.tsx']
  .filter(f => /\.tsx?$/.test(f) && f !== 'scripts/prod-clerk-guard-test.ts')
const constructing = files.filter(f => CONSTRUCT.test(src(f)))
const offenders = constructing.filter(f => unguarded(src(f)))
assert(constructing.length >= 10, `found ${constructing.length} files that build a Clerk client`)
assert(offenders.length === 0, `every construction is guarded${offenders.length ? ` — unguarded: ${offenders.join(', ')}` : ''}`)

console.log('[3] scanner control')
assert(unguarded(`const c = createClerkClient({ secretKey })`), 'catches a planted unguarded construction')
assert(!unguarded(`assertNotProductionClerk('x')\nconst c = createClerkClient({ secretKey })`), 'accepts a guarded one')

console.log(`\n${fail === 0 ? '✅' : '❌'} prod-clerk-guard: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
