/**
 * Centralized BullMQ enqueue helper with retry, timeout, fallback, and deduplication.
 *
 * Use enqueueJobSafely() instead of queue.add() everywhere. It:
 *  - Retries up to 3x with exponential backoff on Redis/timeout errors
 *  - Races against a configurable timeout (default 2 s) per attempt
 *  - Runs an inline fallback (e.g. direct Stripe call) if all retries fail
 *  - Returns 'queued' | 'fallback' | 'dropped' so callers can log appropriately
 *
 * Callers are responsible for the getOrderQueue() null check — only pass a
 * live Queue instance here.
 */

import { Queue } from 'bullmq'
import { logger } from './logger'

type JobPriority = 'critical' | 'normal' | 'low'

interface EnqueueOptions<T> {
  queue:      Queue
  name:       string
  data:       T
  jobId?:     string          // deduplication — prevents duplicate jobs on retry
  priority?:  JobPriority
  delay?:     number          // milliseconds before job becomes active
  fallback?:  () => Promise<void>  // inline fallback for critical jobs
  timeoutMs?: number          // per-attempt timeout, default 2000 ms
}

const PRIORITY_MAP: Record<JobPriority, number> = {
  critical: 1,
  normal:   10,
  low:      100,
}

export async function enqueueJobSafely<T>(
  opts: EnqueueOptions<T>
): Promise<'queued' | 'fallback' | 'dropped'> {
  const { queue, name, data, jobId, priority = 'normal', delay, fallback, timeoutMs = 2000 } = opts

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // BullMQ returns undefined when jobId already exists in the queue (dedup hit).
      // We don't check the return value — if queue.add() resolves, the job is queued.
      await Promise.race([
        queue.add(name, data, {
          jobId,
          delay,
          priority: PRIORITY_MAP[priority],
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Enqueue timeout')), timeoutMs)
        ),
      ])

      return 'queued'
    } catch (err) {
      const isLastAttempt = attempt === 2

      if (!isLastAttempt) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)))
        continue
      }

      // All retries exhausted
      logger.error('[Queue] Failed to enqueue after 3 attempts', {
        queue:   queue.name,
        jobName: name,
        jobId,
        error:   err instanceof Error ? err.message : String(err),
      })

      if (fallback) {
        logger.warn('[Queue] Executing inline fallback for ' + name)
        try {
          await fallback()
          return 'fallback'
        } catch (fallbackErr) {
          logger.error('[Queue] Fallback also failed', { jobName: name, error: String(fallbackErr) })
        }
      }

      return 'dropped'
    }
  }

  return 'dropped'
}
