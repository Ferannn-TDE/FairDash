import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { ApiError, handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'
import { revalidateTag } from 'next/cache'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/events/[id]/featured
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdminAuth()
    const { id } = await params

    const event = await db.event.findFirst({
      where: { OR: [{ id }, { urlSlug: id }] },
      select: {
        featuredVendorIds: true,
        featuredLabel: true,
        featuredEnabled: true,
        vendors: {
          where: { status: 'ACTIVE' },
          select: { id: true, name: true, cuisineType: true },
          orderBy: { name: 'asc' },
        },
      },
    })

    if (!event) throw new ApiError('Event not found', 404, 'NOT_FOUND')
    return success(event)
  } catch (err) {
    return handleApiError(err)
  }
}

// PATCH /api/admin/events/[id]/featured
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdminAuth()
    const { id } = await params
    const body = await req.json()
    const { featuredVendorIds, featuredLabel, featuredEnabled } = body

    const event = await db.event.findFirst({
      where: { OR: [{ id }, { urlSlug: id }] },
      select: { id: true, urlSlug: true },
    })
    if (!event) throw new ApiError('Event not found', 404, 'NOT_FOUND')

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

    revalidateTag('fair')
    revalidateTag(`fair-${event.urlSlug}`)

    return success(updated)
  } catch (err) {
    return handleApiError(err)
  }
}
