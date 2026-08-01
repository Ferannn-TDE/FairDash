import type { PrismaClient, User } from '@prisma/client'
import { db } from './db'
import { logger } from './logger'

// ─── THE ONE PLACE A DB User ROW IS BROUGHT INTO EXISTENCE ────────────────────
//
// THE BUG THIS CLOSES (prod, 2026-08-01). Three hand-copies of
//
//     db.user.upsert({ where: { clerkId }, create: { …, email, … }, update: { … } })
//
// existed in app/onboarding/page.tsx, app/api/webhooks/clerk/route.ts and
// app/api/orders/route.ts. `User.clerkId` is @unique — but so is `User.email`, and the
// upsert keys ONLY on clerkId. So when a row already owns an email under a DIFFERENT
// clerkId, the `where` misses, execution falls through to `create`, and create collides
// on email: P2002, target ['email'], an uncaught 500.
//
// That state is reachable and was reached: a user deleted their Clerk account, the
// `user.deleted` webhook could not remove the row (Order_customerId_fkey is ON DELETE
// RESTRICT and they had 134 orders), and the row survived pointing at a clerkId that no
// longer resolves. Their next signup got a new clerkId → permanent 500 on /onboarding.
//
// THE DECISIVE DETAIL, worth keeping written down: the P2002 target was ['email'], not
// ['clerkId']. A race between two concurrent inserts for the SAME new user would collide
// on clerkId — the field both upserts key on. A collision on EMAIL can only mean a
// different row already owns it. No amount of upsert atomicity helps, because the
// conflicting column is not the one the upsert is written against. Hence: resolve by
// clerkId, then FALL BACK TO EMAIL and re-point, rather than inserting into a collision.
//
// ── THE IDENTITY MERGE IS A DECISION, NOT A MECHANICAL REPAIR ────────────────
// Re-pointing means a NEW Clerk identity inherits the existing row and everything hanging
// off it — orders, membership, audit history, money. For the case this was built for that
// is 134 orders and $2,769.91. It is the intended semantics (same human, same verified
// email, they deleted and recreated their login), but it is a judgement, so every re-point
// emits a WARN-level audit line naming old clerkId → new clerkId, the email, and the row id.
// It is deliberately warn, not info: lib/logger.ts drops info in production, and an identity
// merge that carries money must be visible in prod logs.
//
// ⛔ THIS FUNCTION NEVER TOUCHES User.id. ⛔
// Order.customerId → User.id, so leaving `id` alone is what preserves order attribution
// exactly. Re-pointing rewrites User.clerkId only. Nothing here reads, writes, or reasons
// about Order_customerId_fkey — relaxing that FK to make a delete "work" would SET NULL
// (impossible, non-nullable) or CASCADE (delete real orders and their earnings). Not a
// branch this code has.

/** Profile fields mirrored from Clerk onto the DB row. All optional but `email`. */
export interface EnsureDbUserProfile {
  email: string
  name?: string | null
  phone?: string | null
  avatarUrl?: string | null
  isActive?: boolean
  role?: string
}

export type EnsureDbUserOutcome =
  /** No row for this clerkId or email — a genuinely new person. */
  | 'created'
  /** The clerkId already resolved. The ordinary path. */
  | 'updated'
  /** No row for this clerkId, but `email` was owned by another row: re-pointed to the new
   *  clerkId in place. The identity merge. */
  | 'repointed'

export interface EnsureDbUserResult {
  user: User
  outcome: EnsureDbUserOutcome
  /** Set only on 'repointed' — the stale clerkId the row carried before. */
  previousClerkId?: string
}

/** Prisma client seam so suites can drive this against the isolated test database. */
type Db = PrismaClient | typeof db

