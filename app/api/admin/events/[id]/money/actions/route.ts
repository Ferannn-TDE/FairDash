import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success } from '@/lib/api-response'
import { handleApiError } from '@/lib/api-error'
import { requireAdminFairContext } from '@/lib/admin-fair-context'

// GET /api/admin/events/[id]/money/actions
//
// The money AUDIT TRAIL, paginated and filterable. Deliberately a SEPARATE endpoint from
// /money: that route computes the ledgers and balances, and this one reads AdminMoneyAction
// rows. Keeping them apart means adding search/pagination here cannot perturb a money
// derivation — the /money response (including its existing `recentAdminActions` slice) is
// untouched, so nothing that already consumes it changes behavior.
//
// The problem it fixes: /money returns `take: 50` with no total and no cursor, so the audit
// list silently truncated at 50 — the same class as the order log's 100-cap, on the surface
// where "did anyone touch this money?" must be answerable completely.
//
// Authorization is the proven chokepoint (requireAdminFairContext), and every row is scoped to
// the resolved event.id — this endpoint never widens who can see what.

const PAGE_TAKE = 50

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { event } = await requireAdminFairContext(id)

    const sp = req.nextUrl.searchParams
    const take = Math.min(Math.max(1, parseInt(sp.get('take') ?? String(PAGE_TAKE), 10)), PAGE_TAKE)
    const cursor = sp.get('cursor') ?? undefined
    const actorType = sp.get('actorType') ?? undefined   // admin | organizer | reconciler | system
    const action = sp.get('action') ?? undefined         // HOLD | RELEASE | CANCEL | FREEZE | UNFREEZE
    const payeeType = sp.get('payeeType') ?? undefined   // vendor | runner | organizer
    const q = sp.get('q')?.trim()

    // Search spans the identifiers an admin actually has to hand: the order short code (the
    // lowercased id tail, same convention as the order log), the payee id, and the actor.
    const searchWhere = q ? {
      OR: [
        { orderId: { contains: q.toLowerCase() } },
        { payeeId: { contains: q.toLowerCase() } },
        { actorId: { contains: q, mode: 'insensitive' as const } },
        { reason:  { contains: q, mode: 'insensitive' as const } },
      ],
    } : {}

    const where = {
      eventId: event.id,
      ...(actorType ? { actorType } : {}),
      ...(action ? { action } : {}),
      ...(payeeType ? { payeeType } : {}),
      ...searchWhere,
    }

    const [actions, total, actorTypeCounts] = await Promise.all([
      db.adminMoneyAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        cursor: cursor ? { id: cursor } : undefined,
        skip: cursor ? 1 : 0,
      }),
      db.adminMoneyAction.count({ where }),
      // Per-actor counts within the CURRENT filter scope, so a filter chip is honest about
      // what selecting it would show.
      db.adminMoneyAction.groupBy({ by: ['actorType'], where, _count: { id: true } }),
    ])

    return success({
      actions,
      nextCursor: actions.length === take ? actions[actions.length - 1].id : null,
      total,
      actorCounts: Object.fromEntries(actorTypeCounts.map(g => [g.actorType, g._count.id])),
    })
  } catch (err) {
    return handleApiError(err)
  }
}
