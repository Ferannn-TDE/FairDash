import { db } from '@/lib/db'
import { success, apiError, paginated } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireVendorAuth } from '@/lib/auth'

// GET /api/menu?eventSlug=&vendorId=&category=&showAll=true&page=1&limit=40
// Returns available menu items, filterable by event, vendor, or category.
// showAll=true (vendor auth required) returns all items including unavailable ones.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const eventSlug = searchParams.get('eventSlug')
    const vendorId = searchParams.get('vendorId')
    const category = searchParams.get('category')
    const showAll = searchParams.get('showAll') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '40'))
    const skip = (page - 1) * limit

    // showAll requires vendor auth — only vendors can see their unavailable items
    if (showAll) await requireVendorAuth()

    // Build vendor filter
    let vendorIds: string[] | undefined
    if (vendorId) {
      vendorIds = [vendorId]
    } else if (eventSlug) {
      const event = await db.event.findUnique({ where: { urlSlug: eventSlug } })
      if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
      const vendors = await db.vendor.findMany({
        where: { eventId: event.id, status: 'ACTIVE', isOffline: false },
        select: { id: true },
      })
      vendorIds = vendors.map((v) => v.id)
    }

    const where = {
      ...(showAll ? {} : { isAvailable: true }),
      ...(vendorIds ? { vendorId: { in: vendorIds } } : {}),
      ...(category ? { category } : {}),
    }

    const [items, total] = await Promise.all([
      db.menuItem.findMany({
        where,
        skip,
        take: limit,
        include: { vendor: { select: { id: true, name: true, boothNumber: true, isOffline: true, eventId: true } } },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
      }),
      db.menuItem.count({ where }),
    ])

    return paginated(items, total, page, limit)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/menu
// Creates a menu item. Vendor auth required.
export async function POST(req: Request) {
  try {
    await requireVendorAuth()
    const body = await req.json()
    const { vendorId, name, description, price, category, imageUrl, prepTime } = body

    if (!vendorId || !name || price == null || !category) {
      return apiError('vendorId, name, price, and category are required', 400, 'VALIDATION_ERROR')
    }

    const vendor = await db.vendor.findUnique({ where: { id: vendorId } })
    if (!vendor) return apiError('Vendor not found', 404, 'NOT_FOUND')

    const item = await db.menuItem.create({
      data: {
        vendorId,
        name,
        description,
        price: Number(price),
        category,
        imageUrl,
        ...(prepTime != null && { prepTime: Number(prepTime) }),
      },
    })

    return success(item, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
