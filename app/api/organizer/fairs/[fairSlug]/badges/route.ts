import { NextRequest } from 'next/server'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

async function computeBadges(eventId: string) {
  const [menuRequests, disputes] = await Promise.all([
    db.menuRequest.count({ where: { vendor: { eventId }, status: 'PENDING' } }),
    db.dispute.count({ where: { vendor: { eventId }, status: { in: ['OPEN', 'ESCALATED'] } } }),
  ])
  return { menuRequests, disputes }
}

// GET /api/organizer/fairs/[fairSlug]/badges
// Returns counts for sidebar badge indicators: pending menu requests + open disputes.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const cached = unstable_cache(
      () => computeBadges(event.id),
      [`org-badges-${event.id}`],
      { revalidate: 30, tags: [`event-badges-${event.id}`] }
    )
    return success(await cached())
  } catch (err) {
    return handleApiError(err)
  }
}
