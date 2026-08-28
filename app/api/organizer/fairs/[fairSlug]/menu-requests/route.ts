import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveOwnedFair } from '@/lib/organizer-fair-context'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { MenuRequestStatus } from '@prisma/client'

const ALL_STATUSES: MenuRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

// GET /api/organizer/fairs/[fairSlug]/menu-requests?status=PENDING&take=50&cursor=<id>
// Returns menu change requests FIFO (oldest first) with vendor info and current menuItem
// snapshot for EDIT diff rendering.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fairSlug: string }> }
) {
  try {
    const { organizerId } = await requireOrganizerAuth()
    const { fairSlug } = await params

    const event = await resolveOwnedFair(fairSlug, organizerId)

    const { searchParams } = req.nextUrl
    const take        = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 100)
    const cursor      = searchParams.get('cursor') ?? undefined
    const statusParam = searchParams.get('status') as MenuRequestStatus | null
    const statusFilter = statusParam && ALL_STATUSES.includes(statusParam)
      ? [statusParam]
      : ALL_STATUSES

    const requests = await db.menuRequest.findMany({
      where: {
        vendor: { eventId: event.id },
        status: { in: statusFilter },
      },
      // FIFO — oldest pending first. The `id` tiebreak makes the order TOTAL, and it is
      // load-bearing for the cursor below, not decoration.
      //
      // Prisma compiles `cursor` into a WHERE on the orderBy VALUES — verified against the
      // emitted SQL, it is literally
      //     AND "createdAt" >= (SELECT "createdAt" FROM "MenuRequest" WHERE id = $cursor)
      // and it then slices relative to the cursor row's position WITHIN that result. So with a
      // non-unique sort key every tied row satisfies the predicate, and the page boundary is
      // only as stable as the order Postgres happens to return those tied rows in.
      //
      // Which is not stable. SQL guarantees no order among ties, and an UPDATE moves a row
      // under MVCC (a new version is written at the heap tail), so the tie order genuinely
      // differs between the page-1 and page-2 queries once any row has been touched. Approving
      // a request IS an update, and approving while paging through the queue is simply how this
      // screen is used — so the two halves of the bug meet in the ordinary workflow.
      //
      // Ties are not hypothetical either: rows written in ONE transaction share that
      // transaction's timestamp, so a batched submission produces N rows with an IDENTICAL
      // createdAt. `id` is unique, so appending it fixes the order and makes the cursor exact.
      //
      // scripts/menu-request-pagination-guard.ts reproduces the duplicate against the old
      // single-key sort (approve one row mid-walk) before trusting that this sort is clean.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        vendor: { select: { id: true, name: true } },
        // For EDIT/DELETE: include current item state so UI can show before/after diff
        menuItem: {
          select: {
            id: true, name: true, description: true, price: true,
            category: true, prepTime: true, imageUrl: true, isAvailable: true,
          },
        },
      },
    })

    const result = requests.map(r => ({
      id: r.id,
      type: r.type,
      status: r.status,
      // Proposed (new) values
      name: r.name,
      description: r.description,
      price: r.price,
      category: r.category,
      prepTime: r.prepTime,
      imageUrl: r.imageUrl,
      // Linked item (current state for diff)
      menuItemId: r.menuItemId,
      currentItem: r.menuItem ?? null,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      vendor: { id: r.vendor.id, name: r.vendor.name },
    }))

    const nextCursor = requests.length === take ? requests[requests.length - 1].id : null

    return success({ requests: result, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
