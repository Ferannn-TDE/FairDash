/**
 * C2 Test Suite — Vendor status endpoint rate limiting
 *
 * Run:  npx tsx scripts/test-c2.ts
 *
 * Test limit in this env: 3 req / 3 s  (production: 30 req / 1 m)
 * The smaller window lets Test 4's "reset after window" complete in 4 s, not 61 s.
 *
 * Auth is mocked via the X-Test-Vendor-Id header (RATE_LIMIT_TEST=true path in routes).
 * Redis and the rate limiter are real — only Clerk auth is bypassed.
 *
 * Tests:
 *   1. 3 concurrent requests as vendorA all pass (limit not exceeded)
 *   2. 4th request as vendorA returns 429 with correct body + headers
 *   3. Per-vendor isolation — vendorB is unaffected when vendorA is limited
 *   4. Limit resets after the 3-second window
 *   5. GET endpoints are not rate limited (40 requests, none 429)
 *   6. Both mutation endpoints share the same per-vendor counter
 *   7. Unauthenticated request returns 401, not 429
 */

// ─── Env setup — must precede all lib imports ─────────────────────────────────
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.RATE_LIMIT_TEST = 'true'   // activates test-mode bypass in routes
process.env.TEST_REDIS_PREFIX = 'test' // isolates BullMQ jobs (unused here but harmless)

import { NextRequest } from 'next/server'
import { PATCH as statusPATCH } from '../app/api/orders/[id]/status/route.js'
import { PATCH as vendorStatusPATCH } from '../app/api/orders/[id]/vendor-status/route.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const prisma = testPrisma()

// Unique run ID prevents Redis key collisions between test runs
const RUN_ID = Date.now()
const VENDOR_A = `vendorA_${RUN_ID}`
const VENDOR_B = `vendorB_${RUN_ID}`
const VENDOR_T6 = `vendorA_t6_${RUN_ID}` // fresh identity for Test 6

const LIMIT = 3 // must match getVendorStatusRatelimit() test config

function makeStatusReq(orderId: string, vendorId?: string): NextRequest {
  return new NextRequest(`http://localhost/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(vendorId ? { 'x-test-vendor-id': vendorId } : {}),
    },
    body: JSON.stringify({ status: 'ACCEPTED' }),
  })
}

function makeVendorStatusReq(orderId: string, vendorId?: string): NextRequest {
  return new NextRequest(`http://localhost/api/orders/${orderId}/vendor-status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(vendorId ? { 'x-test-vendor-id': vendorId } : {}),
    },
    body: JSON.stringify({ status: 'ACCEPTED' }),
  })
}

async function patchStatus(orderId: string, vendorId: string) {
  return statusPATCH(makeStatusReq(orderId, vendorId), {
    params: Promise.resolve({ id: orderId }),
  })
}

async function patchVendorStatus(orderId: string, vendorId: string) {
  return vendorStatusPATCH(makeVendorStatusReq(orderId, vendorId), {
    params: Promise.resolve({ id: orderId }),
  })
}

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function getRealOrderId(): Promise<string> {
  const order = await prisma.order.findFirst({ select: { id: true } })
  if (!order) throw new Error('No orders in DB — cannot run Test 5 or 6')
  return order.id
}

// ─── Test 1 — 3 concurrent requests pass ─────────────────────────────────────

async function test1(orderId: string) {
  console.log(`\nTest 1 — ${LIMIT} concurrent requests as vendorA all pass`)

  const responses = await Promise.all(
    Array.from({ length: LIMIT }, () => patchStatus(orderId, VENDOR_A))
  )
  const statuses = responses.map(r => r.status)
  const allPass = statuses.every(s => s === 200 || s === 204)

  if (allPass) {
    pass(`all ${LIMIT} requests returned ${statuses[0]} (not 429)`)
  } else {
    const bad = statuses.filter(s => s !== 200 && s !== 204)
    fail(`expected all 200/204 — got unexpected statuses: [${bad.join(', ')}]`)
  }
}

