/**
 * C3 Test Suite — Firebase fire-and-forget helper
 *
 * Run:  npx tsx scripts/test-c3.ts
 *
 * Tests fireAndForgetFirebaseUpdate() directly — the core of the C3 fix.
 * after() in route handlers is Next.js infra; the observable contract being
 * tested here is: the function returns synchronously, the write happens
 * asynchronously, timeouts and errors never propagate to the caller.
 *
 * Tests:
 *   1. Response not blocked — function returns in < 50ms even when write takes 2s
 *   2. Write still fires  — spy is called after function returns
 *   3. Timeout handled    — console.error logged after 5s; process not crashed
 *   4. Error handled      — Firebase failure → 200, console.error logged
 *   5. FIREBASE_ENABLED=false skips write silently
 *   6. Structured error log includes orderId and path
 */

// ─── Env setup ────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.FIREBASE_ENABLED = 'true'

import {
  fireAndForgetFirebaseUpdate,
  __setRtdbForTest,
} from '../lib/firebase-sync.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

const TEST_PATH    = 'fairs/test-event/orders/vendor-a/order-123'
const TEST_PAYLOAD = { status: 'ACCEPTED', updatedAt: Date.now() }
const TEST_CONTEXT = { orderId: 'order-123' }

// Build a mock RTDB whose ref().update() behaviour can be controlled per-test
function makeDb(updateImpl: () => Promise<unknown>) {
  return {
    ref: (_path: string) => ({
      update: (_data: object) => updateImpl(),
      set:    (_data: object) => updateImpl(),
    }),
  }
}

// ─── Test 1 — Response not blocked by slow Firebase write ─────────────────────

async function test1() {
  console.log('\nTest 1 — function returns before 2-second Firebase write completes')

  __setRtdbForTest(makeDb(() => sleep(2000)))

  const t0 = Date.now()
  fireAndForgetFirebaseUpdate(TEST_PATH, TEST_PAYLOAD, TEST_CONTEXT)
  const elapsed = Date.now() - t0

  if (elapsed < 50) {
    pass(`returned in ${elapsed}ms (< 50ms) — response not blocked`)
  } else {
    fail(`took ${elapsed}ms — function appears to be awaiting the Firebase write`)
  }

  // Let the background write finish before the next test
  await sleep(2200)
  __setRtdbForTest(null)
}

// ─── Test 2 — Firebase write still fires after function returns ───────────────

async function test2() {
  console.log('\nTest 2 — write spy is called after function returns')

  let callCount = 0
  // Async mock with a real async gap so the write happens after the current
  // microtask queue drains (proves the write fires independently of the caller)
  __setRtdbForTest(makeDb(() => sleep(10).then(() => { callCount++ })))

  fireAndForgetFirebaseUpdate(TEST_PATH, TEST_PAYLOAD, TEST_CONTEXT)

  // Immediately after — write has not resolved yet (async gap via sleep)
  const countBeforeWait = callCount

  await sleep(200)

  if (callCount === 1) {
    pass(`spy called exactly once after function returned (callCount after 200ms = ${callCount})`)
  } else {
    fail(`expected spy called once, got ${callCount} (at call-time: ${countBeforeWait})`)
  }

  __setRtdbForTest(null)
}

// ─── Test 3 — Firebase timeout doesn't crash the process ─────────────────────

async function test3() {
  const TIMEOUT_MS = 5000
  const WAIT_MS    = TIMEOUT_MS + 1200
  console.log(`\nTest 3 — hanging write triggers ${TIMEOUT_MS}ms timeout, no crash (waiting ${WAIT_MS / 1000}s)`)

  // Never-resolving promise simulates a hung Firebase connection
  __setRtdbForTest(makeDb(() => new Promise(() => {})))

  const errorArgs: unknown[][] = []
  const origError = console.error
  console.error = (...args: unknown[]) => { errorArgs.push(args); origError(...args) }

  const t0 = Date.now()
  fireAndForgetFirebaseUpdate(TEST_PATH, TEST_PAYLOAD, TEST_CONTEXT)
  const elapsed = Date.now() - t0

  if (elapsed < 100) {
    pass(`returned in ${elapsed}ms — not blocked by hanging write`)
  } else {
    fail(`took ${elapsed}ms — function blocked on hung Firebase write`)
  }

  await sleep(WAIT_MS)
  console.error = origError

  const logged = errorArgs.some(
    a => typeof a[0] === 'string' && a[0].includes('[Firebase write failed]')
  )
  if (logged) {
    pass('console.error called with "[Firebase write failed]" after timeout')
  } else {
    fail('expected console.error with "[Firebase write failed]" — not found')
  }

  pass('process did not crash (test is still running)')
  __setRtdbForTest(null)
}

