import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { db } from '@/lib/db'
import { writeMoneyAudit } from '@/lib/admin-money'
import { logger } from '@/lib/logger'

// POST /api/admin/events/[id]/money/retry-payout
// Body: { leg: 'runner'|'organizer', id: string, reason: string }
//
// RETURN A FAILED PAYOUT TO THE CANDIDATE SET. It does NOT execute a payout.
//
// WHY THIS EXISTS AT ALL: marking a terminal failure sets status='failed', which removes the
// row from the reconciler's candidate query (runner-payout.ts filters status:'tracked'). That
// is the point — a hopeless request stops burning attempts — but it makes the stop a ONE-WAY
// DOOR without this. Not hypothetical: the transfer_group bug failed identically for eight
// days; under the new marking both rows would have been marked on the first attempt, the fix
// would then have deployed, and NOTHING would have happened, because the rows no longer
// qualified. Somebody would have had to hand-edit the database to get paid.
//
// WHY IT DOES NOT PAY INLINE: a second code path to the same money move is the class this
// codebase keeps closing. The sweep is the proven path — it carries the double-pay guard, the
// admin freeze/hold gates, the classifier fast-fail and the idempotency key. This route only
// makes the row ELIGIBLE; the next sweep (~60s) does the money. The admin sees the result
// where they see every other payout.
//
// Fair-scoped by requireAdminFairContext, and every lookup is keyed by BOTH the row id AND
// event.id — so an id from another fair returns 404, not someone else's money.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: eventSlugOrId } = await params
    const { event, adminClerkId } = await requireAdminFairContext(eventSlugOrId)

    const body = (await req.json()) as { leg?: unknown; id?: unknown; reason?: unknown }
    const { leg, id, reason } = body

    if (leg !== 'runner' && leg !== 'organizer') {
      throw new ApiError("leg must be 'runner' | 'organizer'", 400, 'VALIDATION_ERROR')
    }
    if (typeof id !== 'string' || !id) {
      throw new ApiError('id is required', 400, 'VALIDATION_ERROR')
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      throw new ApiError('reason is required (min 3 chars)', 400, 'VALIDATION_ERROR')
    }

    if (leg === 'runner') {
      // Keyed by orderId AND eventId — cross-fair ids cannot resolve.
      const earning = await db.runnerEarning.findFirst({
        where: { orderId: id, eventId: event.id },
        select: { id: true, orderId: true, status: true, runnerId: true, amountCents: true },
      })
      if (!earning) throw new ApiError('Failed runner payout not found in this fair', 404, 'NOT_FOUND')
      if (earning.status !== 'failed') {
        throw new ApiError(`Runner payout is '${earning.status}', not 'failed' — nothing to retry`, 409, 'CONFLICT')
      }

      // 'tracked' is the ONLY value that re-enters reconcileRunnerPayouts' candidate query.
      await db.runnerEarning.update({ where: { id: earning.id }, data: { status: 'tracked' } })
      const audit = await writeMoneyAudit({ id: adminClerkId, type: 'admin' }, event.id, {
        action: 'RELEASE', payeeType: 'runner', payeeId: earning.runnerId,
        orderId: earning.orderId, earningId: earning.id, amountCents: earning.amountCents,
        reason: `retry after failed payout: ${reason.trim()}`,
        metadata: { retriedFrom: 'failed', newStatus: 'tracked' },
      })
      logger.money('[AdminRetry] runner payout returned to the candidate set', {
        orderId: earning.orderId, eventId: event.id, adminClerkId,
      })
      return success({
        leg, id: earning.orderId, newStatus: 'tracked', auditId: audit.id,
        note: 'Eligible again — the next reconcile sweep (~60s) will attempt it. No payout was executed by this request.',
      })
    }

    const batch = await db.organizerPayout.findFirst({
      where: { id, eventId: event.id },
      select: { id: true, status: true, organizerId: true, totalCents: true },
    })
    if (!batch) throw new ApiError('Failed organizer batch not found in this fair', 404, 'NOT_FOUND')
    if (batch.status !== 'failed') {
      throw new ApiError(`Organizer batch is '${batch.status}', not 'failed' — nothing to retry`, 409, 'CONFLICT')
    }

    // 'pending' is what processEventOrganizerPayout reuses as the crash-recovery anchor, so the
    // batch (and its already-linked earnings) is retried as-is rather than re-formed.
    await db.organizerPayout.update({ where: { id: batch.id }, data: { status: 'pending' } })
    const audit = await writeMoneyAudit({ id: adminClerkId, type: 'admin' }, event.id, {
      action: 'RELEASE', payeeType: 'organizer', payeeId: batch.organizerId ?? event.id,
      orderId: null, earningId: batch.id, amountCents: batch.totalCents,
      reason: `retry after failed payout: ${reason.trim()}`,
      metadata: { retriedFrom: 'failed', newStatus: 'pending' },
    })
    logger.money('[AdminRetry] organizer batch returned to the candidate set', {
      batchId: batch.id, eventId: event.id, adminClerkId,
    })
    return success({
      leg, id: batch.id, newStatus: 'pending', auditId: audit.id,
      note: 'Eligible again — the next reconcile sweep (~60s) will attempt it. No payout was executed by this request.',
    })
  } catch (err) {
    return handleApiError(err)
  }
}
