import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
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

    const event = await db.event.findFirst({
      where: { urlSlug: fairSlug, organizerId },
      select: { id: true },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

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
      orderBy: { createdAt: 'asc' },  // FIFO — oldest pending first
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
