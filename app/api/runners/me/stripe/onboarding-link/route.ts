import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'
import { requireAppBaseUrl } from '@/lib/app-url'

// POST /api/runners/me/stripe/onboarding-link
//
// Creates a V2 account onboarding link (recipient configuration) and returns the
// hosted Stripe URL. The runner must already have a stripeAccountId (call
// /stripe/connect first). Returns the runner to their settings on completion.
export async function POST() {
  try {
    assertStripeConfigured()

    const clerkId = await requireRunnerAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      select: { stripeAccountId: true, event: { select: { urlSlug: true } } },
    })
    if (!runner) return apiError('Runner not found', 404, 'NOT_FOUND')
    if (!runner.stripeAccountId) {
      return apiError('No Stripe account — set up payouts first', 409, 'NO_STRIPE_ACCOUNT')
    }

    // ONE validated source. Presence was never the question — a var set to localhost
    // passed the old `if (!appUrl)` check and produced a dead link. requireAppBaseUrl
    // rejects a loopback origin in production instead of returning something plausible.
    const appUrl = requireAppBaseUrl()

    const fairSlug = runner.event.urlSlug
    const base = `${appUrl}/runner/${fairSlug}/settings`

    const url = await createOnboardingLink({
      accountId: runner.stripeAccountId,
      refreshUrl: `${base}?stripe=refresh`,
      returnUrl: `${base}?stripe=return`,
    })

    return success({ url })
  } catch (err) {
    return handleApiError(err)
  }
}
