// PENDING SIZE GROUPS — for the review screens (H5 Fix B; F4, Nov 13).
//
// A brand-new item's sizes are PENDING ADD requests sharing a variantGroup, and approving or
// rejecting one decides them all (lib/menu-requests/apply-decision.ts). The organizer queue and the
// admin panel show each size as its own card, so each card says how many sizes the decision covers.
//
// A new size of an item that is already LIVE (F4) is decided on its own, so its card gets no count;
// it is marked as a new size of that item instead. So is a new size whose item has since been
// removed (an orphaned new size): it can only be rejected (apply-decision.ts refuses to approve it).

import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { ON_MENU } from '../menu/on-menu'
import { CHANGE_KIND } from '../menu-notify/constants'
import { ApiError } from '../api-error'

const key = (vendorId: string, variantGroup: string) => `${vendorId}::${variantGroup}`

/**
 * THE ONE DEFINITION of "this vendor's size group has a live item" (F4): a MenuItem of the vendor
 * in that variantGroup that is still on the menu. Filing (file-item.ts), deciding
 * (apply-decision.ts) and the review cards (below) all classify "new size of a live item" through
 * this, so they cannot drift apart.
 */
export function liveSizeGroupWhere(vendorId: string, variantGroup: string) {
  return { vendorId, variantGroup, ...ON_MENU }
}

/** Postgres "lock_not_available" (55P03): the lock_timeout set in lockVendorMenu ran out. Prisma
 *  wraps a failed raw query, carrying the Postgres code in `meta.code` or in its message. */
function isLockTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if ((err as { meta?: { code?: unknown } }).meta?.code === '55P03') return true
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message.includes('55P03')
}

/**
 * ONE VENDOR'S MENU CHANGES RUN ONE AT A TIME (ultrareview P7 finding 4, 2026-11-21). Call first
 * thing inside the transaction of every menu-request filing (app/api/menu-requests/route.ts) and
 * every approval (apply-decision.ts). pg_advisory_xact_lock is TRANSACTION-scoped: Postgres
 * releases it when that transaction ends, on COMMIT and on ROLLBACK alike (an error included),
 * so there is no unlock to forget. Never use the session-level pg_advisory_lock here. One lock per
 * transaction, always the same key shape, so two transactions cannot deadlock on it.
 *
 * A BOUNDED WAIT (Step 12 finding 2, 2026-11-22). The wait for the lock is capped at 8 s with
 * lock_timeout; `true` makes the setting last only until this transaction ends. Past 8 s Postgres
 * cancels the wait (55P03) and the caller gets a named, retryable 503 MENU_BUSY instead of an
 * anonymous 500; the transaction rolls back and nothing is written. Both transactions that call
 * this allow 20 s (and their routes maxDuration 30), so this answer always comes first. The cap
 * covers every lock wait in the transaction, which is harmless: holding the vendor lock, no other
 * menu change of this vendor can be holding its rows.
 *
 * Tagged $executeRaw only, never the Unsafe raw variants (Jordan; test row [16b]). $executeRaw, not
 * $queryRaw: pg_advisory_xact_lock returns void, which a query result can't map.
 */
export async function lockVendorMenu(tx: Prisma.TransactionClient, vendorId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '8s', true)`
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`menu:${vendorId}`}))`
  } catch (err) {
    if (isLockTimeout(err)) throw new ApiError('This menu is busy right now — please try again in a moment.', 503, 'MENU_BUSY')
    throw err
  }
}

/**
 * WHICH OF THESE REQUESTS WERE FILED AS A NEW SIZE (F4)? Filing a new size of a live item records
 * a PRICE_PENDING notice with reason NEW_SIZE naming the request, in the same transaction
 * (file-item.ts fileNewSize); a brand-new item's sizes record none. The one test the removal
 * close, the group approval and the review cards all use. Callers ask only about sized ADDs whose
 * group has NO live row: in a live group every pending sized ADD is a new size anyway.
 */
export async function filedAsNewSize(
  client: Pick<Prisma.TransactionClient, 'menuChangeEvent'>,
  requestIds: string[],
): Promise<Set<string>> {
  if (requestIds.length === 0) return new Set()
  const rows = await client.menuChangeEvent.findMany({
    where: { menuRequestId: { in: requestIds }, kind: CHANGE_KIND.PRICE_PENDING, payload: { path: ['reason'], equals: 'NEW_SIZE' } },
    select: { menuRequestId: true },
  })
  return new Set(rows.map(r => r.menuRequestId).filter((id): id is string => id !== null))
}

export interface PendingSizeGroups {
  /** Count of PENDING ADD sizes per (vendor, variantGroup), not counting rows filed as new sizes. */
  counts: Map<string, number>
  /** The (vendor, variantGroup) pairs that already have a live item: their pending sizes are new sizes. */
  live: Set<string>
  /** Pending rows filed as a new size whose group has no live item left (orphaned new sizes). */
  orphanedNewSizes: Set<string>
}

/** Pending ADD sizes per (vendor, variantGroup) within `scope` (e.g. one fair), and which groups are live. */
export async function pendingSizeCounts(scope: Prisma.MenuRequestWhereInput): Promise<PendingSizeGroups> {
  const rows = await db.menuRequest.findMany({
    where: { ...scope, type: 'ADD', status: 'PENDING', variantGroup: { not: null } },
    select: { id: true, vendorId: true, variantGroup: true },
  })
  const groups = [...new Map(rows.map(r => [key(r.vendorId, r.variantGroup as string), r])).values()]
  const liveItems = groups.length === 0 ? [] : await db.menuItem.findMany({
    where: { OR: groups.map(r => liveSizeGroupWhere(r.vendorId, r.variantGroup as string)) },
    select: { vendorId: true, variantGroup: true },
  })
  const live = new Set(liveItems.map(i => key(i.vendorId, i.variantGroup as string)))
  // Only rows in a group with no live item can be either a brand-new item's size or an orphaned
  // new size; only those need the marker lookup.
  const orphanedNewSizes = await filedAsNewSize(db,
    rows.filter(r => !live.has(key(r.vendorId, r.variantGroup as string))).map(r => r.id))
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (orphanedNewSizes.has(r.id)) continue
    const k = key(r.vendorId, r.variantGroup as string)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return { counts, live, orphanedNewSizes }
}

type SizeRow = { id: string; type: string; status: string; vendorId: string; variantGroup: string | null }

const isPendingSize = (r: SizeRow): r is SizeRow & { variantGroup: string } =>
  r.type === 'ADD' && r.status === 'PENDING' && r.variantGroup !== null

/** How many sizes deciding this row decides, or null when it is not a pending size of a new item. */
export function sizeCountFor(groups: PendingSizeGroups, r: SizeRow): number | null {
  if (!isPendingSize(r) || groups.live.has(key(r.vendorId, r.variantGroup)) || groups.orphanedNewSizes.has(r.id)) return null
  return groups.counts.get(key(r.vendorId, r.variantGroup)) ?? null
}

/** The item (its size group's name) this pending row adds a size to, or null (F4). */
export function newSizeOf(groups: PendingSizeGroups, r: SizeRow): string | null {
  if (!isPendingSize(r)) return null
  return groups.live.has(key(r.vendorId, r.variantGroup)) || groups.orphanedNewSizes.has(r.id) ? r.variantGroup : null
}

/** True for a new size whose item is no longer on the menu: it can only be rejected. */
export function newSizeOrphaned(groups: PendingSizeGroups, r: SizeRow): boolean {
  return isPendingSize(r) && groups.orphanedNewSizes.has(r.id)
}
