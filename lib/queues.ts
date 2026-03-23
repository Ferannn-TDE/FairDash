/**
 * BullMQ queue definitions — producer side only.
 *
 * API routes call getOrderQueue().add(...) to enqueue jobs.
 * The consumer (worker) runs in a separate process: `npm run worker`.
 *
 * Graceful no-Redis fallback: if REDIS_URL is unset, all queue operations
 * are skipped and a warning is logged. The app stays functional; delayed
 * jobs (e.g. UNCOLLECTED timeout) simply won't fire until Redis is wired up.
 *
 * Connection strategy: we pass a plain RedisOptions object rather than an
 * IORedis instance so BullMQ uses its own bundled ioredis — this avoids
 * dual-version type conflicts between top-level ioredis and bullmq's copy.
 */

import { Queue, ConnectionOptions } from 'bullmq'

// ─── Connection options ───────────────────────────────────────────────────────

function buildConnectionOptions(url: string): ConnectionOptions {
  const parsed = new URL(url)
  const opts: ConnectionOptions = {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    maxRetriesPerRequest: null, // required by BullMQ
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

function getConnectionOptions(): ConnectionOptions | null {
  const url = process.env.REDIS_URL
  if (!url) {
    console.warn('[BullMQ] REDIS_URL not set — delayed jobs disabled')
    return null
  }
  try {
    return buildConnectionOptions(url)
  } catch (err) {
    console.error('[BullMQ] Failed to parse REDIS_URL:', err)
    return null
  }
}

// ─── Queue names ─────────────────────────────────────────────────────────────

export const ORDER_QUEUE_NAME = 'fairsynq-orders'

// ─── Job names ────────────────────────────────────────────────────────────────

export const JOB_UNCOLLECTED = 'mark-uncollected'    // booth / curbside 15-min timeout
export const JOB_UNDELIVERABLE = 'mark-undeliverable' // home delivery timeout

// ─── Delays ──────────────────────────────────────────────────────────────────

export const UNCOLLECTED_DELAY_MS = 15 * 60 * 1000   // 15 minutes

// ─── Job payloads ─────────────────────────────────────────────────────────────

export interface UncollectedJobData {
  orderId: string
  vendorId: string
}

// ─── Queue singleton ─────────────────────────────────────────────────────────

const globalForQueue = globalThis as unknown as {
  orderQueue: Queue | undefined
}

export function getOrderQueue(): Queue | null {
  if (globalForQueue.orderQueue) return globalForQueue.orderQueue

  const connection = getConnectionOptions()
  if (!connection) return null

  const queue = new Queue(ORDER_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  })

  if (process.env.NODE_ENV !== 'production') {
    globalForQueue.orderQueue = queue
  }

  return queue
}
