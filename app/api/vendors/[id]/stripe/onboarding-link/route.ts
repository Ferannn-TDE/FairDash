import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'
import { requireAppBaseUrl } from '@/lib/app-url'

// POST /api/vendors/:id/stripe/onboarding-link
//
// Creates a V2 account onboarding link (recipient configuration) and returns the
// hosted Stripe URL. The vendor must already have a stripeAccountId (call
// /stripe/connect first). Caller must be a member/owner of this vendor.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertStripeConfigured()

    const vendorId = (await params).id
    await requireVendorMembershipById(vendorId, req)

    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: { stripeAccountId: true, event: { select: { urlSlug: true } } },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')
    if (!vendor.stripeAccountId) {
      return apiError('No Stripe account — set up payouts first', 409, 'NO_STRIPE_ACCOUNT')
    }

    // ONE validated source. Presence was never the question — a var set to localhost
    // passed the old `if (!appUrl)` check and produced a dead link. requireAppBaseUrl
    // rejects a loopback origin in production instead of returning something plausible.
    const appUrl = requireAppBaseUrl()

    const fairSlug = vendor.event.urlSlug
    const base = `${appUrl}/vendor/${fairSlug}/settings`

    const url = await createOnboardingLink({
      accountId: vendor.stripeAccountId,
      refreshUrl: `${base}?stripe=refresh`,
      returnUrl: `${base}?stripe=return`,
    })

    return success({ url })
  } catch (err) {
    return handleApiError(err)
  }
}
