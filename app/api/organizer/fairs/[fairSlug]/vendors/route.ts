import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getFairVendors } from '@/lib/fair-vendors'
import { latestVendorReviews } from '@/lib/vendor-review'

// GET /api/organizer/fairs/[fairSlug]/vendors?status=ACTIVE&take=50&cursor=<id>
// Returns vendors with document status, Stripe status, order counts + readiness.
//
// Authorization: ownership-scoped (requireOrganizerAuth → event resolved WITH
// organizerId). The vendor query lives in the shared getFairVendors core, so this
// list matches the admin one byte-for-byte. Boundary UNCHANGED.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const { searchParams } = req.nextUrl
    const data = await getFairVendors(event.id, {
      take:   parseInt(searchParams.get('take') ?? '50', 10),
      cursor: searchParams.get('cursor') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    })

    // Who decided each vendor, as an ORGANIZER may see it (own team by name, FairSynq staff as
    // "FairSynq"; lib/reviewer-label.ts). Added here, not in the shared core the admin route uses.
    const reviews = await latestVendorReviews(data.vendors.map(v => v.id), { kind: 'organizer', organizerId })
    return success({ ...data, vendors: data.vendors.map(v => ({ ...v, review: reviews.get(v.id) ?? null })) })
  } catch (err) {
    return handleApiError(err)
  }
}
