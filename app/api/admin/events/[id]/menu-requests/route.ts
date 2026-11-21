import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminMenuApprover } from '@/lib/menu-requests/admin-approver'
import { reviewPriceChange } from '@/lib/menu-requests/review-price'
import { pendingSizeCounts, sizeCountFor, newSizeOf } from '@/lib/menu-requests/size-groups'

// GET /api/admin/events/[id]/menu-requests
// The PENDING menu requests of a fair that has NO organizer, for a strict platform admin to
// decide (audit H5, 2g: the organizer approves; an admin only when there is no organizer).
// [id] may be the event id or urlSlug. A fair with an organizer, and any non-admin, get 404.
//
// Oldest first, with the item's current state and current → requested price, the same
// projection the organizer queue uses. At most 200 rows: an organizer-less fair is a small,
// platform-run event, and the queue is cleared as it is worked.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminMenuApprover(id)

    const requests = await db.menuRequest.findMany({
      where: { vendor: { eventId: event.id }, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
      include: {
        vendor: { select: { id: true, name: true } },
        menuItem: {
          select: {
            id: true, name: true, description: true, price: true,
            category: true, prepTime: true, imageUrl: true, isAvailable: true, removedAt: true,
          },
        },
      },
    })

    const sizesInGroup = await pendingSizeCounts({ vendor: { eventId: event.id } })

    return success({
      requests: requests.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        batchId: r.batchId,
        name: r.name,
        description: r.description,
        price: r.price,
        category: r.category,
        prepTime: r.prepTime,
        imageUrl: r.imageUrl,
        variantGroup: r.variantGroup,
        variantLabel: r.variantLabel,
        sizesInGroup: sizeCountFor(sizesInGroup, r),
        newSizeOf: newSizeOf(sizesInGroup, r),
        menuItemId: r.menuItemId,
        currentItem: r.menuItem ?? null,
        priceChange: reviewPriceChange(r),
        createdAt: r.createdAt,
        vendor: { id: r.vendor.id, name: r.vendor.name },
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
