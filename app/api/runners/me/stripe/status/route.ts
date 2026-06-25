import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { assertStripeConfigured, getConnectStatus } from '@/lib/stripe-connect'

// GET /api/runners/me/stripe/status
//
// Reads V2 connected-account status LIVE from Stripe (source of truth — never a
// DB flag). Lightly cached (~60s). Mirrors the live result into the DB display
// cache (Runner.stripeVerified / stripeConnectedAt) so the rest of the app can
// read a cheap flag — but Stripe stays authoritative.
//
// Response: { connected, readyToReceivePayments, onboardingComplete, requirements }
export async function GET() {
  try {
    assertStripeConfigured()

    const clerkId = await requireRunnerAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      select: { id: true, stripeAccountId: true },
    })
    if (!runner) return apiError('Runner not found', 404, 'NOT_FOUND')

    if (!runner.stripeAccountId) {
      return success({
        connected: false,
        readyToReceivePayments: false,
        onboardingComplete: false,
        requirements: null,
      })
    }

    const accountId = runner.stripeAccountId

    // ~60s cache per account so renders don't hammer the Stripe API.
    const readStatus = unstable_cache(
      () => getConnectStatus(accountId),
      [`stripe-connect-status-${accountId}`],
      { revalidate: 60 },
    )

    const status = await readStatus()

    // Best-effort mirror of the live result into the DB display cache.
    await db.runner
      .update({
        where: { id: runner.id },
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