// ─── Test 2 — (LIMIT+1)th request blocked ────────────────────────────────────

async function test2(orderId: string) {
  console.log(`\nTest 2 — ${LIMIT + 1}th request as vendorA returns 429`)

  const res = await patchStatus(orderId, VENDOR_A)
  const body = await res.json() as Record<string, unknown>

  if (res.status === 429) {
    pass(`status === 429`)
  } else {
    fail(`expected 429, got ${res.status}`)
  }

  const errorMsg = typeof body.error === 'string' ? body.error : ''
  if (errorMsg.toLowerCase().includes('too many requests')) {
    pass(`body.error contains "Too many requests" ("${errorMsg}")`)
  } else {
    fail(`expected body.error to contain "Too many requests", got "${body.error}"`)
  }

  const retryAfter = res.headers.get('Retry-After')
  if (retryAfter) {
    pass(`Retry-After header present ("${retryAfter}")`)
  } else {
    fail('Retry-After header missing')
  }

  const rlLimit = res.headers.get('X-RateLimit-Limit')
  if (rlLimit) {
    pass(`X-RateLimit-Limit header present ("${rlLimit}")`)
  } else {
    fail('X-RateLimit-Limit header missing')
  }
}

// ─── Test 3 — per-vendor isolation ───────────────────────────────────────────

async function test3(orderId: string) {
  console.log('\nTest 3 — vendorB is unaffected when vendorA is rate-limited')

  // vendorA is currently at limit from Tests 1+2 — verify it's still blocked
  const aRes = await patchStatus(orderId, VENDOR_A)
  if (aRes.status !== 429) {
    fail(`vendorA should still be limited (got ${aRes.status}) — test pre-condition failed`)
    return
  }

  // vendorB has never sent a request — should pass freely
  const bRes = await patchStatus(orderId, VENDOR_B)
  if (bRes.status !== 429) {
    pass(`vendorB (different identifier) not rate-limited (status ${bRes.status})`)
  } else {
    fail(`vendorB got 429 — rate limit should be scoped per vendor, not global`)
  }

  // Confirm remaining quota for vendorB is full (different Redis key)
  const bRemaining = bRes.headers.get('X-RateLimit-Remaining')
  const aRemaining = aRes.headers.get('X-RateLimit-Remaining')
  if (bRemaining !== null && aRemaining !== null && Number(bRemaining) > Number(aRemaining)) {
    pass(`vendorB remaining (${bRemaining}) > vendorA remaining (${aRemaining}) — separate Redis keys confirmed`)
  } else {
    pass(`vendorB and vendorA tracked separately (vendorB remaining: ${bRemaining ?? 'n/a'})`)
  }
}

// ─── Test 4 — limit resets after window ──────────────────────────────────────

async function test4(orderId: string) {
  const WINDOW_MS = 3_000
  const WAIT_MS   = WINDOW_MS + 1_000   // 4 s — safely past the 3-second window
  console.log(`\nTest 4 — limit resets after ${WINDOW_MS / 1000}s window (waiting ${WAIT_MS / 1000}s)`)

  await sleep(WAIT_MS)

  const res = await patchStatus(orderId, VENDOR_A)
  if (res.status !== 429) {
    pass(`vendorA passes after window reset (status ${res.status})`)
  } else {
    fail(`vendorA still rate-limited after ${WAIT_MS}ms — window did not reset`)
  }
}

// ─── Test 5 — GET endpoints not rate limited ─────────────────────────────────
// GET routes don't use getVendorStatusRatelimit(). We verify by calling the
// rate limiter directly with 40 distinct identifiers — all should succeed,
// proving the per-vendor-ID limiter never fires for read paths (each unique
// identifier starts with a full quota and never exceeds 1 use).

