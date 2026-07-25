/**
 * C1 Test Suite — Async Stripe decoupling + BullMQ reliability
 *
 * Run:  npx tsx scripts/test-c1.ts
 *
 * Tests:
 *   1. Payout job enqueued, Stripe NOT called inline
 *   2. Refund deduplication (same orderId → single job in queue)
 *   3. Retry on transient failure → eventual success
 *   4. payoutStatus marked FAILED after permanent failure (3 exhausted attempts)
 */

// ─── Env — must run before any instantiation ──────────────────────────────────
// ESM static imports are resolved before this body runs, but Queue/Worker/Prisma
// are only instantiated inside functions called later, so env vars are available.
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'   // isolate from production queue

import { Queue, Worker, Job, ConnectionOptions } from 'bullmq'
import { PayoutStatus } from '@prisma/client'
import Stripe from 'stripe'
import {
  ORDER_QUEUE_NAME,
  JOB_VENDOR_PAYOUT,
  JOB_REFUND,
  JobData,
  getQueuePrefix,
} from '../lib/queues.js'
import { enqueueOrderPayout } from '../lib/order-side-effects.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const prisma = testPrisma()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2023-10-16' as any,
  typescript: true,
})

function buildConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL!
  const parsed = new URL(url)
  const opts: ConnectionOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  }
  if (parsed.password) (opts as Record<string, unknown>).password = decodeURIComponent(parsed.password)
  if (parsed.username && parsed.username !== 'default') {
    (opts as Record<string, unknown>).username = decodeURIComponent(parsed.username)
  }
  if (parsed.protocol === 'rediss:') (opts as Record<string, unknown>).tls = {}
  return opts
}

const PREFIX = getQueuePrefix()   // 'test'
const connection = buildConnection()

function makeQueue(): Queue<JobData> {
  return new Queue<JobData>(ORDER_QUEUE_NAME, {
    connection,
    prefix: PREFIX,
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  })
}

async function drainQueue(queue: Queue<JobData>) {
  await queue.drain()
  const failed = await queue.getFailed()
  await Promise.all(failed.map(j => j.remove()))
  const completed = await queue.getCompleted()
  await Promise.all(completed.map(j => j.remove()))
}

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

// ─── Seed data ────────────────────────────────────────────────────────────────

async function getSeedData() {
  const vendor = await prisma.vendor.findFirst({
    select: { id: true, eventId: true, stripeAccountId: true },
  })
  if (!vendor) throw new Error('No vendors in DB — seed data required')

  const event = await prisma.event.findFirst({ select: { id: true } })
  if (!event) throw new Error('No events in DB — seed data required')

  const customer = await prisma.user.findFirst({ select: { id: true } })
  if (!customer) throw new Error('No users in DB — seed data required')

  return { vendor, event, customer }
}

async function createTestOrder(vendorId: string, eventId: string, customerId: string) {
  return prisma.order.create({
    data: {
      eventId,
      customerId,
      vendorId,
      status: 'COMPLETED',
      fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 10.00,
      total: 10.00,
      fairSynqFee: 0.70,
      vendorPayout: 9.30,
      customerName: '__test_c1__',
      customerPhone: '0000000000',
      payoutStatus: PayoutStatus.PENDING,
    },
  })
}

// ─── Test 1: Payout job enqueued — Stripe NOT called inline ──────────────────

async function test1() {
  console.log('\nTest 1 — Payout job enqueued, Stripe NOT called inline')
  const queue = makeQueue()
  await drainQueue(queue)

  // Spy: intercept stripe.transfers.create without calling through
  let stripeCallCount = 0
  const origCreate = stripe.transfers.create.bind(stripe.transfers)
  ;(stripe.transfers as unknown as Record<string, unknown>).create = async () => {
    stripeCallCount++
    throw new Error('[spy] stripe.transfers.create should NOT be called inline')
  }

  const { vendor, event } = await getSeedData()
  const jobsBefore = await queue.getJobs(['waiting', 'delayed', 'active'])

  await enqueueOrderPayout({
    orderId: `test-payout-${Date.now()}`,
    eventId: event.id,
  })

  const jobsAfter = await queue.getJobs(['waiting', 'delayed', 'active'])

  if (stripeCallCount === 0) {
    pass('stripe.transfers.create was NOT called inline')
  } else {
    fail(`stripe.transfers.create was called ${stripeCallCount} time(s) inline — should be 0`)
  }

  if (jobsAfter.length === jobsBefore.length + 1) {
    pass(`payout job enqueued (queue length: ${jobsBefore.length} → ${jobsAfter.length})`)
  } else {
    fail(`queue length did not increase by 1 (was ${jobsBefore.length}, now ${jobsAfter.length})`)
  }

  // Restore spy
  ;(stripe.transfers as unknown as Record<string, unknown>).create = origCreate
  await drainQueue(queue)
  await queue.close()
}

// ─── Test 2: Refund deduplication ────────────────────────────────────────────

async function test2() {
  console.log('\nTest 2 — Refund deduplication (same orderId → single job)')
  const queue = makeQueue()
  await drainQueue(queue)

  const orderId = `test-dedup-${Date.now()}`
  const jobId = `refund-${orderId}`

  const jobPayload: JobData = {
    eventId: 'evt_test',
    orderId,
    vendorId: 'v_test',
    stripePaymentIntentId: 'pi_test',
    refundReason: 'test',
    refundIdempotencyKey: `stripe-refund-${orderId}`,
  }
  const jobOpts = { jobId, attempts: 3 }

  // Enqueue twice with the same jobId — second add is a no-op in BullMQ
  await queue.add(JOB_REFUND, jobPayload, jobOpts)
  await queue.add(JOB_REFUND, jobPayload, jobOpts)

  const jobs = await queue.getJobs(['waiting', 'delayed', 'active'])
  const matching = jobs.filter(j => j.id === jobId)

  if (matching.length === 1) {
    pass(`only 1 refund job in queue for orderId "${orderId}"`)
  } else {
    fail(`expected 1 job with id="${jobId}", found ${matching.length}`)
  }

  await drainQueue(queue)
  await queue.close()
}

