import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { getFairVendors } from '@/lib/fair-vendors'

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

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
