import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { assertStripeConfigured } from '@/lib/stripe-connect'
import { payeeStatusResponse } from '@/lib/connect-status-route'

// GET /api/runners/me/stripe/status[?fresh=1]
//
// The signed-in runner's live Connect status, ~60s cached. The runner IS the payee, so ?fresh=1
// is theirs to use, within the per-user 'connectStatusFresh' limit. Goes through
// lib/connect-status, the one writer of the payout gate — this route never writes it itself.
export async function GET(req: NextRequest) {
  try {
    assertStripeConfigured()
    const clerkId = await requireRunnerAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')
    const runner = await db.runner.findUnique({ where: { userId: dbUser.id }, select: { id: true, stripeAccountId: true } })
    if (!runner) return apiError('Runner not found', 404, 'NOT_FOUND')

    return success(await payeeStatusResponse({
      kind: 'runner', id: runner.id, accountId: runner.stripeAccountId, isOwner: true, clerkId, url: req.url,
    }))
  } catch (err) {
    return handleApiError(err)
  }
}
