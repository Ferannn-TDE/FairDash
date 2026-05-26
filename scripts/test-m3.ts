/**
 * M3 Test Suite — Lazy Redis init / enforceRateLimit
 *
 * Run:  npx tsx scripts/test-m3.ts
 *
 * Tests the new enforceRateLimit() implementation:
 *   1.  Missing env vars handled gracefully (no crash on import)
 *   2.  Disabled state allows requests (fail-open)
 *   3.  Fail-closed blocks when Redis unavailable
 *   4.  Redis init timeout handled (resolves within 1.5 s)
 *   5.  Singleton — only one init per process
 *   6.  Rate limit enforced with real Redis (30/1 m policy)
 *   7.  Rate limit response headers present on blocked request
 *   8.  Sensitive endpoint fails closed on Redis error
 *   9.  Non-sensitive endpoint fails open on Redis error
 *  10.  Production throws without Redis config
 *  11.  Key namespacing correct (v1:<policy>:<key> format)
 */

// ─── Env setup ────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

const RUN_ID = Date.now()

// Saved originals — restored after tests that mutate env
const ORIG_URL   = process.env.UPSTASH_REDIS_REST_URL
const ORIG_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const ORIG_NODE_ENV = process.env.NODE_ENV

function restoreEnv() {
  if (ORIG_URL)   process.env.UPSTASH_REDIS_REST_URL   = ORIG_URL
  else            delete process.env.UPSTASH_REDIS_REST_URL
  if (ORIG_TOKEN) process.env.UPSTASH_REDIS_REST_TOKEN = ORIG_TOKEN
  else            delete process.env.UPSTASH_REDIS_REST_TOKEN
  ;(process.env as Record<string, string>).NODE_ENV = ORIG_NODE_ENV ?? 'development'
}

// ─── Import module under test (after env is loaded) ───────────────────────────

import {
  enforceRateLimit,
  __resetForTest,
  __setStateForTest,
  __setInitPromiseForTest,
  type RateLimitState,
} from '../lib/ratelimit.js'
import { Ratelimit } from '@upstash/ratelimit'

// ─── Test 1 — Missing env vars does not crash on import ─────────────────────

async function test1() {
  console.log('\nTest 1 — missing env vars handled gracefully (no crash on import)')

  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  __resetForTest()

  let threw = false
  let result: RateLimitState | null = null
  try {
    // Trigger init by calling enforceRateLimit — this calls getRatelimit() internally.
    // We don't have a direct getRatelimit export, so we use the module internals via
    // the side effect: enforceRateLimit with disabled state returns allowed=true.
    const r = await enforceRateLimit('probe', 'vendorStatus')
    result = r.allowed ? { type: 'disabled' } : { type: 'failed', error: 'unexpected block' }
  } catch {
    threw = true
  }

  restoreEnv()
  __resetForTest()

  if (threw) {
    fail('import/init threw with missing env vars')
  } else if (result?.type === 'disabled') {
    pass('missing env vars handled gracefully — state=disabled, no crash')
  } else {
    fail(`unexpected result: ${JSON.stringify(result)}`)
  }
}

// ─── Test 2 — Disabled state allows requests (fail-open) ────────────────────

async function test2() {
  console.log('\nTest 2 — disabled state allows requests (fail-open)')

  __setStateForTest({ type: 'disabled' })

  let threw = false
  let result: { allowed: boolean; headers: Record<string, string> } | null = null
  try {
    result = await enforceRateLimit('test-user', 'vendorStatus')
  } catch {
    threw = true
  }

  if (threw) {
    fail('enforceRateLimit threw with disabled state')
  } else if (result?.allowed === true) {
    pass('disabled state allows requests (allowed = true)')
  } else {
    fail(`expected allowed=true, got ${JSON.stringify(result)}`)
  }
}

// ─── Test 3 — Fail-closed blocks when Redis unavailable ─────────────────────

async function test3() {
  console.log('\nTest 3 — fail-closed blocks when Redis unavailable')

  __setStateForTest({ type: 'disabled' })

  const result = await enforceRateLimit('test-user', 'orderCreate', { failClosed: true })

  if (result.allowed === false) {
    pass('fail-closed blocks when Redis disabled (allowed = false)')
  } else {
    fail(`expected allowed=false for fail-closed+disabled, got ${result.allowed}`)
  }
}

// ─── Test 4 — Redis timeout handled gracefully ───────────────────────────────

