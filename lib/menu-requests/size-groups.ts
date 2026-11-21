// PENDING SIZE GROUPS — for the review screens (H5 Fix B; F4, Nov 13).
//
// A brand-new item's sizes are PENDING ADD requests sharing a variantGroup, and approving or
// rejecting one decides them all (lib/menu-requests/apply-decision.ts). The organizer queue and the
// admin panel show each size as its own card, so each card says how many sizes the decision covers.
//
// A new size of an item that is already LIVE (F4) is decided on its own, so its card gets no count;
// it is marked as a new size of that item instead.

import type { Prisma } from '@prisma/client'
import { db } from '../db'

const key = (vendorId: string, variantGroup: string) => `${vendorId}::${variantGroup}`

export interface PendingSizeGroups {
  /** Count of PENDING ADD sizes per (vendor, variantGroup). */
  counts: Map<string, number>
  /** The (vendor, variantGroup) pairs that already have a live item: their pending sizes are new sizes. */
  live: Set<string>
}

/** Pending ADD sizes per (vendor, variantGroup) within `scope` (e.g. one fair), and which groups are live. */
export async function pendingSizeCounts(scope: Prisma.MenuRequestWhereInput): Promise<PendingSizeGroups> {
  const rows = await db.menuRequest.groupBy({
    by: ['vendorId', 'variantGroup'],
    where: { ...scope, type: 'ADD', status: 'PENDING', variantGroup: { not: null } },
    _count: { _all: true },
  })
  const counts = new Map(rows.map(r => [key(r.vendorId, r.variantGroup as string), r._count._all]))
  const liveItems = rows.length === 0 ? [] : await db.menuItem.findMany({
    where: {
      removedAt: null,
      OR: rows.map(r => ({ vendorId: r.vendorId, variantGroup: r.variantGroup as string })),
    },
    select: { vendorId: true, variantGroup: true },
  })
  const live = new Set(liveItems.map(i => key(i.vendorId, i.variantGroup as string)))
  return { counts, live }
}

type SizeRow = { type: string; status: string; vendorId: string; variantGroup: string | null }

const isPendingSize = (r: SizeRow): r is SizeRow & { variantGroup: string } =>
  r.type === 'ADD' && r.status === 'PENDING' && r.variantGroup !== null

/** How many sizes deciding this row decides, or null when it is not a pending size of a new item. */
export function sizeCountFor(groups: PendingSizeGroups, r: SizeRow): number | null {
  if (!isPendingSize(r) || groups.live.has(key(r.vendorId, r.variantGroup))) return null
  return groups.counts.get(key(r.vendorId, r.variantGroup)) ?? null
}

/** The live item (its size group's name) this pending row adds a size to, or null (F4). */
export function newSizeOf(groups: PendingSizeGroups, r: SizeRow): string | null {
  if (!isPendingSize(r) || !groups.live.has(key(r.vendorId, r.variantGroup))) return null
  return r.variantGroup
}
