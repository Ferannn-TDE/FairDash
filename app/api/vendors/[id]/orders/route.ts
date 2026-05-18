import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/:id/orders?since=ISO_DATE&limit=100
// Returns orders for this vendor, used by the vendor dashboard as an initial
// REST load when Firebase is unavailable or on first render.
// Caller must be a VendorMember of this vendor.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await db.vendorMember.findFirst({
      where: { vendorId: (await params).id, userId: dbUser.id },
    })
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const { searchParams } = new URL(req.url)
    const sinceRaw = searchParams.get('since')
    const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100'))

    // No since param → return all-time history (orders page is a history view)
    // since=today → start of today UTC (used by dashboard live view)
    const sinceFilter: Date | undefined = sinceRaw === 'today'
      ? (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d })()
      : sinceRaw
      ? new Date(sinceRaw)
      : undefined

    const orders = await db.order.findMany({
      where: {
        vendorId: (await params).id,
        status: { not: 'PENDING_PAYMENT' },
        ...(sinceFilter ? { placedAt: { gte: sinceFilter } } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: limit,
      include: {
        orderItems: {
          include: { menuItem: { select: { name: true } } },
        },
      },
    })

    return success({ orders })
  } catch (err) {
    return handleApiError(err)
  }
}
