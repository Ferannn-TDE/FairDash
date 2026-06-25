import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL is not configured — cannot build onboarding return URLs.')
    }

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
