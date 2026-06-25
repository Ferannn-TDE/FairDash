import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { assertStripeConfigured, createConnectedAccount } from '@/lib/stripe-connect'

// POST /api/vendors/:id/stripe/connect
//
// Creates a V2 Express recipient connected account for this vendor and stores
// account.id on Vendor.stripeAccountId. Idempotent: if the vendor already has a
// stripeAccountId, it is returned as-is — never create duplicates.
//
// Caller must be a member/owner of this vendor.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertStripeConfigured()

    const clerkId = await requireAuth()
    const vendorId = (await params).id

    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        stripeAccountId: true,
        vendorMembers: {
          select: { role: true, user: { select: { email: true } } },
        },
      },
    })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    // Reuse an existing account — never create duplicates.
    if (vendor.stripeAccountId) {
      return success({ accountId: vendor.stripeAccountId, created: false })
    }

    // Prefer the owner's email as the account contact; fall back to any member.
    const owner = vendor.vendorMembers.find(m => m.role === 'owner')
    const contactEmail = owner?.user.email ?? vendor.vendorMembers[0]?.user.email ?? null

    const account = await createConnectedAccount({
      displayName: vendor.name,
      contactEmail,
    })

    await db.vendor.update({
      where: { id: vendorId },
      data: { stripeAccountId: account.id },
    })

    return success({ accountId: account.id, created: true }, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
