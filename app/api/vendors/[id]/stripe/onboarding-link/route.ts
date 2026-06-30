import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { assertStripeConfigured, createOnboardingLink } from '@/lib/stripe-connect'

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL is not configured — cannot build onboarding return URLs.')
    }

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
