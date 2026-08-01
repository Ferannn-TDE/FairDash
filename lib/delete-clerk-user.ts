import type { PrismaClient, User } from '@prisma/client'
import { db } from './db'
import { logger } from './logger'

// ─── HANDLING A DELETED CLERK ACCOUNT ─────────────────────────────────────────
//
// THE BUG THIS CLOSES (prod, 2026-08-01). The `user.deleted` webhook hard-deleted the DB
// row:
//
//     await db.user.delete({ where: { clerkId: event.data.id } })
//
// `Order.customerId` is the ONE User relation in the schema without an onDelete clause —
// every other one is Cascade or SetNull — so the DB constraint is:
//
//     Order_customerId_fkey … ON DELETE RESTRICT      (migration 20260403005337, line 553)
//
// Which makes that delete STRUCTURALLY IMPOSSIBLE for any user who has ever placed an
// order. Not a handler with a bug — a handler that cannot run, for exactly the population
// whose deletion matters. It had never succeeded for a real customer. It threw, the route
// returned 500, svix retried, and the row was left orphaned: alive, but carrying a clerkId
// that no longer resolves. That orphan is what then broke the user's next signup.
//
// ⛔ THE FK IS NOT THE FIX. ⛔
// Relaxing Order_customerId_fkey is the wrong branch and is called out here so nobody
// reaches for it later: SET NULL cannot work (`customerId` is non-nullable) and CASCADE
// would delete real orders — for the account that triggered this, 134 of them, 57
// non-terminal, along with their earnings and payout rows. Order attribution is not
// negotiable to make a webhook return 200.
//
// WHAT WE DO INSTEAD:
//   • has orders  → SOFT-delete. isActive=false, and that is all. The row, its id, and
//                   every Order pointing at that id are untouched.
//   • no orders   → hard delete (unchanged behaviour; Cascade/SetNull relations follow).
//   • never throws for the structurally-impossible case — a 500 to svix on an operation
//     that can never succeed is an infinite retry loop, not an error report.
//
// The stale clerkId is deliberately LEFT AS-IS rather than tombstoned. It does not need to
// be freed: ensureDbUser resolves by email as its second step, so a re-signup on the same
// address re-points this very row (and restores isActive from the fresh Clerk profile).
// Nulling or rewriting clerkId would be a destructive write that buys nothing.

export type DeleteClerkUserOutcome =
  /** No DB row for this clerkId — nothing to do. */
  | 'absent'
  /** No orders: row hard-deleted, cascades followed. */
  | 'deleted'
  /** Has orders: row retained, isActive=false. Order attribution preserved. */
  | 'soft_deleted'

export interface DeleteClerkUserResult {
  outcome: DeleteClerkUserOutcome
  userId?: string
  orderCount?: number
}

type Db = PrismaClient | typeof db

/**
 * Apply a Clerk `user.deleted` event to the DB. Never throws for the FK-restricted case.
 *
 * @param clerkId  the deleted Clerk account id.
 */
export async function softDeleteClerkUser(
  clerkId: string,
  opts: { db?: Db } = {},
): Promise<DeleteClerkUserResult> {
  const prisma = (opts.db ?? db) as PrismaClient

  const existing: User | null = await prisma.user.findUnique({ where: { clerkId } })
  if (!existing) return { outcome: 'absent' }

  // The FK that decides which branch. Counted, not guessed — the whole failure was a delete
  // issued without asking this question.
  const orderCount = await prisma.order.count({ where: { customerId: existing.id } })

  if (orderCount > 0) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: false },
    })
    logger.warn('[clerk:user.deleted] SOFT-deleted — user has orders, row retained', {
      userId: existing.id,
      email: existing.email,
      clerkId,
      orderCount,
    })
    return { outcome: 'soft_deleted', userId: existing.id, orderCount }
  }

  await prisma.user.delete({ where: { id: existing.id } })
  logger.warn('[clerk:user.deleted] hard-deleted — user had no orders', {
    userId: existing.id,
    email: existing.email,
    clerkId,
  })
  return { outcome: 'deleted', userId: existing.id, orderCount: 0 }
}
