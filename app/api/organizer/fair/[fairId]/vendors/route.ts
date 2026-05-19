import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/organizer/fair/[fairId]/vendors
// Returns vendors for a specific fair (organizer must own this fair)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fairId: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { fairId } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const orgMember = await db.orgMember.findFirst({ where: { userId: dbUser.id } })
    if (!orgMember) return apiError('Not an organizer', 403, 'FORBIDDEN')

    // Verify this organizer owns this event
    const event = await db.event.findFirst({
      where: { id: fairId, organizerId: orgMember.organizerId },
    })
    if (!event) return apiError('Fair not found or access denied', 404, 'NOT_FOUND')

    const vendors = await db.vendor.findMany({
      where: { eventId: fairId },
      orderBy: { name: 'asc' },
      include: {
        orders: {
          where: { status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } },
          select: { vendorPayout: true, status: true },
        },
      },
    })

    const result = vendors.map(v => {
      const completed = v.orders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED')
      const revenue = completed.reduce((s, o) => s + Number(o.vendorPayout), 0)
      return {
        id: v.id,
        name: v.name,
        status: v.status,
        category: v.cuisineType,
        boothNumber: v.boothNumber,
        joinedAt: v.createdAt,
        orderCount: v.orders.length,
        revenue: parseFloat(revenue.toFixed(2)),
      }
    })

    return success({ vendors: result })
  } catch (err) {
    return handleApiError(err)
  }
}
