import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'

// DELETE /api/organizer/fairs/[fairSlug]
// Soft-deletes (archives) a fair owned by the caller. Sets archivedAt — NEVER a hard
// delete — so orders, payouts, and vendor records are preserved and keep settling.
// The fair then vanishes from every customer + organizer view (the archivedAt:null
// read-sweep + resolveOwnedFair default), while its money-response routes
// (refund/chargeback) stay reachable via resolveOwnedFair({ includeArchived: true }).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> },
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    // Default resolver scopes { urlSlug, organizerId, archivedAt: null }: enforces
    // ownership AND 404s an already-archived fair, so a second DELETE is idempotent.
    const event = await resolveOwnedFair(fairSlug, organizerId)

    await db.event.update({
      where: { id: event.id },
      data: { archivedAt: new Date() },
    })

    // Fair-mutation → invalidate the organizer list + public caches (same pair the
    // create/settings routes use). Without this the deleted fair lingers in cache.
    revalidateTag(`organizer-fairs-${organizerId}`, 'default')
    revalidateTag('fair', 'default')

    return success({ deleted: true })
  } catch (err) {
    return handleApiError(err)
  }
}