// ─── Test 4 — Firebase error doesn't affect function return ──────────────────

async function test4() {
  console.log('\nTest 4 — Firebase error does not propagate to caller')

  __setRtdbForTest(makeDb(async () => { throw new Error('Firebase down') }))

  const errorArgs: unknown[][] = []
  const origError = console.error
  console.error = (...args: unknown[]) => { errorArgs.push(args); origError(...args) }

  let threw = false
  try {
    fireAndForgetFirebaseUpdate(TEST_PATH, TEST_PAYLOAD, TEST_CONTEXT)
  } catch {
    threw = true
  }

  if (!threw) {
    pass('function did not throw synchronously on Firebase error')
  } else {
    fail('function threw synchronously — error escaped the fire-and-forget wrapper')
  }

  await sleep(200)
  console.error = origError

  const logged = errorArgs.some(a => typeof a[0] === 'string' && a[0].includes('[Firebase write failed]'))
  if (logged) {
    pass('Firebase error was caught and logged via console.error')
  } else {
    fail('expected console.error after Firebase rejection — not found')
  }

  __setRtdbForTest(null)
}

// ─── Test 5 — FIREBASE_ENABLED=false skips write silently ────────────────────

async function test5() {
  console.log('\nTest 5 — FIREBASE_ENABLED=false skips Firebase write silently')

  let callCount = 0
  __setRtdbForTest(makeDb(async () => { callCount++ }))

  const prev = process.env.FIREBASE_ENABLED
  process.env.FIREBASE_ENABLED = 'false'

  let threw = false
  try {
    fireAndForgetFirebaseUpdate(TEST_PATH, TEST_PAYLOAD, TEST_CONTEXT)
  } catch {
    threw = true
  }

  await sleep(200)
  process.env.FIREBASE_ENABLED = prev

  if (callCount === 0) {
    pass('spy not called — Firebase write skipped when FIREBASE_ENABLED=false')
  } else {
    fail(`spy was called ${callCount} time(s) — expected 0 when disabled`)
  }

  if (!threw) {
    pass('no error thrown when Firebase disabled')
  } else {
    fail('function threw when FIREBASE_ENABLED=false — should exit silently')
  }

  __setRtdbForTest(null)
}

// ─── Test 6 — Structured error log includes orderId and path ─────────────────

async function test6() {
  console.log('\nTest 6 — console.error logs structured object with orderId and path')

  const KNOWN_ORDER = 'order-abc-999'
  const KNOWN_PATH  = `fairs/event-x/orders/vendor-y/${KNOWN_ORDER}`

  __setRtdbForTest(makeDb(async () => { throw new Error('Firebase down') }))

  const logged: unknown[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => logged.push(...args)

  fireAndForgetFirebaseUpdate(KNOWN_PATH, TEST_PAYLOAD, { orderId: KNOWN_ORDER })

  await sleep(200)
  console.error = origError

  // Find the structured payload (second argument to console.error)
  const structuredArg = logged.find(
    a => a !== null && typeof a === 'object' &&
         'orderId' in (a as object) && 'path' in (a as object) && 'error' in (a as object)
  ) as Record<string, unknown> | undefined

  if (!structuredArg) {
    // Replay captured logs so the developer can see what was actually logged
    origError('[Test 6 captured logs]', ...logged)
    fail('console.error was not called with a structured object containing orderId, path, error')
    __setRtdbForTest(null)
    return
  }

  if (structuredArg.orderId === KNOWN_ORDER) {
    pass(`log.orderId === "${KNOWN_ORDER}"`)
  } else {
    fail(`expected log.orderId "${KNOWN_ORDER}", got "${structuredArg.orderId}"`)
  }

  if (typeof structuredArg.path === 'string' && structuredArg.path === KNOWN_PATH) {
    pass(`log.path === "${KNOWN_PATH}"`)
  } else {
    fail(`expected log.path "${KNOWN_PATH}", got "${structuredArg.path}"`)
  }

  if (typeof structuredArg.error === 'string' && structuredArg.error.length > 0) {
    pass(`log.error is a string: "${structuredArg.error}"`)
  } else {
    fail(`expected log.error to be a non-empty string, got: ${JSON.stringify(structuredArg.error)}`)
  }

  __setRtdbForTest(null)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nC3 Test Suite — Firebase fire-and-forget helper')
  console.log('─'.repeat(60))

  await test1()
  await test2()
  await test3()
  await test4()
  await test5()
  await test6()

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('One or more tests FAILED.')
  } else {
    console.log('All 6 tests passed.')
  }
  process.exit(process.exitCode ?? 0)
}

main()
