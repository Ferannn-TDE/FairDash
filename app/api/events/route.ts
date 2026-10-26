import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminAuth } from '@/lib/auth'

// GET /api/events
// Returns all events. Super-admin only.
export async function GET() {
  try {
    await requireAdminAuth()
    const events = await db.event.findMany({ orderBy: { startDate: 'desc' } })
    return success(events)
  } catch (err) {
    return handleApiError(err)
  }
}

// POST /api/events
// Creates a new event. Super-admin only.
export async function POST(req: Request) {
  try {
    await requireAdminAuth()
    const body = await req.json()
    const { name, urlSlug, startDate, endDate, status, primaryColor, eventLat, eventLng, stagingZoneLat, stagingZoneLng } = body

    if (!name || !urlSlug || !startDate || !endDate) {
      return apiError('name, urlSlug, startDate, and endDate are required', 400, 'VALIDATION_ERROR')
    }

    // A fair reaches customers only through Go Live (PATCH /api/admin/events/[id]/status), which
    // runs the checklist (vendors, Stripe, fulfillment, location, venue address). Creating one
    // straight as ACTIVE would skip all of it.
    if (status !== undefined && status !== 'UPCOMING' && status !== 'DRAFT') {
      return apiError('A new fair starts as UPCOMING or DRAFT; use Go Live to make it ACTIVE', 400, 'VALIDATION_ERROR')
    }

    const existing = await db.event.findUnique({ where: { urlSlug } })
    if (existing) return apiError('urlSlug already taken', 409, 'CONFLICT')

    const event = await db.event.create({
      data: {
        name,
        urlSlug,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: status ?? 'UPCOMING',
        primaryColor: primaryColor ?? '#FF0077',
        eventLat,
        eventLng,
        stagingZoneLat,
        stagingZoneLng,
      },
    })

    return success(event, 201)
  } catch (err) {
    return handleApiError(err)
  }
}
