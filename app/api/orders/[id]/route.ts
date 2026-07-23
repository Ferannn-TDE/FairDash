import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import { getVendorAuth } from '@/lib/vendor-auth-cache'

// GET /api/orders/:id — fetch a single order with full detail.
// Accessible by the order's customer OR any VendorMember of the order's vendor.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()

    const rawId = (await params).id
    // Accept either the full cuid or the 8-char shortId (last 8 chars, uppercased)
    const order = await db.order.findFirst({
      where: rawId.length <= 8
        ? { id: { endsWith: rawId.toLowerCase() } }
        : { id: rawId },
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
        // Delivered-time for the customer timeline. RunnerEarning is created in the SAME
        // DELIVERED transition that accrues the runner's earning, so its createdAt is the
        // honest delivery timestamp — deliberately NOT Order.completedAt, which stays null on
        // DELIVERED orders because reconciler Pattern C/S treat that null as load-bearing
        // (a delivered order is kept out of their completedAt-windowed payout/restore scans).
        runnerEarning: { select: { createdAt: true } },
      },
    })

    if (!order) return apiError('Order not found', 404, 'ORDER_NOT_FOUND')

    // Verify caller is either the customer or a vendor member
    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')

    const isCustomer = order.customerId === dbUser.id
    // Check all vendorIds present in this order's items (multi-vendor orders have N vendors)
    const vendorIds = [...new Set(order.orderItems.map(i => i.vendorId))]
    // Fan-out cache check — resolves as soon as any vendor membership is confirmed
    const isVendorMember = vendorIds.length > 0
      ? await Promise.any(vendorIds.map(vid => getVendorAuth(dbUser.id, vid, req).then(m => m ?? Promise.reject())))
          .catch(() => null)
      : null

    if (!isCustomer && !isVendorMember) {
      return apiError('Access denied', 403, 'FORBIDDEN')
    }

    // Driver card (tracking view): the runner's display identity only — the User's name, and
    // the runner's delivery-contact phone (Runner.phone, the field the settings PATCH writes —
    // NOT User.phone, the Clerk account number). Order has no runner relation (runnerId is a
    // bare column), so this is a separate lookup; nothing else from the runner row leaves here.
    // PII note: exposing this number to the customer is a recorded decision — docs/PII_DECISIONS.md.
    const runner = order.runnerId
      ? await db.runner.findUnique({
          where: { id: order.runnerId },
          select: { phone: true, user: { select: { name: true } } },
        })
      : null

    return success({ ...order, runner })
  } catch (err) {
    return handleApiError(err)
  }
}
