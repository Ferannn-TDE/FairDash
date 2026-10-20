import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { assertStripeConfigured } from '@/lib/stripe-connect'
import { payeeStatusResponse } from '@/lib/connect-status-route'

// GET /api/organizer/stripe/status[?fresh=1]
//
// The organizer account's live Connect status, ~60s cached. ?fresh=1 is honoured only for an
// OWNER of the organizer account, within the per-user 'connectStatusFresh' limit. Goes through
// lib/connect-status, the one writer of the payout gate — this route never writes it itself.
export async function GET(req: NextRequest) {
  try {
    assertStripeConfigured()
    const { clerkId, organizerId } = await requireOrganizerAuth()

    const organizer = await db.fairOrganizer.findUnique({ where: { id: organizerId }, select: { id: true, stripeAccountId: true } })
    if (!organizer) return apiError('Organizer not found', 404, 'NOT_FOUND')

    const member = await db.orgMember.findFirst({
      where: { organizerId, user: { clerkId } }, select: { role: true },
    })

    return success(await payeeStatusResponse({
      kind: 'organizer', id: organizer.id, accountId: organizer.stripeAccountId,
      isOwner: member?.role === 'owner', clerkId, url: req.url,
    }))
  } catch (err) {
    return handleApiError(err)
  }
}
