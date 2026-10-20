/**
 * RATE-LIMIT TEST (readiness 1.7) — every policy refuses at ITS OWN number, with the real
 * @upstash/ratelimit against a local Upstash-compatible proxy (docker-compose.test.yml,
 * fairsynq-test-upstash on :58080). Nothing touches the Upstash account.
 *
 * The bug: lib/ratelimit built ONE limiter (30/min) and used it for every policy, so the
 * numbers in RATE_LIMITS were never read. Also found while planning: order creation, cancel
 * and the public vendor read were keyed by IP — at a fair, a crowd on one Wi-Fi or carrier IP
 * shares a single bucket.
 *
 *   [0] proxy up + POSITIVE CONTROL: a refusal is observable at all.
 *   [1] each policy allows exactly its number in a fresh window, refuses the next, and reports
 *       that number in X-RateLimit-Limit.
 *   [2] isolation: one user's exhausted policy leaves their other policies and other users alone.
 *   [3] the window resets (short test window — never the real clock's minute).
 *   [4] fail-closed policies refuse when Redis is down; fail-open ones allow.
 *   [5] wiring: each route uses its intended policy and key (per user where signed in), every
 *       policy has a caller, `login` is gone, and no limiter is built from a hard-coded number.
 *
 * Run:  npm run test:db:up && npx tsx scripts/rate-limit-test.ts
 */

import { readFileSync } from 'node:fs'
import { stripComments } from './_strip-comments'

process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_UPSTASH_URL ?? 'http://localhost:58080'
process.env.UPSTASH_REDIS_REST_TOKEN = 'fairsynq-test-token'
delete process.env.RATE_LIMIT_TEST

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }
const run = Math.random().toString(36).slice(2, 8)

// THE EXPECTED TABLE — hard-coded, not read from RATE_LIMITS, so a changed number fails here.
const EXPECTED: Record<string, number> = {
  vendorStatus: 120,
  orderCreate: 10,
  deliveryCheck: 20,
  connectStatusFresh: 75,
  refund: 10,
  publicRoutes: 60,
  publicAnonymous: 600,
}

