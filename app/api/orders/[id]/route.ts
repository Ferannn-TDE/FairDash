import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/orders/:id — fetch a single order with full detail.
// Accessible by the order's customer OR any VendorMember of the order's vendor.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    const order = await db.order.findUnique({
      where: { id: (await params).id },
      include: {
        vendor: { select: { id: true, name: true, boothNumber: true } },
        orderItems: {
          include: {
            menuItem: { select: { name: true, imageUrl: true, category: true, prepTime: true } },
            vendor: { select: { id: true, name: true, boothNumber: true } },
          },
        },
        vendorOrderStatuses: {
          select: {
            vendorId: true,
            status: true,
            acceptedAt: true,
            preparingAt: true,
            readyAt: true,
            completedAt: true,
            declinedAt: true,
            vendor: { select: { name: true } },
          },
        },
        cancellation: true,
      },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // Verify caller is either the customer or a vendor member
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const isCustomer = order.customerId === dbUser.id
    const isVendorMember = await db.vendorMember.findFirst({
      where: { vendorId: order.vendorId, userId: dbUser.id },
    })

    if (!isCustomer && !isVendorMember) {
      return apiError('Access denied', 403, 'FORBIDDEN')
    }

    return success(order)
  } catch (err) {
    return handleApiError(err)
  }
}
