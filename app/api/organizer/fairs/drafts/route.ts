import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { organizerDraftScope } from '@/lib/organizer-fair-context'

// GET /api/organizer/fairs/drafts
//
// The ONLY list read that returns DRAFT fairs. Every other organizer list goes through
// organizerFairScope(), which excludes them — see that function for why the exclusion is one
// fragment rather than a clause repeated per route.
//
// NO COUNTS. A draft has no vendors and no orders BY CONSTRUCTION (the acquisition gate refuses
// both, which is what makes discard-by-hard-delete safe), so there is nothing to aggregate here.
// Deliberately not a copy of the My Fairs payload: rendering "0 vendors · 0 orders" on a draft
// invites someone to wire the real aggregates in later and quietly put drafts back into the
// counts this whole change exists to keep them out of.
export async function GET(_req: NextRequest) {
  try {
    const { organizerId } = await requireOrganizerAuth()

    const drafts = await db.event.findMany({
      where: organizerDraftScope(organizerId),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, urlSlug: true,
        startDate: true, endDate: true, createdAt: true,
        venueCity: true, venueState: true,
      },
    })

    return success({
      drafts: drafts.map(d => ({
        id: d.id,
        name: d.name,
        slug: d.urlSlug,
        startDate: d.startDate,
        endDate: d.endDate,
        createdAt: d.createdAt,
        location: [d.venueCity, d.venueState].filter(Boolean).join(', ') || null,
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
