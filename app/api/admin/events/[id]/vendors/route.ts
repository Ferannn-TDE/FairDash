import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { getFairVendors } from '@/lib/fair-vendors'
import { latestVendorReviews } from '@/lib/vendor-review'

// GET /api/admin/events/[id]/vendors
// Admin (cross-fair) vendor roster for a fair. [id] may be the event UUID or urlSlug.
//
// Authorization: requireAdminFairContext — STRICT platform admin (admin |
// super_admin), fair resolved UNSCOPED. The vendor query is the SAME shared
// getFairVendors core the organizer route uses → the admin Vendors screen sees
// exactly what the organizer sees.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { searchParams } = req.nextUrl
    const data = await getFairVendors(event.id, {
      take:   parseInt(searchParams.get('take') ?? '100', 10),
      cursor: searchParams.get('cursor') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    })

    // Who decided each vendor, full name (admin view; Jordan, Nov 16). Added HERE, not in the
    // shared getFairVendors core, because the organizer route uses that core and organizers may
    // not see FairSynq reviewers' names (lib/reviewer-label.ts).
    const reviews = await latestVendorReviews(data.vendors.map(v => v.id), { kind: 'admin' })
    return success({ ...data, vendors: data.vendors.map(v => ({ ...v, review: reviews.get(v.id) ?? null })) })
  } catch (err) {
    return handleApiError(err)
  }
}
