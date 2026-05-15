export const revalidate = 300

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'

// GET /api/vendors/:id/analytics?days=7|30|90
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

    const [periodOrders, todayOrders] = await Promise.all([
      db.order.findMany({
        where: { vendorId: id, placedAt: { gte: since } },
        select: { status: true, total: true, subtotal: true, placedAt: true },
      }),
      db.order.findMany({
        where: { vendorId: id, placedAt: { gte: todayStart } },
        select: { status: true, total: true },
      }),
    ])

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
          buckets[key].revenue += Number(o.total)
        }
      }
    }

    const chartData = Object.entries(buckets).map(([day, v]) => ({
      day,
      revenue: parseFloat(v.revenue.toFixed(2)),
      orders: v.orders,
    }))

    const completed = periodOrders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED')
    const totalRevenue = parseFloat(completed.reduce((s, o) => s + Number(o.total), 0).toFixed(2))
    const totalOrders = periodOrders.length
    const avgOrderValue = completed.length > 0 ? parseFloat((totalRevenue / completed.length).toFixed(2)) : 0
    const cancelled = periodOrders.filter(o => o.status === 'CANCELLED').length
    const completionRate = totalOrders > 0 ? parseFloat(((totalOrders - cancelled) / totalOrders).toFixed(4)) : 1

    const todayCompleted = todayOrders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED')
    const todayRevenue = parseFloat(todayCompleted.reduce((s, o) => s + Number(o.total), 0).toFixed(2))
    const pendingOrders = todayOrders.filter(o => ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)).length

    return success({
      chartData,
      totalRevenue,
      totalOrders,
      avgOrderValue,
      completionRate,
      todayRevenue,
      todayOrders: todayOrders.length,
      pendingOrders,
    })
  } catch (err) {
    return handleApiError(err)
  }
}
