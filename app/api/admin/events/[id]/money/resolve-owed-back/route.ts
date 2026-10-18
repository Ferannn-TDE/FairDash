import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { resolveOwedBackHalt } from '@/lib/tip-refund'

// POST /api/admin/events/[id]/money/resolve-owed-back
// Body: { orderId: string, reason: string }
//
// CLOSE AN OWED-BACK HALT. It does NOT refund anything. The order leaves the owed-back scan for
// good, so it stops alerting and is never refunded by the sweep. Use it once the money has been
// sorted out by hand (e.g. a manual refund in the Stripe dashboard) — the note says how.
//
// Fair-scoped by requireAdminFairContext; the halt is looked up by orderId AND event.id, so an
// order from another fair returns 404.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)

    const body = (await req.json().catch(() => null)) as { orderId?: unknown; reason?: unknown } | null
    const orderId = body?.orderId
    const reason = body?.reason
    if (typeof orderId !== 'string' || !orderId) throw new ApiError('orderId is required', 400, 'VALIDATION_ERROR')
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      throw new ApiError('A note is required (min 3 chars)', 400, 'REASON_REQUIRED')
    }

    const res = await resolveOwedBackHalt({ adminClerkId, eventId: event.id }, orderId, reason)
    if (!res.ok && res.code === 'NOT_FOUND') throw new ApiError('No owed-back halt for that order in this fair', 404, 'NOT_FOUND')
    if (!res.ok) throw new ApiError('This halt is already resolved', 409, 'CONFLICT')

    return success({ orderId, resolved: true, refundIssued: false })
  } catch (err) {
    return handleApiError(err)
  }
}
