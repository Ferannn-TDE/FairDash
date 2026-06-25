import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'

// GET /api/runners/me/earnings
// The authenticated runner's TRACKED earnings (from RunnerEarning, sourced from
// each delivery's customer-paid delivery fee). Display only — these are tracked,
// not yet paid (runner payout is a separate money-flow phase). NO tips: there is
// no tip data model, so we never show a tips figure (it would be fabricated).
export async function GET() {
  try {
    const clerkId = await requireRunnerAuth()
    const dbUser = await db.user.findUnique({ where: { clerkId }, select: { id: true } })
    if (!dbUser) return apiError('User not found', 404, 'USER_NOT_FOUND')
    const runner = await db.runner.findUnique({
      where: { userId: dbUser.id },
      select: { id: true, completionRate: true, totalCompleted: true, totalDispatched: true },
    })
    if (!runner) return apiError('No runner record found', 404, 'RUNNER_NOT_FOUND')

    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)

    const earnings = await db.runnerEarning.findMany({
      where: { runnerId: runner.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { orderId: true, amountCents: true, status: true, createdAt: true },
    })

    const totalCents  = earnings.reduce((s, e) => s + e.amountCents, 0)
    const todayCents  = earnings.filter(e => e.createdAt >= startOfToday).reduce((s, e) => s + e.amountCents, 0)
    const todayCount  = earnings.filter(e => e.createdAt >= startOfToday).length

    return success({
      // All amounts are TRACKED (not yet paid) — the UI must label them so.
      trackedTotal:   parseFloat((totalCents / 100).toFixed(2)),
      trackedToday:   parseFloat((todayCents / 100).toFixed(2)),
      deliveriesToday: todayCount,
      totalDeliveries: runner.totalCompleted,
      completionRate:  runner.completionRate,
      recent: earnings.slice(0, 25).map(e => ({
        orderId: e.orderId,
        amount:  parseFloat((e.amountCents / 100).toFixed(2)),
        status:  e.status, // 'tracked'
        at:      e.createdAt,
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
