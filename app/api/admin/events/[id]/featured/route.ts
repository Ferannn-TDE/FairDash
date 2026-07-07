import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { revalidateTag } from 'next/cache'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/events/[id]/featured
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    // Active vendors sourced via the Vendor model, keyed by the resolved event.id.
    const vendors = await db.vendor.findMany({
      where: { eventId: event.id, status: 'ACTIVE' },
      select: { id: true, name: true, cuisineType: true },
      orderBy: { name: 'asc' },
    })

    return success({
      featuredVendorIds: event.featuredVendorIds,
      featuredLabel: event.featuredLabel,
      featuredEnabled: event.featuredEnabled,
      vendors,
    })
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/admin/events/[id]/featured
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const body = await req.json()
    const { featuredVendorIds, featuredLabel, featuredEnabled } = body

    // Validate all provided vendor IDs belong to this event
    if (Array.isArray(featuredVendorIds) && featuredVendorIds.length > 0) {
      const validCount = await db.vendor.count({
        where: { id: { in: featuredVendorIds }, eventId: event.id },
      })
      if (validCount !== featuredVendorIds.length) {
        throw new ApiError('One or more vendor IDs do not belong to this event', 400, 'INVALID_INPUT')
      }
    }

    const updated = await db.event.update({
      where: { id: event.id },
      data: {
        ...(featuredVendorIds !== undefined && { featuredVendorIds }),
        ...(featuredLabel !== undefined && { featuredLabel: featuredLabel || null }),
        ...(featuredEnabled !== undefined && { featuredEnabled: Boolean(featuredEnabled) }),
      },
      select: {
        featuredVendorIds: true,
        featuredLabel: true,
        featuredEnabled: true,
      },
    })

    revalidateTag('fair', 'default')
    revalidateTag(`fair-${event.urlSlug}`, 'default')

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