/**
 * Resolve (or bring into existence) the DB User row for a Clerk identity.
 *
 * Resolution order — clerkId, then email, then create:
 *   1. `clerkId` hit  → update profile → 'updated'
 *   2. `email`  hit   → RE-POINT that row's clerkId (id untouched) → 'repointed'
 *   3. neither        → create → 'created'
 *
 * Idempotent: calling twice with the same input yields 'updated' the second time and never
 * a duplicate row. Concurrency-safe: a create that loses a race to a concurrent insert
 * (P2002 on either unique column) re-resolves once and takes the winner's row, matching the
 * repo's create-if-absent pattern (cf. lib/organizer-bootstrap.ts, app/api/drivers).
 *
 * @param syncProfile  When false, an existing row found BY CLERKID is returned untouched
 *                     (the checkout path's `update: {}` semantics — it must not overwrite a
 *                     real profile with whatever Clerk happened to hand back). A re-point
 *                     still writes clerkId + profile, because that row is being re-bound to
 *                     a new identity and stale contact details would be the wrong answer.
 */
export async function ensureDbUser(
  clerkId: string,
  profile: EnsureDbUserProfile,
  opts: { db?: Db; syncProfile?: boolean } = {},
): Promise<EnsureDbUserResult> {
  const prisma = (opts.db ?? db) as PrismaClient
  const syncProfile = opts.syncProfile !== false

  const data = {
    email: profile.email,
    ...(profile.name !== undefined ? { name: profile.name } : {}),
    ...(profile.phone !== undefined ? { phone: profile.phone } : {}),
    ...(profile.avatarUrl !== undefined ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.isActive !== undefined ? { isActive: profile.isActive } : {}),
    ...(profile.role !== undefined ? { role: profile.role } : {}),
  }

  // ── 1. The ordinary path: this clerkId already has a row. ──────────────────
  const byClerkId = await prisma.user.findUnique({ where: { clerkId } })
  if (byClerkId) {
    if (!syncProfile) return { user: byClerkId, outcome: 'updated' }
    const user = await prisma.user.update({ where: { id: byClerkId.id }, data })
    return { user, outcome: 'updated' }
  }

  // ── 2. The collision path: the email is owned by a row under another clerkId. ──
  const byEmail = await prisma.user.findUnique({ where: { email: profile.email } })
  if (byEmail) return repoint(prisma, byEmail, clerkId, data)

  // ── 3. Genuinely new. ──────────────────────────────────────────────────────
  try {
    const user = await prisma.user.create({ data: { clerkId, ...data } })
    return { user, outcome: 'created' }
  } catch (err) {
    // Lost a race to a concurrent create (P2002 on clerkId or email). Re-resolve ONCE and
    // take the winner's row; anything else is unexpected and rethrows.
    if (!isUniqueViolation(err)) throw err

    const raced = await prisma.user.findUnique({ where: { clerkId } })
    if (raced) {
      if (!syncProfile) return { user: raced, outcome: 'updated' }
      const user = await prisma.user.update({ where: { id: raced.id }, data })
      return { user, outcome: 'updated' }
    }

    const racedByEmail = await prisma.user.findUnique({ where: { email: profile.email } })
    if (racedByEmail) return repoint(prisma, racedByEmail, clerkId, data)

    throw err
  }
}

/** Re-bind an existing row to a new Clerk identity. Writes clerkId + profile; NEVER `id`. */
async function repoint(
  prisma: PrismaClient,
  existing: User,
  clerkId: string,
  data: Record<string, unknown>,
): Promise<EnsureDbUserResult> {
  const previousClerkId = existing.clerkId

  // Already bound to this identity (a concurrent re-point won) — nothing to merge.
  if (previousClerkId === clerkId) {
    const user = await prisma.user.update({ where: { id: existing.id }, data })
    return { user, outcome: 'updated' }
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { clerkId, ...data },
  })

  // THE AUDIT for the identity merge. warn, not info: info is dropped in production
  // (lib/logger.ts) and this line is the record that a Clerk identity inherited an existing
  // row's history. Deliberately emitted AFTER the write succeeded, so it never claims a
  // merge that did not happen.
  logger.warn('[ensureDbUser] IDENTITY RE-POINT — existing user row re-bound to a new Clerk id', {
    userId: user.id,
    email: user.email,
    previousClerkId,
    newClerkId: clerkId,
  })

  return { user, outcome: 'repointed', previousClerkId }
}

/** Prisma P2002 — unique constraint violation, on any column. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  )
}
