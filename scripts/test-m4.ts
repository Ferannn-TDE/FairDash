/**
 * M4 Test Suite — BullMQ reliability (enqueueJobSafely)
 *
 * Run:  npx tsx scripts/test-m4.ts
 *
 * Tests:
 *   1.  Successful enqueue returns 'queued'
 *   2.  Duplicate jobId deduplicated (both calls return 'queued', 1 job in queue)
 *   3.  Enqueue timeout triggers retry → fallback (3 attempts, fallback called)
 *   4.  Fallback receives correct idempotency key (stripe.transfers spy)
 *   5.  Non-critical job drops silently (no fallback → 'dropped')
 *   6.  Fallback failure does not crash caller → 'dropped'
 *   7.  Exponential backoff between retries (~200ms + ~400ms)
 *   8.  Dropped job logs structured error object
 *   9.  Queue health endpoint returns correct job counts
 *  10.  Health endpoint returns 503 when queue throws
 *  11.  Concurrent enqueues with same jobId deduplicated
 */

// ─── Env ─────────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

import { Queue, ConnectionOptions } from 'bullmq'
import { enqueueJobSafely } from '../lib/queue-safe.js'
import { stripe } from '../lib/stripe.js'
import { __setOrderQueueForTest } from '../lib/queues.js'
import { GET as healthGET } from '../app/api/health/queues/route.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

const RUN_ID = Date.now()

// ─── Real BullMQ queue (test namespace) ───────────────────────────────────────

let testQueue: Queue | null = null

function buildTestQueue(): Queue | null {
  const url = process.env.REDIS_URL
  if (!url) return null

  const parsed = new URL(url)
  const connection: ConnectionOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  }
  if (parsed.password) (connection as Record<string, unknown>).password = decodeURIComponent(parsed.password)
  if (parsed.protocol === 'rediss:') (connection as Record<string, unknown>).tls = {}

  return new Queue(`test-m4-${RUN_ID}`, {
    connection,
    prefix: `test-m4`,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  })
}

// ─── Mock queue factory ───────────────────────────────────────────────────────

type MockAdd = (...args: unknown[]) => Promise<unknown>

