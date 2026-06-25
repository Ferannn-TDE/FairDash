import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL is not configured — cannot build onboarding return URLs.')
    }

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
