import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { listStrandedForEvent } from '@/lib/strand-escalation'

// GET /api/admin/events/:id/stranded  — Commit 2, U5 (organizer/admin escalation surface)
//
// The stranded orders for one fair, each carrying its HANDLE — the party and the action the
// strand reason names (release / refund / await-vendor), so the surface presents the resolution,
// not just a list of problems. Read-only; the actions have their own routes.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)
    const stranded = await listStrandedForEvent(event.id)
    return success({ stranded })
  } catch (err) {
    return handleApiError(err)
  }
}