async function main() {
  const rl = await import('../lib/ratelimit')

  console.log('[0] proxy + positive control')
  let up = false
  for (let i = 0; i < 20 && !up; i++) {
    try {
      const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/`, { method: 'POST', headers: { Authorization: 'Bearer fairsynq-test-token', 'Content-Type': 'application/json' }, body: '["PING"]' })
      up = (await r.json()).result === 'PONG'
    } catch { await new Promise(r => setTimeout(r, 500)) }
  }
  assert(up, 'local Upstash proxy answers PING (npm run test:db:up starts it)')
  if (!up) { console.log(`\n❌ rate-limit: ${pass} passed, ${fail + 1} failed`); process.exit(1) }
  const ctl = []
  for (let i = 0; i < 11; i++) ctl.push((await rl.enforceRateLimit(`${run}:control`, 'refund')).allowed)
  assert(ctl.slice(0, 10).every(Boolean) && ctl[10] === false, 'positive control: the 11th refund request is refused — refusals are observable')

  console.log('[1] each policy at its own number')
  assert(JSON.stringify(Object.keys(rl.RATE_LIMITS).sort()) === JSON.stringify(Object.keys(EXPECTED).sort()), `policies are exactly ${Object.keys(EXPECTED).join(', ')} (login removed)`)
  for (const [policy, n] of Object.entries(EXPECTED)) {
    const key = `${run}:p:${policy}`
    let allowed = 0, firstLimitHeader = ''
    for (let i = 0; i < n; i++) {
      const r = await rl.enforceRateLimit(key, policy as keyof typeof rl.RATE_LIMITS)
      if (r.allowed) allowed++
      if (i === 0) firstLimitHeader = r.headers['X-RateLimit-Limit']
    }
    const over = await rl.enforceRateLimit(key, policy as keyof typeof rl.RATE_LIMITS)
    assert(allowed === n && over.allowed === false && firstLimitHeader === String(n) && !!over.headers['Retry-After'],
      `${policy}: ${n} allowed, request ${n + 1} refused, X-RateLimit-Limit=${firstLimitHeader} (got ${allowed} allowed, over=${over.allowed})`)
  }

  console.log('[2] isolation')
  for (let i = 0; i < EXPECTED.refund; i++) await rl.enforceRateLimit(`${run}:userA`, 'refund')
  assert((await rl.enforceRateLimit(`${run}:userA`, 'refund')).allowed === false, 'user A has used up refund')
  assert((await rl.enforceRateLimit(`${run}:userA`, 'orderCreate')).allowed === true, "user A's orderCreate is unaffected (separate bucket per policy)")
  assert((await rl.enforceRateLimit(`${run}:userB`, 'refund')).allowed === true, "user B's refund is unaffected (separate bucket per user)")

  console.log('[3] window reset (2 s test window)')
  rl.__setWindowOverrideForTest('2 s')
  for (let i = 0; i < EXPECTED.refund; i++) await rl.enforceRateLimit(`${run}:w`, 'refund')
  const blocked = await rl.enforceRateLimit(`${run}:w`, 'refund')
  await new Promise(r => setTimeout(r, 2300))
  const again = await rl.enforceRateLimit(`${run}:w`, 'refund')
  rl.__setWindowOverrideForTest(null)
  assert(blocked.allowed === false && again.allowed === true, 'refused at the limit, allowed again once the window has passed')

  console.log('[4] Redis down')
  rl.__setStateForTest({ type: 'failed', error: 'down' })
  assert((await rl.enforceRateLimit('x', 'refund', { failClosed: true })).allowed === false, 'fail-closed → refused')
  assert((await rl.enforceRateLimit('x', 'publicRoutes')).allowed === true, 'fail-open (default) → allowed')
  rl.__resetForTest()

  console.log('[5] wiring')
  const src = (p: string) => stripComments(readFileSync(p, 'utf8'))
  const lib = src('lib/ratelimit.ts')
  assert(/slidingWindow\(\s*cfg\.requests\s*,\s*window\s*\)/.test(lib) && !/slidingWindow\(\s*\d+/.test(lib.replace(/RATE_LIMIT_TEST[\s\S]*?slidingWindow\(3, '3 s'\)/, '')),
    'every limiter is built from its RATE_LIMITS entry (no hard-coded number outside the legacy 3/3s test mode)')
  const ROUTES: Array<[string, RegExp, string]> = [
    ['app/api/orders/route.ts', /enforceRateLimit\(`order:\$\{clerkId\}`,\s*'orderCreate',\s*\{\s*failClosed:\s*true\s*\}\)/, 'orderCreate per user, fail closed'],
    ['app/api/orders/[id]/cancel/route.ts', /enforceRateLimit\(`cancel:\$\{clerkId\}`,\s*'refund',\s*\{\s*failClosed:\s*true\s*\}\)/, 'cancel → refund per user, fail closed'],
    ['app/api/orders/delivery-check/route.ts', /enforceRateLimit\(clerkId,\s*'deliveryCheck',\s*\{\s*failClosed:\s*true\s*\}\)/, 'deliveryCheck per user, fail closed'],
    ['app/api/vendors/[id]/route.ts', /'publicRoutes'[\s\S]*'publicAnonymous'|'publicAnonymous'[\s\S]*'publicRoutes'/, 'public vendor read: per user when signed in, per IP (higher limit) when not'],
    ['app/api/auth/access/route.ts', /'publicRoutes'[\s\S]*'publicAnonymous'|'publicAnonymous'[\s\S]*'publicRoutes'/, 'access check: per user when signed in, per IP when not'],
  ]
  for (const [file, re, label] of ROUTES) assert(re.test(src(file)), `${file}: ${label}`)
  for (const file of ['app/api/orders/route.ts', 'app/api/orders/[id]/cancel/route.ts']) {
    const s = src(file)
    assert(s.indexOf('requireAuth()') >= 0 && s.indexOf('requireAuth()') < s.indexOf('enforceRateLimit('), `${file}: the user is known before the limit is checked`)
  }
  const used = new Set<string>()
  const { execSync } = await import('node:child_process')
  for (const line of execSync(`grep -rhoE "enforceRateLimit\\([^)]*'[a-zA-Z]+'" app lib`, { encoding: 'utf8' }).split('\n')) {
    const m = line.match(/'([a-zA-Z]+)'\s*$/); if (m) used.add(m[1])
  }
  const unused = Object.keys(EXPECTED).filter(p => !used.has(p))
  assert(unused.length === 0, `every policy has a caller${unused.length ? ` — unused: ${unused.join(', ')}` : ''}`)
  assert(!used.has('login'), 'no caller uses a login policy (sign-in is protected by Clerk)')

  console.log(`\n${fail === 0 ? '✅' : '❌'} rate-limit: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => { console.error('[rate-limit-test] FAILED:', err); process.exit(1) })
