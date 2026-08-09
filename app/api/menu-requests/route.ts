import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'
import { logVendorAction, AUDIT_ACTIONS } from '@/lib/vendor-audit'
import { assertSafeImageUrl } from '@/lib/upload-limits'

// POST /api/menu-requests — submit ADD / EDIT / DELETE request for organizer approval
export async function POST(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const body = await req.json()
    const { vendorId, type, menuItemId, name, description, price, category, prepTime, imageUrl } = body

    if (!vendorId || !type) return apiError('vendorId and type are required', 400, 'VALIDATION_ERROR')
    if (!['ADD', 'EDIT', 'DELETE'].includes(type)) return apiError('Invalid type', 400, 'VALIDATION_ERROR')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await getVendorAuth(dbUser.id, vendorId, req)
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    if (type === 'ADD' && (!name || price === undefined || !category)) {
      return apiError('name, price, and category are required for ADD', 400, 'VALIDATION_ERROR')
    }
    if (price !== undefined) {
      const p = Number(price)
      if (isNaN(p) || p <= 0 || p > 10_000) {
        return apiError('Price must be between $0.01 and $10,000', 400, 'VALIDATION_ERROR')
      }
    }
    if ((type === 'EDIT' || type === 'DELETE') && !menuItemId) {
      return apiError('menuItemId is required for EDIT/DELETE', 400, 'VALIDATION_ERROR')
    }
    // A menu request is copied verbatim onto the MenuItem at approval time, so an unvalidated
    // imageUrl here is the same bypass one approval later. See lib/upload-limits.ts.
    assertSafeImageUrl(imageUrl)

    const request = await db.menuRequest.create({
      data: {
        vendorId,
        requestedBy: dbUser.id,
        type,
        menuItemId: menuItemId ?? null,
        name: name ?? null,
        description: description ?? null,
        price: price !== undefined ? Number(price) : null,
        category: category ?? null,
        prepTime: prepTime !== undefined ? Number(prepTime) : null,
        imageUrl: imageUrl ?? null,
      },
    })

    logVendorAction(vendorId, dbUser.id, AUDIT_ACTIONS.MENU_CHANGE_REQUESTED, {
      requestType: type,
      menuItemId:  menuItemId ?? null,
      name:        name ?? null,
      requestId:   request.id,
    })

    return success(request, 201)
  } catch (err) {
    return handleApiError(err)
  }
}

// GET /api/menu-requests?vendorId=xxx — list requests for a vendor (vendor auth)
// GET /api/menu-requests?eventId=xxx — list pending requests for an event (organizer auth)
export async function GET(req: NextRequest) {
  try {
    const clerkId = await requireAuth()
    const vendorId = req.nextUrl.searchParams.get('vendorId')
    const eventId = req.nextUrl.searchParams.get('eventId')

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    if (vendorId) {
      const isMember = await getVendorAuth(dbUser.id, vendorId, req)
      if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

      const requests = await db.menuRequest.findMany({
        where: { vendorId },
        orderBy: { createdAt: 'desc' },
        include: { menuItem: { select: { name: true } } },
      })
      return success(requests)
    }

    if (eventId) {
      // Verify organizer membership
      // Soft-deleted fair's menu-requests are not accessible.
      const event = await db.event.findFirst({ where: { id: eventId, archivedAt: null }, select: { organizerId: true } })
      if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
      if (event.organizerId) {
        const isOrg = await db.orgMember.findFirst({ where: { organizerId: event.organizerId, userId: dbUser.id } })
        if (!isOrg) return apiError('Access denied', 403, 'FORBIDDEN')
      }

      const requests = await db.menuRequest.findMany({
        where: { vendor: { eventId } },
        orderBy: { createdAt: 'desc' },
        include: {
          menuItem: { select: { name: true } },
          vendor: { select: { name: true } },
        },
      })
      return success(requests)
    }

    return apiError('vendorId or eventId is required', 400, 'VALIDATION_ERROR')
  } catch (err) {
    return handleApiError(err)
  }
}