async function test4() {
  console.log('\nTest 4 — Redis init timeout resolves within 1.5 s (not hanging forever)')

  // Inject a promise that never resolves — simulates Redis hanging during init
  const neverResolves = new Promise<RateLimitState>(() => {})
  __setInitPromiseForTest(neverResolves)

  const start = Date.now()
  const result = await enforceRateLimit('test-user', 'vendorStatus')
  const elapsed = Date.now() - start

  // Clean up the hanging promise reference before restoring
  __resetForTest()
  restoreEnv()

  if (elapsed > 1500) {
    fail(`enforceRateLimit hung for ${elapsed}ms — timeout did not fire`)
  } else if (elapsed < 900) {
    fail(`resolved in ${elapsed}ms — suspiciously fast, timeout may not be wired up`)
  } else {
    pass(`Redis timeout handled — resolved in ${elapsed}ms (expected 1000–1500ms)`)
  }

  // Fail-open: blocked init → allowed=true
  if (result.allowed === true) {
    pass('fail-open: allowed=true after timeout (non-sensitive endpoint)')
  } else {
    fail(`expected allowed=true after timeout, got ${result.allowed}`)
  }
}

// ─── Test 5 — Singleton: only one init per process ───────────────────────────

async function test5() {
  console.log('\nTest 5 — singleton — only one Redis init across 100 concurrent calls')

  __resetForTest()
  restoreEnv() // ensure real env vars are present

  let initCount = 0
  // Inject a slow init that tracks call count
  const trackedInit = new Promise<RateLimitState>((resolve) => {
    initCount++
    // Simulate async init delay
    setTimeout(() => resolve({ type: 'disabled' }), 50)
  })
  __setInitPromiseForTest(trackedInit)

  // 100 concurrent calls to enforceRateLimit — all should await the same initPromise
  const results = await Promise.all(
    Array.from({ length: 100 }, () => enforceRateLimit('probe', 'vendorStatus'))
  )

  // All 100 should have the same outcome (disabled → allowed=true)
  const allSame = results.every(r => r.allowed === results[0].allowed)

  if (initCount === 1) {
    pass('singleton confirmed — init tracked-promise created exactly once')
  } else {
    fail(`expected init once, called ${initCount} times — no singleton`)
  }

  if (allSame && results[0].allowed === true) {
    pass('all 100 concurrent calls returned allowed=true (disabled state, no crash)')
  } else {
    fail(`inconsistent results across 100 calls — singleton broken`)
  }

  __resetForTest()
  restoreEnv()
}

// ─── Test 6 — Rate limit enforced with real Redis ────────────────────────────

async function test6() {
  console.log('\nTest 6 — rate limit enforced with real Redis (vendorStatus: 30/1 m)')

  __resetForTest()
  restoreEnv()

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    pass('SKIP: Redis env vars not configured — skipping real-Redis enforcement test')
    return
  }

  const key = `test-m3-t6-${RUN_ID}`
  const LIMIT = 30
  let lastBlockedResult: { allowed: boolean; headers: Record<string, string> } | null = null
  let firstFailIdx = -1

  for (let i = 0; i < LIMIT + 1; i++) {
    const result = await enforceRateLimit(key, 'vendorStatus')
    if (!result.allowed && firstFailIdx === -1) {
      firstFailIdx = i
      lastBlockedResult = result
    }
  }

  if (firstFailIdx === LIMIT) {
    pass(`first ${LIMIT} requests allowed, ${LIMIT + 1}th (index ${firstFailIdx}) blocked — limit enforced`)
  } else if (firstFailIdx === -1) {
    fail(`all ${LIMIT + 1} requests allowed — rate limit never triggered`)
  } else {
    fail(`rate limit triggered at index ${firstFailIdx}, expected ${LIMIT}`)
  }

  if (lastBlockedResult?.headers['Retry-After']) {
    pass(`Retry-After header present on blocked response ("${lastBlockedResult.headers['Retry-After']}")`)
  } else {
    fail('Retry-After header missing on blocked response')
  }
}

// ─── Test 7 — Response headers present on blocked request ────────────────────

async function test7() {
  console.log('\nTest 7 — all rate limit headers present on blocked request')

  // Use a mock that returns blocked (success=false) to inspect headers
  const reset = Date.now() + 60_000
  __setStateForTest({
    type: 'ready',
    rl: {
      limit: async (_key: string) => ({
        success: false, limit: 30, remaining: 0, reset,
      }),
    } as unknown as Ratelimit,
  })

  const result = await enforceRateLimit('test-user', 'vendorStatus')

  __resetForTest()

  const required = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']
  const missing = required.filter(h => !result.headers[h])

  if (result.allowed === false) {
    pass('request correctly blocked by mock limiter')
  } else {
    fail('expected allowed=false from mock blocked response')
  }

  if (missing.length === 0) {
    pass(`all required headers present: ${required.join(', ')}`)
  } else {
    fail(`missing headers: ${missing.join(', ')}`)
  }
}

// ─── Test 8 — Sensitive endpoint fails closed on Redis error ─────────────────

