import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
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

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

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