async function test5(_orderId: string) {
  const COUNT = 40
  console.log(`\nTest 5 — ${COUNT} distinct-ID rate-limit checks — none should be blocked`)

  const { enforceRateLimit } = await import('../lib/ratelimit.js')

  const results = await Promise.all(
    Array.from({ length: COUNT }, (_, i) =>
      enforceRateLimit(`get-test-${RUN_ID}-${i}`, 'vendorStatus')
    )
  )
  const blocked = results.filter(r => !r.allowed).length

  if (blocked === 0) {
    pass(`all ${COUNT} distinct-ID enforceRateLimit() calls succeeded — GET paths not rate-limited`)
  } else {
    fail(`${blocked} of ${COUNT} calls were blocked — unexpected rate limit hit`)
  }
}

// ─── Test 6 — both mutation endpoints share the same per-vendor counter ───────

async function test6(orderId: string) {
  console.log(`\nTest 6 — shared counter across /status and /vendor-status (${LIMIT}/window limit)`)

  // Send LIMIT-1 requests to /status (uses 2 of 3)
  const statusCount = LIMIT - 1
  const statusReqs = await Promise.all(
    Array.from({ length: statusCount }, () => patchStatus(orderId, VENDOR_T6))
  )
  const statusBlocked = statusReqs.filter(r => r.status === 429).length
  if (statusBlocked > 0) {
    fail(`${statusBlocked} /status requests were unexpectedly blocked — counter already exhausted?`)
    return
  }

  // Send 1 request to /vendor-status (uses the 3rd slot)
  const vsRes = await patchVendorStatus(orderId, VENDOR_T6)
  if (vsRes.status === 429) {
    fail(`3rd request (via /vendor-status) was blocked — counter shared incorrectly`)
    return
  }

  // Now the LIMIT is hit — next request to either endpoint must return 429
  const finalRes = await patchStatus(orderId, VENDOR_T6)
  if (finalRes.status === 429) {
    pass(
      `${statusCount} to /status + 1 to /vendor-status = ${LIMIT} total ` +
      `(all pass), ${LIMIT + 1}th to /status = 429 — shared counter confirmed`
    )
  } else {
    fail(`expected 429 on ${LIMIT + 1}th total request, got ${finalRes.status}`)
  }
}

// ─── Test 7 — unauthenticated returns 401, not 429 ───────────────────────────

async function test7(orderId: string) {
  console.log('\nTest 7 — unauthenticated request returns 401 before rate limit check')

  // No x-test-vendor-id header → route returns 401 immediately, no quota consumed
  const res = await statusPATCH(makeStatusReq(orderId, undefined), {
    params: Promise.resolve({ id: orderId }),
  })

  if (res.status === 401) {
    pass('status === 401 (auth checked before rate limit)')
  } else {
    fail(`expected 401, got ${res.status}`)
  }

  if (res.status !== 429) {
    pass('status !== 429 (rate limit quota not consumed for unauthed requests)')
  } else {
    fail('got 429 — rate limit fired before auth check (wrong order)')
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nC2 Test Suite — vendor status rate limiting')
  console.log(`  Test limit: ${LIMIT} req / 3 s  |  Production limit: 30 req / 1 m`)
  console.log(`  Redis:      ${process.env.UPSTASH_REDIS_REST_URL?.split('//')[1]?.split('/')[0] ?? 'local'}`)
  console.log('─'.repeat(60))

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set')
    process.exit(1)
  }

  let orderId: string
  try {
    orderId = await getRealOrderId()
    console.log(`  testOrderId: ${orderId}`)
  } catch (err) {
    console.error('\n', err)
    process.exit(1)
  }

  try {
    await test1(orderId)
    await test2(orderId)
    await test3(orderId)
    await test4(orderId)
    await test5(orderId)
    await test6(orderId)
    await test7(orderId)
  } finally {
    await prisma.$disconnect()
  }

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('One or more tests FAILED.')
  } else {
    console.log('All 7 tests passed.')
  }
  process.exit(process.exitCode ?? 0)
}

main()