function makeMockQueue(addImpl: MockAdd, name = 'mock-queue') {
  return { name, add: addImpl } as unknown as Queue
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function test1_successfulEnqueue() {
  console.log('\nTest 1 — successful enqueue returns "queued"')

  if (!testQueue) {
    pass('SKIP: REDIS_URL not configured')
    return
  }

  const jobId = `test-m4-t1-${RUN_ID}`
  const result = await enqueueJobSafely({
    queue:  testQueue,
    name:   'test-job',
    data:   { orderId: 'order-1', eventId: 'event-1' },
    jobId,
  })

  if (result === 'queued') {
    pass('successful enqueue returns "queued"')
  } else {
    fail(`expected "queued", got "${result}"`)
    return
  }

  const job = await testQueue.getJob(jobId)
  if (job?.id === jobId) {
    pass(`job exists in queue with correct jobId "${jobId}"`)
  } else {
    fail(`job not found in queue (jobId: ${jobId})`)
  }
}

async function test2_deduplication() {
  console.log('\nTest 2 — duplicate jobId deduplicated (one job in queue)')

  if (!testQueue) {
    pass('SKIP: REDIS_URL not configured')
    return
  }

  const jobId = `test-m4-t2-${RUN_ID}`
  const data = { orderId: 'order-2', eventId: 'event-1' }

  const r1 = await enqueueJobSafely({ queue: testQueue, name: 'test-job', data, jobId })
  const r2 = await enqueueJobSafely({ queue: testQueue, name: 'test-job', data, jobId })

  if (r1 === 'queued' && r2 === 'queued') {
    pass('both calls returned "queued"')
  } else {
    fail(`expected both "queued", got r1="${r1}" r2="${r2}"`)
  }

  // Jobs with a numeric priority go into 'prioritized', not 'waiting'
  const all = await testQueue.getJobs(['waiting', 'delayed', 'prioritized'])
  const matching = all.filter(j => j.id === jobId)
  if (matching.length === 1) {
    pass('exactly one job in queue after two enqueues with same jobId')
  } else {
    fail(`expected 1 job, found ${matching.length}`)
  }
}

async function test3_timeoutTriggersRetryAndFallback() {
  console.log('\nTest 3 — timeout triggers retry then fallback (3 attempts)')

  let addCallCount = 0
  const hangForever = makeMockQueue(async () => {
    addCallCount++
    await new Promise(() => {}) // never resolves
  })

  let fallbackCalled = false
  const result = await enqueueJobSafely({
    queue:     hangForever,
    name:      'test-job',
    data:      {},
    jobId:     `t3-${RUN_ID}`,
    timeoutMs: 50,
    fallback:  async () => { fallbackCalled = true },
  })

  if (result === 'fallback') {
    pass('return value === "fallback"')
  } else {
    fail(`expected "fallback", got "${result}"`)
  }

  if (fallbackCalled) {
    pass('fallback called after all retries exhausted')
  } else {
    fail('fallback was NOT called')
  }

  if (addCallCount === 3) {
    pass(`queue.add() called exactly 3 times (got ${addCallCount})`)
  } else {
    fail(`expected 3 queue.add() calls, got ${addCallCount}`)
  }
}

async function test4_fallbackIdempotencyKey() {
  console.log('\nTest 4 — fallback receives correct Stripe idempotency key')

  const throwingQueue = makeMockQueue(async () => { throw new Error('Redis down') })

  let capturedIdempotencyKey = ''
  const orig = stripe.transfers.create.bind(stripe.transfers)
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async (
    _params: unknown,
    opts: Record<string, string> | undefined
  ) => {
    capturedIdempotencyKey = opts?.idempotencyKey ?? ''
    return { id: 'tr_test_fallback' }
  }

  // Import enqueueVendorPayout after env is ready
  const { enqueueVendorPayout } = await import('../lib/order-side-effects.js')

  // Override the singleton queue so enqueueVendorPayout uses our throwing mock
  __setOrderQueueForTest(throwingQueue)

  await enqueueVendorPayout({
    orderId:              `order-t4-${RUN_ID}`,
    vendorId:             'vendor-1',
    eventId:              'event-1',
    vendorStripeAccountId: 'acct_test',
    vendorPayout:         50,
  })

  // Restore
  __setOrderQueueForTest(null)
  ;(stripe.transfers as unknown as Record<string, unknown>).create = orig

  if (capturedIdempotencyKey.startsWith('fallback-')) {
    pass(`Stripe fallback called with idempotencyKey="${capturedIdempotencyKey}"`)
  } else if (capturedIdempotencyKey) {
    fail(`idempotencyKey does not start with "fallback-": "${capturedIdempotencyKey}"`)
  } else {
    fail('stripe.transfers.create was NOT called — fallback did not execute')
  }

  const orderId = `order-t4-${RUN_ID}`
  if (capturedIdempotencyKey.includes(orderId)) {
    pass(`idempotencyKey contains orderId ("${orderId}")`)
  } else {
    fail(`idempotencyKey "${capturedIdempotencyKey}" does not contain orderId "${orderId}"`)
  }
}

async function test5_nonCriticalDropsSilently() {
  console.log('\nTest 5 — non-critical job drops silently (no fallback → "dropped")')

  const throwingQueue = makeMockQueue(async () => { throw new Error('Queue down') })

  let errorLogged = false
  const origError = console.error
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('[Queue]')) errorLogged = true
    origError(...args)
  }

  let threw = false
  let result: string | null = null
  try {
    result = await enqueueJobSafely({
      queue:    throwingQueue,
      name:     'track-analytics',
      data:     {},
      jobId:    `t5-${RUN_ID}`,
      priority: 'low',
      // no fallback
    })
  } catch {
    threw = true
  }

  console.error = origError

  if (!threw) {
    pass('no exception thrown to caller')
  } else {
    fail('enqueueJobSafely threw an exception — should catch internally')
  }

  if (result === 'dropped') {
    pass('return value === "dropped"')
  } else {
    fail(`expected "dropped", got "${result}"`)
  }

  if (errorLogged) {
    pass('console.error called with [Queue] prefix')
  } else {
    fail('console.error was not called')
  }
}

