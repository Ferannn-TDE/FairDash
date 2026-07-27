import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'
import { requireAppBaseUrl } from '@/lib/app-url'

// POST /api/organizer/stripe/onboarding-link
//
// Creates a V2 account onboarding link (recipient configuration) and returns the
// hosted Stripe URL. The organizer must already have a stripeAccountId (call
// /stripe/connect first). Returns the organizer to their settings on completion.
export async function POST() {
  try {
    assertStripeConfigured()

    const { organizerId } = await requireOrganizerAuth()

    const organizer = await db.fairOrganizer.findUnique({
      where: { id: organizerId },
      select: { stripeAccountId: true },
    })
    if (!organizer) return apiError('Organizer not found', 404, 'NOT_FOUND')
    if (!organizer.stripeAccountId) {
      return apiError('No Stripe account — set up payouts first', 409, 'NO_STRIPE_ACCOUNT')
    }

    // ONE validated source. Presence was never the question — a var set to localhost
    // passed the old `if (!appUrl)` check and produced a dead link. requireAppBaseUrl
    // rejects a loopback origin in production instead of returning something plausible.
    const appUrl = requireAppBaseUrl()

    const base = `${appUrl}/organizer/settings`

    const url = await createOnboardingLink({
      accountId: organizer.stripeAccountId,
      refreshUrl: `${base}?stripe=refresh`,
      returnUrl: `${base}?stripe=return`,
    })

    return success({ url })
  } catch (err) {
    return handleApiError(err)
  }
}
