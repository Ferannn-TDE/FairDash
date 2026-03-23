import { db } from '@/lib/db'
import { handleApiError } from '@/lib/api-error'

// GET /api/test-db
// Confirms PostgreSQL connectivity and returns row counts for seeded tables.
export async function GET() {
  try {
    const [eventCount, vendorCount, menuItemCount] = await Promise.all([
      db.event.count(),
      db.vendor.count(),
      db.menuItem.count(),
    ])

    return Response.json({
      status: 'connected',
      counts: { events: eventCount, vendors: vendorCount, menuItems: menuItemCount },
    })
  } catch (err) {
    return handleApiError(err)
  }
}