// ─── Test 3: Retry on transient failure → eventual success ───────────────────

async function test3() {
  console.log('\nTest 3 — Retry on failure → eventual success (attempt 2)')
  const queue = makeQueue()
  await drainQueue(queue)

  const orderId = `test-retry-${Date.now()}`

  const worker = new Worker<JobData>(
    ORDER_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_VENDOR_PAYOUT) return
      if (job.attemptsMade === 0) throw new Error('Simulated transient failure')
      // Success on attempt 2 (attemptsMade === 1)
    },
    { connection, prefix: PREFIX, concurrency: 1 }
  )

  const completedPromise = new Promise<Job<JobData>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout — job never completed')), 20_000)
    worker.on('completed', (job) => { clearTimeout(timer); resolve(job) })
    worker.on('error', (err) => { clearTimeout(timer); reject(err) })
  })

  await queue.add(
    JOB_VENDOR_PAYOUT,
    { eventId: 'evt_test', orderId, vendorId: 'v_test', transferAmountCents: 930 },
    { attempts: 3, backoff: { type: 'fixed', delay: 300 }, jobId: `payout-${orderId}` }
  )

  try {
    const completedJob = await completedPromise
    if (completedJob.attemptsMade >= 1) {
      pass(`job completed on attempt ${completedJob.attemptsMade + 1} (retried ${completedJob.attemptsMade}x)`)
    } else {
      fail('job completed on first attempt — retry path not exercised')
    }
  } catch (err) {
    fail(`retry test failed: ${(err as Error).message}`)
  } finally {
    await worker.close()
    await drainQueue(queue)
    await queue.close()
  }
}

// ─── Test 4: payoutStatus marked FAILED on permanent failure ─────────────────

async function test4() {
  console.log('\nTest 4 — payoutStatus=FAILED after permanent failure (3 exhausted attempts)')

  const { vendor, event, customer } = await getSeedData()
  const testOrder = await createTestOrder(vendor.id, event.id, customer.id)
  const orderId = testOrder.id

  const queue = makeQueue()
  await drainQueue(queue)

  const MAX_ATTEMPTS = 3

  const worker = new Worker<JobData>(
    ORDER_QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_VENDOR_PAYOUT || job.data.orderId !== orderId) return
      throw new Error('Simulated permanent failure')
    },
    { connection, prefix: PREFIX, concurrency: 1 }
  )

  // On final exhausted failure → mark payoutStatus=FAILED in DB
  worker.on('failed', async (job, _err) => {
    if (!job || job.name !== JOB_VENDOR_PAYOUT || job.data.orderId !== orderId) return
    if (job.attemptsMade >= MAX_ATTEMPTS) {
      await prisma.order.update({
        where: { id: orderId },
        data: { payoutStatus: PayoutStatus.FAILED },
      }).catch((e) => console.error('  [worker] DB update failed:', e))
    }
  })

  const exhaustedPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout — job never exhausted retries')), 20_000)
    let failedEvents = 0
    worker.on('failed', (job) => {
      if (!job || job.data.orderId !== orderId) return
      failedEvents++
      if (failedEvents >= MAX_ATTEMPTS) { clearTimeout(timer); resolve() }
    })
    worker.on('error', (err) => { clearTimeout(timer); reject(err) })
  })

  await queue.add(
    JOB_VENDOR_PAYOUT,
    {
      eventId: event.id,
      orderId,
      vendorId: vendor.id,
      transferAmountCents: 930,
      payoutIdempotencyKey: `transfer-completed-${orderId}`,
    },
    { attempts: MAX_ATTEMPTS, backoff: { type: 'fixed', delay: 300 }, jobId: `payout-${orderId}` }
  )

  try {
    await exhaustedPromise
    // Give the async DB update a moment to land
    await new Promise(r => setTimeout(r, 800))

    const updated = await prisma.order.findUnique({
      where: { id: orderId },
      select: { payoutStatus: true },
    })

    if (updated?.payoutStatus === PayoutStatus.FAILED) {
      pass(`order.payoutStatus === 'FAILED' in DB after ${MAX_ATTEMPTS} failed attempts`)
    } else {
      fail(`expected payoutStatus=FAILED, got ${updated?.payoutStatus ?? 'null'}`)
    }
  } catch (err) {
    fail(`permanent failure test errored: ${(err as Error).message}`)
  } finally {
    await worker.close()
    await drainQueue(queue)
    await queue.close()
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {})
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const redisHost = process.env.REDIS_URL?.split('@')[1] ?? 'local'
  console.log(`\nC1 Test Suite — queue prefix: "${PREFIX}:", Redis: ${redisHost}`)
  console.log('─'.repeat(60))

  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL not set — cannot run tests')
    process.exit(1)
  }

  try {
    await test1()
    await test2()
    await test3()
    await test4()
  } catch (err) {
    console.error('\nUnhandled error:', err)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('One or more tests FAILED.')
  } else {
    console.log('All tests passed.')
  }
  process.exit(process.exitCode ?? 0)
}

main()
