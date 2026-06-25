import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireOrganizerAuth } from '@/lib/auth'
import { DisputeStatus } from '@prisma/client'

const ALL_STATUSES: DisputeStatus[] = ['OPEN', 'RESOLVED', 'ESCALATED']

// GET /api/organizer/fairs/[fairSlug]/disputes?status=OPEN&take=50&cursor=<id>
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
    const take   = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '50', 10)), 100)
    const cursor = searchParams.get('cursor') ?? undefined
    const statusParam = searchParams.get('status') as DisputeStatus | null
    const statusFilter = statusParam && ALL_STATUSES.includes(statusParam)
      ? [statusParam]
      : ALL_STATUSES

    const disputes = await db.dispute.findMany({
      where: {
        vendor: { eventId: event.id },
        status: { in: statusFilter },
      },
      orderBy: { submittedAt: 'desc' },
      take,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      include: {
        vendor: { select: { id: true, name: true, boothNumber: true } },
        order: {
          select: {
            id: true,
            status: true,
            total: true,
            placedAt: true,
            customerName: true,
          },
        },
      },
    })

    const result = disputes.map(d => ({
      id: d.id,
      reason: d.reason,
      evidence: d.evidence,
      status: d.status,
      submittedAt: d.submittedAt,
      resolvedAt: d.resolvedAt,
      resolution: d.resolution,
      vendorId: d.vendor.id,
      vendorName: d.vendor.name,
      boothNumber: d.vendor.boothNumber,
      orderId: d.order.id,
      orderStatus: d.order.status,
      orderTotal: d.order.total,
      orderPlacedAt: d.order.placedAt,
      customerName: d.order.customerName,
    }))

    const nextCursor = disputes.length === take ? disputes[disputes.length - 1].id : null

    return success({ disputes: result, nextCursor })
  } catch (err) {
    return handleApiError(err)
  }
}
