import { db } from '@/lib/db'
import { success, apiError } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireRunnerAuth } from '@/lib/auth'
import { summarizeRunnerEarnings } from '@/lib/runner-earnings'
import { computeRunnerCompletionRate } from '@/lib/runner-completion'

// GET /api/runners/me/earnings
// The authenticated runner's earnings from the RunnerEarning ledger. Each row's
// amountCents = the runner's SHARE of the delivery/curbside fee (runnerFeePercent)
// + 100% of the tip — never the whole customer-paid fee (the organizer holds the
// other share). The shared summarizer decomposes each line (fee share + tip) and
// splits paid (transferred, has paidAt) from pending (transfers after the refund
// window) and held (admin freeze). Cancelled rows are listed but sum to nothing.
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

    const rows = await db.runnerEarning.findMany({
      where: { runnerId: runner.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        orderId: true, amountCents: true, status: true, paidAt: true, createdAt: true,
        order: { select: { tip: true, fulfillmentType: true } },
      },
    })

    const s = summarizeRunnerEarnings(rows)
    // Completion rate from the custody events: delivered / collected (a pre-collect release
    // never enters the denominator). Replaces the dead runner.completionRate default (1.0).
    const completion = await computeRunnerCompletionRate(runner.id)
    const d = (cents: number) => parseFloat((cents / 100).toFixed(2))

    return success({
      earnedTotal:  d(s.earnedTotalCents),
      earnedToday:  d(s.earnedTodayCents),
      paidTotal:    d(s.paidTotalCents),
      pendingTotal: d(s.pendingTotalCents),
      heldTotal:    d(s.heldTotalCents),
      deliveriesToday: s.deliveriesToday,
      // Derived from the RunnerEarning ledger (one row per delivered order, curbside included),
      // NOT the dead runner.totalCompleted counter (never incremented → always 0, which
      // contradicted "1 delivery today"). completionRate is set by the next commit (#4c).
      totalDeliveries: s.deliveriesTotal,
      completionRate:  completion.rate,
      recent: s.lines.slice(0, 25).map(l => ({
        orderId:  l.orderId,
        amount:   d(l.totalCents),
        feeShare: d(l.feeShareCents),
        tip:      d(l.tipCents),
        status:   l.status, // pending | held | paid | cancelled
        at:       l.at,
        paidAt:   l.paidAt,
      })),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
