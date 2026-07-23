import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'
import { computeRunnerCompletionRates } from '@/lib/runner-completion'
import { RUNNER_COMPLETION_MIN_DENOMINATOR } from '@/lib/constants'

// GET /api/admin/events/[id]/runners
// Returns the runner roster for the event. [id] may be the event UUID or urlSlug.
//
// Stats are DERIVED per request from the custody events (lib/runner-completion — one batched
// query for the whole roster, scoped to THIS event via order.eventId), never read from the
// dead Runner counter columns (deprecated in schema.prisma: no write site ever existed; they
// sat at their defaults while real deliveries happened, and fed a <90% warning banner that
// could never fire). `scored` is the ONE copy of the minimum-denominator predicate: below the
// floor the page shows raw counts with "not enough deliveries" — no percentage, no banner.
// runner-stats-source-guard pins all of this (including that those column names never
// reappear in app/ or lib/ — which is why this comment doesn't name them).

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const { searchParams } = new URL(req.url)
    const take = Math.min(Math.max(1, parseInt(searchParams.get('take') ?? '200', 10)), 500)

    const runners = await db.runner.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      take,
      select: {
        id: true,
        status: true,
        approvalStatus: true,
        rejectionReason: true,
        createdAt: true,
        eventId: true,
        user: { select: { name: true, email: true } },
      },
    })

    const stats = await computeRunnerCompletionRates(runners.map(r => r.id), { eventId: event.id })

    return success({
      runners: runners.map(r => {
        const s = stats.get(r.id)!
        return {
          ...r,
          collected: s.collected,
          delivered: s.delivered,
          completionRate: s.rate,
          scored: s.collected >= RUNNER_COMPLETION_MIN_DENOMINATOR,
        }
      }),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
