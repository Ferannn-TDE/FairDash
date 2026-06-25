import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { assertStripeConfigured, createConnectedAccount } from '@/lib/stripe-connect'

// POST /api/runners/me/stripe/connect
//
// Creates a V2 Express recipient connected account for the authenticated runner
// and stores account.id on Runner.stripeAccountId. Idempotent: if the runner
// already has a stripeAccountId, it is returned as-is — never create duplicates.
//
// DESTINATIONS ONLY (Part B Phase B1): this sets up where a runner gets paid.
// No transfer fires here — runner payouts are Phase B2.
export async function POST() {
  try {
    assertStripeConfigured()

    const clerkId = await requireRunnerAuth()

    const dbUser = await db.user.findUnique({
      where: { clerkId },
      select: { id: true, name: true, email: true },
    })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      select: { id: true, stripeAccountId: true },
    })
    if (!runner) return apiError('Runner not found', 404, 'NOT_FOUND')

    // Reuse an existing account — never create duplicates.
    if (runner.stripeAccountId) {
      return success({ accountId: runner.stripeAccountId, created: false })
    }

    const account = await createConnectedAccount({
      displayName: dbUser.name ?? 'FairSynq Runner',
      contactEmail: dbUser.email,
    })

    await db.runner.update({
      where: { id: runner.id },
      data: { stripeAccountId: account.id },
    })

    return success({ accountId: account.id, created: true }, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
