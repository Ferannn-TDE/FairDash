import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { assertStripeConfigured, getConnectStatus } from '@/lib/stripe-connect'

// GET /api/organizer/stripe/status
//
// Reads V2 connected-account status LIVE from Stripe (source of truth — never a
// DB flag). Lightly cached (~60s). Mirrors the live result into the DB display
// cache (FairOrganizer.stripeVerified / stripeConnectedAt).
//
// Response: { connected, readyToReceivePayments, onboardingComplete, requirements }
export async function GET() {
  try {
    assertStripeConfigured()

    const { organizerId } = await requireOrganizerAuth()

    const organizer = await db.fairOrganizer.findUnique({
      where: { id: organizerId },
      select: { id: true, stripeAccountId: true },
    })
    if (!organizer) return apiError('Organizer not found', 404, 'NOT_FOUND')

    if (!organizer.stripeAccountId) {
      return success({
        connected: false,
        readyToReceivePayments: false,
        onboardingComplete: false,
        requirements: null,
      })
    }

    const accountId = organizer.stripeAccountId

    // ~60s cache per account so renders don't hammer the Stripe API.
    const readStatus = unstable_cache(
      () => getConnectStatus(accountId),
      [`stripe-connect-status-${accountId}`],
      { revalidate: 60 },
    )

    const status = await readStatus()

    // Best-effort mirror of the live result into the DB display cache.
    await db.fairOrganizer
      .update({
        where: { id: organizer.id },
        data: {
          stripeVerified: status.readyToReceivePayments,
          ...(status.readyToReceivePayments ? { stripeConnectedAt: new Date() } : {}),
        },
      })
      .catch(() => {})

    return success({ connected: true, ...status })
  } catch (err) {
    return handleApiError(err)
  }
}
