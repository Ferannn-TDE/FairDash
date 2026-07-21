import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { enforceRateLimit } from '@/lib/ratelimit'
import { confirmReturn } from '@/lib/confirm-return'
import { logger } from '@/lib/logger'

// POST /api/orders/:id/confirm-return  — Commit 2, U3 (vendor side)
//
// The vendor confirms the returned food is physically back in their possession, so the order
// goes back to the pool (READY, unclaimed, custody cleared). This is the vendor's OWN action —
// their COMPLETED path is gated off for runner-fulfilled orders — keyed on returnRequestedAt.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const clerkId = await requireAuth()

    const { allowed, headers: rlHeaders } = await enforceRateLimit(`confirm-return:${clerkId}`, 'vendorStatus')
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429, headers: rlHeaders })
    }

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    // Resolve the caller's vendor membership that is ACTUALLY on this order (a user may be a
    // member of several vendors; pick the one with a VendorOrderStatus for this order).
    const memberships = await db.vendorMember.findMany({ where: { userId: dbUser.id }, select: { vendorId: true } })
    const vendorIds = memberships.map(m => m.vendorId)
    if (vendorIds.length === 0) return apiError('Access denied — not a vendor member', 403, 'FORBIDDEN')

    const vos = await db.vendorOrderStatus.findFirst({
      where: { orderId: id, vendorId: { in: vendorIds } },
      select: { vendorId: true },
    })
    if (!vos) return apiError('This order does not include your vendor', 404, 'NOT_FOUND')

    // Second-level auth (cache): confirm membership of the resolved vendor.
    const confirmedMember = await getVendorAuth(dbUser.id, vos.vendorId, req)
    if (!confirmedMember) return apiError('Access denied — not a vendor member', 403, 'FORBIDDEN')

    const r = await confirmReturn({ orderId: id, vendorId: vos.vendorId, actorId: dbUser.id })

    switch (r.outcome) {
      case 'returned':
        logger.info('[ConfirmReturn] vendor confirmed a returned order back to the pool', { orderId: id, vendorId: vos.vendorId })
        return success({ orderId: id, returned: true })
      case 'not_found':
        return apiError('Order not found', 404, 'ORDER_NOT_FOUND')
      case 'order_voided':
        return apiError('This order was voided by an admin', 409, 'ORDER_VOIDED')
      case 'not_on_order':
        return apiError('This order does not include your vendor', 404, 'NOT_FOUND')
      case 'no_return_requested':
        return apiError('No return is in progress for this order', 409, 'NO_RETURN_REQUESTED')
      case 'not_confirmable':
        return apiError(`Cannot confirm a return for an order in ${r.status}`, 409, 'INVALID_STATE')
    }
  } catch (err) {
    return handleApiError(err)
  }
}
