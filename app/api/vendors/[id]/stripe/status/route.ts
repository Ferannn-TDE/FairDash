import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { assertStripeConfigured, getConnectStatus } from '@/lib/stripe-connect'

// GET /api/vendors/:id/stripe/status
//
// Reads V2 connected-account status LIVE from Stripe (source of truth — never a
// DB flag). Lightly cached (~60s) so we don't call Stripe on every render.
//
// Response: { connected, readyToReceivePayments, onboardingComplete, requirements }
//   - connected: whether a Stripe account exists for this vendor
//   - readyToReceivePayments: stripe_balance.stripe_transfers.status === 'active'
//   - onboardingComplete: no currently_due / past_due requirements
//
// Caller must be a member/owner of this vendor.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertStripeConfigured()

    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: { stripeAccountId: true },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    if (!vendor.stripeAccountId) {
      return success({
        connected: false,
        readyToReceivePayments: false,
        onboardingComplete: false,
        requirements: null,
      })
    }

    const accountId = vendor.stripeAccountId

    // ~60s cache per account so renders don't hammer the Stripe API.
    const readStatus = unstable_cache(
      () => getConnectStatus(accountId),
      [`stripe-connect-status-${accountId}`],
      { revalidate: 60 },
    )

    const status = await readStatus()

    // Best-effort mirror of the live result into the DB display cache.
    await db.vendor
      .update({
        where: { id: vendorId },
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
