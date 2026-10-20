// Route-side wiring for lib/connect-status.readPayeeConnectStatus: the ~60s cached Stripe read,
// the live read, and the per-user limiter for ?fresh=1. Kept apart from lib/connect-status so the
// worker (which imports the job handlers) never pulls in next/cache.

import { unstable_cache } from 'next/cache'
import { getConnectStatus } from './stripe-connect'
import { enforceRateLimit } from './ratelimit'
import { readPayeeConnectStatus, type PayeeKind } from './connect-status'

const cached = (accountId: string) =>
  unstable_cache(() => getConnectStatus(accountId), [`stripe-connect-status-${accountId}`], { revalidate: 60 })()

/** The status read every GET …/stripe/status route returns. */
export async function payeeStatusResponse(input: {
  kind: PayeeKind; id: string; accountId: string | null; isOwner: boolean; clerkId: string; url: string
}) {
  if (!input.accountId) {
    return { connected: false, readyToReceivePayments: false, onboardingComplete: false, requirements: null, dueItems: [], fresh: false }
  }
  const wantFresh = new URL(input.url).searchParams.get('fresh') === '1'
  const status = await readPayeeConnectStatus(
    { kind: input.kind, id: input.id, accountId: input.accountId, wantFresh, isOwner: input.isOwner, userKey: input.clerkId },
    {
      live: getConnectStatus,
      cached,
      // Fail closed: if the limiter can't answer, serve the cached read rather than hit Stripe.
      rateLimit: async userKey => (await enforceRateLimit(userKey, 'connectStatusFresh', { failClosed: true })).allowed,
    },
  )
  return { connected: true, ...status }
}
