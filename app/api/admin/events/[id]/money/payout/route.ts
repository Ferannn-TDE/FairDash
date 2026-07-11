import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { setOrderPayoutState, setOrganizerPayoutState } from '@/lib/admin-money'

// POST /api/admin/events/[id]/money/payout
//
// C1 — the admin HOLD / RELEASE / CANCEL control on a pending payout.
//
// Body:
//   { payeeType: 'vendor',    action, orderId, vendorId, reason }
//   { payeeType: 'runner',    action, orderId,           reason }
//   { payeeType: 'organizer', action,                    reason }   ← per-EVENT batch
//   action ∈ HOLD | RELEASE | CANCEL
//
// Authorization + fair scoping: requireAdminFairContext — the SAME proven chokepoint
// the rest of the admin portal rides. It (1) demands a STRICT platform admin via a
// fresh currentUser() read (an organizer is structurally rejected — they cannot
// unfreeze their own money), (2) resolves the fair, and (3) audits the cross-fair
// access. This route adds NO Event resolve of its own, so the grep invariant (exactly
// one unscoped event resolve on the admin surface) is untouched.
//
// Money safety: this endpoint moves NO money. It writes DB state that the payout
// executors read as a gate. See lib/admin-money.ts for why the gate lives in the
// executor rather than in the job queue.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)

    const body = (await req.json()) as {
      payeeType?: unknown
      action?: unknown
      orderId?: unknown
      vendorId?: unknown
      reason?: unknown
    }

    const payeeType = body.payeeType
    const action = body.action
    const reason = body.reason

    if (payeeType !== 'vendor' && payeeType !== 'runner' && payeeType !== 'organizer') {
      throw new ApiError("payeeType must be 'vendor' | 'runner' | 'organizer'", 400, 'VALIDATION_ERROR')
    }
    if (action !== 'HOLD' && action !== 'RELEASE' && action !== 'CANCEL') {
      throw new ApiError("action must be 'HOLD' | 'RELEASE' | 'CANCEL'", 400, 'VALIDATION_ERROR')
    }
    // A money action without a stated reason is unauditable. Required, not optional —
    // the AdminMoneyAction row is the defence when a payee contests this.
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError('reason is required for every admin money action', 400, 'REASON_REQUIRED')
    }

    const ctx = { adminClerkId, eventId: event.id }

    if (payeeType === 'organizer') {
      const result = await setOrganizerPayoutState(ctx, { action, reason })
      return success({ result })
    }

    if (typeof body.orderId !== 'string' || !body.orderId) {
      throw new ApiError('orderId is required for a vendor or runner payout action', 400, 'VALIDATION_ERROR')
    }
    if (payeeType === 'vendor' && (typeof body.vendorId !== 'string' || !body.vendorId)) {
      throw new ApiError('vendorId is required for a vendor payout action', 400, 'VALIDATION_ERROR')
    }

    const result = await setOrderPayoutState(ctx, {
      payeeType,
      orderId: body.orderId,
      vendorId: payeeType === 'vendor' ? (body.vendorId as string) : undefined,
      action,
      reason,
    })

    return success({ result })
  } catch (err) {
    return handleApiError(err)
  }
}