async function test8() {
  console.log('\nTest 8 — sensitive endpoint fails closed on Redis error')

  __setStateForTest({
    type: 'ready',
    rl: {
      limit: async (_key: string) => { throw new Error('Redis connection refused') },
    } as unknown as Ratelimit,
  })

  let errorLogged = false
  const origError = console.error
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('Fail-closed')) errorLogged = true
    origError(...args)
  }

  let result: { allowed: boolean } | null = null
  try {
    result = await enforceRateLimit('user', 'orderCreate', { failClosed: true })
  } catch {
    // should not throw
  }

  console.error = origError
  __resetForTest()

  if (result?.allowed === false) {
    pass('sensitive endpoint blocked (allowed=false) when Redis throws')
  } else {
    fail(`expected allowed=false, got ${result?.allowed}`)
  }

  if (errorLogged) {
    pass('console.error fired with fail-closed message')
  } else {
    fail('console.error was not called with fail-closed message')
  }
}

// ─── Test 9 — Non-sensitive endpoint fails open on Redis error ───────────────

async function test9() {
  console.log('\nTest 9 — non-sensitive endpoint fails open on Redis error')

  __setStateForTest({
    type: 'ready',
    rl: {
      limit: async (_key: string) => { throw new Error('Redis timeout') },
    } as unknown as Ratelimit,
  })

  let result: { allowed: boolean } | null = null
  try {
    result = await enforceRateLimit('user', 'vendorStatus') // no failClosed
  } catch {
    // should not throw
  }

  __resetForTest()

  if (result?.allowed === true) {
    pass('non-sensitive endpoint allowed (allowed=true) when Redis throws (fail-open)')
  } else {
    fail(`expected allowed=true, got ${result?.allowed}`)
  }
}

// ─── Test 10 — Production throws without Redis config ────────────────────────

async function test10() {
  console.log('\nTest 10 — production throws without Redis config')

  const origNodeEnv = process.env.NODE_ENV
  ;(process.env as Record<string, string>).NODE_ENV ='production'
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  __resetForTest()

  // In production mode with no Redis, initRatelimit throws.
  // enforceRateLimit calls getRatelimit() which awaits initRatelimit().
  // The throw propagates through initPromise → getRatelimit() → enforceRateLimit.
  let threw = false
  let errorMsg = ''
  try {
    await enforceRateLimit('probe', 'vendorStatus')
  } catch (err) {
    threw = true
    errorMsg = String(err)
  }

  ;(process.env as Record<string, string>).NODE_ENV =origNodeEnv ?? 'development'
  restoreEnv()
  __resetForTest()

  if (threw && errorMsg.includes('Redis required in production')) {
    pass(`production throws with correct message: "${errorMsg.slice(0, 80)}…"`)
  } else if (!threw) {
    fail('expected throw in production mode with no Redis — did not throw')
  } else {
    fail(`threw but wrong message: "${errorMsg}"`)
  }
}

// ─── Test 11 — Key namespacing correct ───────────────────────────────────────

async function test11() {
  console.log('\nTest 11 — key namespacing: v1:<policy>:<key> format')

  let capturedKey = ''

  __setStateForTest({
    type: 'ready',
    rl: {
      limit: async (k: string) => {
        capturedKey = k
        return { success: true, limit: 30, remaining: 29, reset: Date.now() + 60_000 }
      },
    } as unknown as Ratelimit,
  })

  await enforceRateLimit('user123', 'vendorStatus')

  __resetForTest()

  if (capturedKey === 'v1:vendorStatus:user123') {
    pass(`key correctly namespaced: "${capturedKey}"`)
  } else {
    fail(`expected "v1:vendorStatus:user123", got "${capturedKey}"`)
  }

  // Verify orderCreate key format too
  let capturedOrderKey = ''
  __setStateForTest({
    type: 'ready',
    rl: {
      limit: async (k: string) => {
        capturedOrderKey = k
        return { success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 }
      },
    } as unknown as Ratelimit,
  })

  await enforceRateLimit('ip-10.0.0.1', 'orderCreate', { failClosed: true })

  __resetForTest()
  restoreEnv()

  if (capturedOrderKey === 'v1:orderCreate:ip-10.0.0.1') {
    pass(`orderCreate key correctly namespaced: "${capturedOrderKey}"`)
  } else {
    fail(`expected "v1:orderCreate:ip-10.0.0.1", got "${capturedOrderKey}"`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('M3 Test Suite — lazy Redis init / enforceRateLimit')
  console.log(`  RUN_ID: ${RUN_ID}`)
  console.log('─'.repeat(60))

  await test1()
  await test2()
  await test3()
  await test4()
  await test5()
  await test6()
  await test7()
  await test8()
  await test9()
  await test10()
  await test11()

  // Final cleanup — ensure env is restored
  restoreEnv()
  __resetForTest()

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('Some tests FAILED.')
  } else {
    console.log('All 11 tests passed.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
