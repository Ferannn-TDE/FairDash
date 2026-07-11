import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { setPayoutFreeze } from '@/lib/admin-money'

// POST /api/admin/events/[id]/money/freeze
//
// C1 — the payout kill-switch. Freezes or unfreezes EVERY payout for one payee.
// Body: { payeeType: 'vendor'|'runner'|'organizer', payeeId, frozen: boolean, reason }
//
// This is the blunt "stop paying this person while we investigate" lever, modelled on
// the proven org kill-switch (FairOrganizer.suspendedAt): admin-only write, plain DB
// state re-read by the payout executor on every attempt, so it takes effect on the
// very next payout with no queue or token lag — and the payee cannot self-rescue,
// because requireAdminFairContext structurally rejects non-admins.
//
// For a vendor or runner it is fair-scoped (they are event-scoped rows). For an
// organizer it is NOT: their Connect account is org-level and shared across every
// fair they run (the locked Part B decision), so freezing them stops their money on
// ALL their fairs. The response says so explicitly — an admin should never discover
// that side effect after the fact.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { event, adminClerkId } = await requireAdminFairContext(id)

    const body = (await req.json()) as {
      payeeType?: unknown
      payeeId?: unknown
      frozen?: unknown
      reason?: unknown
    }

    const { payeeType, payeeId, frozen, reason } = body

    if (payeeType !== 'vendor' && payeeType !== 'runner' && payeeType !== 'organizer') {
      throw new ApiError("payeeType must be 'vendor' | 'runner' | 'organizer'", 400, 'VALIDATION_ERROR')
    }
    if (typeof payeeId !== 'string' || !payeeId) {
      throw new ApiError('payeeId is required', 400, 'VALIDATION_ERROR')
    }
    if (typeof frozen !== 'boolean') {
      throw new ApiError('frozen must be a boolean', 400, 'VALIDATION_ERROR')
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError('reason is required for every admin money action', 400, 'REASON_REQUIRED')
    }

    const result = await setPayoutFreeze(
      { adminClerkId, eventId: event.id },
      { payeeType, payeeId, frozen, reason },
    )

    return success({
      result,
      scope:
        payeeType === 'organizer'
          ? 'ALL fairs this organizer runs — their Connect account is org-level, not per-fair'
          : 'this fair only',
    })
  } catch (err) {
    return handleApiError(err)
  }
}
