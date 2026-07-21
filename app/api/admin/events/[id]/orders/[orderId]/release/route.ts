import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { adminReleaseStranded } from '@/lib/release-order'
import { logger } from '@/lib/logger'

// POST /api/admin/events/:id/orders/:orderId/release  — Commit 2, U5
//
// The CLAIMED_NOT_COLLECTED handle: an admin releases a stranded PRE-collection order back to the
// pool on the assigned runner's behalf (the runner is unresponsive, the food is still on the
// counter). Same atomic, pre-collection-gated release core — a COLLECTED order refuses (that is
// the deliberate-refund path, not a release).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; orderId: string }> }) {
  try {
    const { id, orderId } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)

    const r = await adminReleaseStranded({ orderId, eventId: event.id, actorId: adminClerkId })

    switch (r.outcome) {
      case 'released':
        logger.warn('[AdminRelease] admin released a stranded order to the pool', { orderId, eventId: event.id, admin: adminClerkId })
        return success({ orderId, released: true })
      case 'not_found':
        return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      case 'wrong_event':
        return apiError('Order does not belong to this fair', 403, 'FORBIDDEN')
      case 'not_your_delivery':
        return apiError('Order has no assigned runner to release', 409, 'NO_RUNNER')
      case 'already_collected':
        return apiError('The runner has collected this order — use a refund, not a release', 409, 'ALREADY_COLLECTED')
      case 'not_releasable':
        return apiError(`Cannot release an order in ${r.status}`, 409, 'INVALID_STATE')
    }
  } catch (err) {
    return handleApiError(err)
  }
}
