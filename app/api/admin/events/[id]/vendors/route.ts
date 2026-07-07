import { NextRequest } from 'next/server'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { getFairVendors } from '@/lib/fair-vendors'

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

    return success(data)
  } catch (err) {
    return handleApiError(err)
  }
}
