import { EventStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { readinessWhereIfEnforced } from '@/lib/vendor-readiness'
import { demoHiddenWhere } from '@/lib/demo-vendor'
import { customerReachableScope } from '@/lib/event-listing'
import { PUBLIC_EVENT_SELECT } from '@/lib/public-event-select'
import { getCustomerFeeTerms } from '@/lib/fees/fee-terms'

// GET /api/events/:slug
// Returns a single event by its URL slug, with active vendor count.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    // Accept both URL slug and raw UUID so callers with only an eventId can also use this route
    const event = await db.event.findFirst({
      // Detail hydration for the public fair page — gate to live, non-archived so a
      // non-live fair is unreachable by slug OR raw id (matches getFairBySlugCached).
      where: { OR: [{ urlSlug: (await params).slug }, { id: (await params).slug }], status: EventStatus.ACTIVE, archivedAt: null, ...customerReachableScope() },
      // Public, no auth: the select is the boundary (audit M6). See lib/public-event-select.ts.
      select: {
        ...PUBLIC_EVENT_SELECT,
        _count: {
          select: {
            vendors: {
              // Aligns with the marketplace gate: when enforcement is on the badge
              // counts only orderable (ready) vendors — never "17" while 2 show.
              // Demo booths are not counted with live Stripe keys (lib/demo-vendor.ts).
              where: { status: 'ACTIVE', isOffline: false, ...readinessWhereIfEnforced(), ...demoHiddenWhere() },
            },
          },
        },
      },
    })

    if (!event) return apiError('Event not found', 404, 'NOT_FOUND')
    // Fee terms (item 10 stage 3): their own uncached read, null when the money settings can't be read.
    return success({ ...event, feeTerms: await getCustomerFeeTerms() })
  } catch (err) {
    return handleApiError(err)
  }
}
