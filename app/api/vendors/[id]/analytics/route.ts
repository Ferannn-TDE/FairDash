export const revalidate = 300

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/:id/analytics?days=7|30|90
//
// Revenue is computed from OrderItem rows where vendorId = this vendor,
// so multi-vendor orders are correctly split — each vendor only sees
// revenue from their own items.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clerkId = await requireAuth()
    const { id } = await params

    const dbUser = await db.user.findUnique({ where: { clerkId } })
    if (!dbUser) return apiError('User not found', 404, 'NOT_FOUND')

    const isMember = await db.vendorMember.findFirst({
      where: { vendorId: id, userId: dbUser.id },
    })
    if (!isMember) return apiError('Access denied', 403, 'FORBIDDEN')

    const days = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)))

    const since = new Date()
    since.setDate(since.getDate() - (days - 1))
    since.setHours(0, 0, 0, 0)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Pull OrderItems for this vendor, joining to parent Order for status + date.
    // This is the source of truth for revenue — not Order.vendorPayout.
    const [periodItems, todayItems] = await Promise.all([
      db.orderItem.findMany({
        where: {
          vendorId: id,
          order: {
            placedAt: { gte: since },
            status: { not: 'PENDING_PAYMENT' },
          },
        },
        select: {
          unitPrice: true,
          quantity: true,
          order: { select: { id: true, status: true, placedAt: true } },
        },
      }),
      db.orderItem.findMany({
        where: {
          vendorId: id,
          order: {
            placedAt: { gte: todayStart },
            status: { not: 'PENDING_PAYMENT' },
          },
        },
        select: {
          unitPrice: true,
          quantity: true,
          order: {
            select: {
              id: true,
              status: true,
              vendorOrderStatuses: {
                where: { vendorId: id },
                select: { status: true },
              },
            },
          },
        },
      }),
    ])

    // Aggregate per order — each order appears once per item, so group first
    const periodOrderMap = new Map<string, { status: string; placedAt: Date; revenue: number }>()
    for (const item of periodItems) {
      const o = item.order
      if (!periodOrderMap.has(o.id)) {
        periodOrderMap.set(o.id, { status: o.status, placedAt: o.placedAt, revenue: 0 })
      }
      periodOrderMap.get(o.id)!.revenue += item.unitPrice * item.quantity
    }

    const todayOrderMap = new Map<string, { status: string; vendorStatus: string; revenue: number }>()
    for (const item of todayItems) {
      const o = item.order
      if (!todayOrderMap.has(o.id)) {
        const vendorStatus = o.vendorOrderStatuses[0]?.status ?? o.status
        todayOrderMap.set(o.id, { status: o.status, vendorStatus, revenue: 0 })
      }
      todayOrderMap.get(o.id)!.revenue += item.unitPrice * item.quantity
    }

    const periodOrders = [...periodOrderMap.values()]
    const todayOrders = [...todayOrderMap.values()]

    // Build daily chart buckets
    const buckets: Record<string, { revenue: number; orders: number }> = {}
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      buckets[key] = { revenue: 0, orders: 0 }
    }

    for (const o of periodOrders) {
      const key = new Date(o.placedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      if (buckets[key]) {
        buckets[key].orders += 1
        if (o.status === 'COMPLETED' || o.status === 'DELIVERED') {
          buckets[key].revenue += o.revenue
        }
      }
    }

    const chartData = Object.entries(buckets).map(([day, v]) => ({
      day,
      revenue: parseFloat(v.revenue.toFixed(2)),
      orders: v.orders,
    }))

    const completed = periodOrders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED')
    const cancelled = periodOrders.filter(o => o.status === 'CANCELLED')
    const totalRevenue = parseFloat(completed.reduce((s, o) => s + o.revenue, 0).toFixed(2))
    const totalOrders = periodOrders.length - cancelled.length
    const avgOrderValue = completed.length > 0 ? parseFloat((totalRevenue / completed.length).toFixed(2)) : 0
    const terminal = completed.length + cancelled.length
    const completionRate = terminal > 0
      ? parseFloat((completed.length / terminal).toFixed(4))
      : 1

    // Use vendorStatus for today's stats — master order.status stays non-terminal
    // until all vendors complete, so it undercounts revenue in multi-vendor orders.
    const todayCompleted = todayOrders.filter(o =>
      o.vendorStatus === 'COMPLETED' || o.vendorStatus === 'DELIVERED'
    )
    const todayRevenue = parseFloat(todayCompleted.reduce((s, o) => s + o.revenue, 0).toFixed(2))

    return success({
      chartData,
      totalRevenue,
      totalOrders,
      avgOrderValue,
      completionRate,
      todayRevenue,
      todayOrders: todayOrders.length,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