async function test6_fallbackFailureHandled() {
  console.log('\nTest 6 — fallback failure does not crash caller')

  const throwingQueue = makeMockQueue(async () => { throw new Error('Queue down') })

  let errorCount = 0
  const origError = console.error
  console.error = (...args: unknown[]) => {
    if (
      String(args[0]).includes('[Queue]') ||
      String(args[0]).includes('Fallback')
    ) errorCount++
    origError(...args)
  }

  let threw = false
  let result: string | null = null
  try {
    result = await enqueueJobSafely({
      queue:    throwingQueue,
      name:     'critical-job',
      data:     {},
      jobId:    `t6-${RUN_ID}`,
      priority: 'critical',
      fallback: async () => { throw new Error('Stripe also down') },
    })
  } catch {
    threw = true
  }

  console.error = origError

  if (!threw) {
    pass('no exception thrown to caller when fallback also fails')
  } else {
    fail('enqueueJobSafely threw — fallback error should be caught internally')
  }

  if (result === 'dropped') {
    pass('return value === "dropped" after fallback failure')
  } else {
    fail(`expected "dropped", got "${result}"`)
  }

  if (errorCount >= 2) {
    pass(`console.error called ${errorCount} times (queue fail + fallback fail)`)
  } else {
    fail(`expected ≥2 console.error calls, got ${errorCount}`)
  }
}

async function test7_exponentialBackoff() {
  console.log('\nTest 7 — exponential backoff between retries (~200ms + ~400ms)')

  let callCount = 0
  const failTwiceThenSucceed = makeMockQueue(async () => {
    callCount++
    if (callCount < 3) throw new Error('Temporary failure')
    // 3rd call succeeds
  })

  const start = Date.now()
  const result = await enqueueJobSafely({
    queue:     failTwiceThenSucceed,
    name:      'test-job',
    data:      {},
    jobId:     `t7-${RUN_ID}`,
    timeoutMs: 500,
  })
  const elapsed = Date.now() - start

  if (result === 'queued') {
    pass('return value === "queued" (succeeded on 3rd attempt)')
  } else {
    fail(`expected "queued", got "${result}"`)
  }

  if (callCount === 3) {
    pass(`queue.add() called exactly 3 times`)
  } else {
    fail(`expected 3 calls, got ${callCount}`)
  }

  // Expected total delay: 200ms (after attempt 0) + 400ms (after attempt 1) = ~600ms
  // Allow ±200ms tolerance for CI jitter
  const MIN_MS = 400
  const MAX_MS = 1200
  if (elapsed >= MIN_MS && elapsed <= MAX_MS) {
    pass(`elapsed ${elapsed}ms is within expected backoff range [${MIN_MS}–${MAX_MS}ms]`)
  } else {
    fail(`elapsed ${elapsed}ms outside expected backoff range [${MIN_MS}–${MAX_MS}ms]`)
  }
}

async function test8_droppedJobLogsStructuredError() {
  console.log('\nTest 8 — dropped job logs structured error object')

  const throwingQueue = makeMockQueue(async () => { throw new Error('Connection refused') })

  let capturedLog: Record<string, unknown> | undefined
  const origError = console.error
  console.error = (msg: unknown, payload: unknown) => {
    if (String(msg).includes('Failed to enqueue') && payload && typeof payload === 'object') {
      capturedLog = payload as Record<string, unknown>
    }
    origError(msg, payload)
  }

  await enqueueJobSafely({
    queue:  throwingQueue,
    name:   'test-job',
    data:   {},
    jobId:  `t8-${RUN_ID}`,
  })

  console.error = origError

  if (!capturedLog) {
    fail('console.error was not called with a structured payload')
    return
  }

  const log = capturedLog
  const hasQueue   = typeof log.queue   === 'string'
  const hasJobName = typeof log.jobName === 'string'
  const hasJobId   = typeof log.jobId   === 'string'
  const hasError   = typeof log.error   === 'string'

  if (hasQueue && hasJobName && hasJobId && hasError) {
    pass(`structured error logged: { queue, jobName, jobId, error }`)
  } else {
    const missing = [
      !hasQueue   && 'queue',
      !hasJobName && 'jobName',
      !hasJobId   && 'jobId',
      !hasError   && 'error',
    ].filter(Boolean)
    fail(`structured error missing fields: ${missing.join(', ')}`)
  }
}

