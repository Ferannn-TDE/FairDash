/**
 * GET /api/admin/queues
 *
 * Admin-only queue dashboard. Returns live counts and recent jobs for all
 * BullMQ queues. Protected by requireAdminAuth — no unauthenticated access.
 *
 * Uses @bull-board/api's BullMQAdapter + createBullBoard for the board model;
 * serves JSON rather than the full SPA so it works in Next.js App Router.
 */

import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { getOrderQueue, ORDER_QUEUE_NAME } from '@/lib/queues'

export async function GET() {
  try {
    await requireAdminAuth()

    const queue = getOrderQueue()
    if (!queue) {
      return apiError('Redis not connected — queue unavailable', 503, 'SERVICE_UNAVAILABLE')
    }

    // Build the BullBoard model (attaches queue to introspection layer)
    createBullBoard({
      queues: [new BullMQAdapter(queue)],
      serverAdapter: { setBasePath: () => {} } as never,
    })

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ])

    // Recent failed jobs — last 20 for triage
    const failedJobs = await queue.getFailed(0, 19)
    const recentFailed = failedJobs.map(j => ({
      id: j.id,
      name: j.name,
      attemptsMade: j.attemptsMade,
      failedReason: j.failedReason,
      orderId: j.data.orderId ?? null,
      timestamp: j.timestamp,
    }))

    // Recent delayed jobs
    const delayedJobs = await queue.getDelayed(0, 9)
    const recentDelayed = delayedJobs.map(j => ({
      id: j.id,
      name: j.name,
      delay: j.opts.delay,
      orderId: j.data.orderId ?? null,
      timestamp: j.timestamp,
    }))

    return success({
      queue: ORDER_QUEUE_NAME,
      counts: { waiting, active, completed, failed, delayed },
      recentFailed,
      recentDelayed,
      bullBoardQueues: [ORDER_QUEUE_NAME],
    })
  } catch (err) {
    return handleApiError(err)
  }
}
