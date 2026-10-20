import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorMembershipById } from '@/lib/auth'
import { assertStripeConfigured } from '@/lib/stripe-connect'
import { payeeStatusResponse } from '@/lib/connect-status-route'

// GET /api/vendors/:id/stripe/status[?fresh=1]
//
// Live Connect status (Stripe is the source of truth), ~60s cached. ?fresh=1 skips the cache,
// but only for an OWNER of this booth and within the per-user 'connectStatusFresh' limit;
// anyone else gets the cached read. The result goes through lib/connect-status, the one writer
// of the payout gate (stripeVerified) — this route never writes the flag itself.
//
// Response: { connected, readyToReceivePayments, onboardingComplete, requirements, dueItems, fresh }
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertStripeConfigured()
    const vendorId = (await params).id
    const { clerkId, membership } = await requireVendorMembershipById(vendorId, req)

    const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { stripeAccountId: true } })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    return success(await payeeStatusResponse({
      kind: 'vendor', id: vendorId, accountId: vendor.stripeAccountId,
      isOwner: membership.role === 'owner', clerkId, url: req.url,
    }))
  } catch (err) {
    return handleApiError(err)
  }
}