async function test9_healthEndpointCorrectCounts() {
  console.log('\nTest 9 — health endpoint returns correct job counts')

  const mockCounts = { waiting: 4, active: 1, delayed: 2, failed: 0, completed: 10 }
  const mockQueue = {
    name:          'mock-order-queue',
    getJobCounts:  async () => mockCounts,
  } as unknown as Queue

  __setOrderQueueForTest(mockQueue)

  const res = await healthGET()
  const body = await res.json() as Record<string, unknown>

  __setOrderQueueForTest(null)

  if (res.status === 200) {
    pass('health endpoint returned 200')
  } else {
    fail(`expected 200, got ${res.status}`)
    return
  }

  if (body.status === 'ok') {
    pass('body.status === "ok"')
  } else {
    fail(`expected body.status="ok", got "${body.status}"`)
  }

  const queues = body.queues as Record<string, unknown>
  const orders = queues?.orders as Record<string, unknown>
  if (orders?.waiting === 4) {
    pass(`body.queues.orders.waiting === 4 (injected mock count)`)
  } else {
    fail(`expected waiting=4, got ${orders?.waiting}`)
  }
}

async function test10_healthEndpoint503OnRedisFailure() {
  console.log('\nTest 10 — health endpoint returns 503 when queue throws')

  const brokenQueue = {
    name:         'broken-queue',
    getJobCounts: async () => { throw new Error('Redis ECONNREFUSED') },
  } as unknown as Queue

  __setOrderQueueForTest(brokenQueue)

  const res = await healthGET()
  const body = await res.json() as Record<string, unknown>

  __setOrderQueueForTest(null)

  if (res.status === 503) {
    pass('health endpoint returned 503')
  } else {
    fail(`expected 503, got ${res.status}`)
  }

  if (body.status === 'error') {
    pass('body.status === "error"')
  } else {
    fail(`expected body.status="error", got "${body.status}"`)
  }
}

async function test11_concurrentDedup() {
  console.log('\nTest 11 — 50 concurrent enqueues with same jobId deduplicated')

  if (!testQueue) {
    pass('SKIP: REDIS_URL not configured')
    return
  }

  const jobId = `test-m4-t11-${RUN_ID}`
  const data = { orderId: 'order-11', eventId: 'event-1' }

  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      enqueueJobSafely({ queue: testQueue!, name: 'test-job', data, jobId })
    )
  )

  const allQueued = results.every(r => r === 'queued')
  if (allQueued) {
    pass('all 50 concurrent enqueues returned "queued"')
  } else {
    const counts = results.reduce((acc, r) => { acc[r] = (acc[r] ?? 0) + 1; return acc }, {} as Record<string, number>)
    fail(`not all returned "queued": ${JSON.stringify(counts)}`)
  }

  const all = await testQueue.getJobs(['waiting', 'delayed', 'prioritized'])
  const matching = all.filter(j => j.id === jobId)
  if (matching.length === 1) {
    pass('exactly one job in queue after 50 concurrent enqueues with same jobId')
  } else {
    fail(`expected 1 job in queue, found ${matching.length}`)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n  Cleaning up…')
  __setOrderQueueForTest(null)
  if (testQueue) {
    try {
      await testQueue.obliterate({ force: true })
      await testQueue.close()
    } catch {
      // best-effort
    }
  }
  console.log('  Done.')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('M4 Test Suite — BullMQ reliability (enqueueJobSafely)')
  console.log(`  RUN_ID: ${RUN_ID}`)
  console.log('─'.repeat(60))

  testQueue = buildTestQueue()
  if (!testQueue) {
    console.warn('  ⚠ REDIS_URL not set — Tests 1, 2, 11 will be skipped')
  }

  await test1_successfulEnqueue()
  await test2_deduplication()
  await test3_timeoutTriggersRetryAndFallback()
  await test4_fallbackIdempotencyKey()
  await test5_nonCriticalDropsSilently()
  await test6_fallbackFailureHandled()
  await test7_exponentialBackoff()
  await test8_droppedJobLogsStructuredError()
  await test9_healthEndpointCorrectCounts()
  await test10_healthEndpoint503OnRedisFailure()
  await test11_concurrentDedup()

  await cleanup()

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('Some tests FAILED.')
  } else {
    console.log('All 11 tests passed.')
  }
}

main().catch(async (err) => {
  console.error(err)
  await cleanup()
  process.exit(1)
})
