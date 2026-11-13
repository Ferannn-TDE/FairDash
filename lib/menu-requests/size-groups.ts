// PENDING SIZE GROUPS — for the review screens (H5 Fix B).
//
// A brand-new item's sizes are PENDING ADD requests sharing a variantGroup, and approving or
// rejecting one decides them all (lib/menu-requests/apply-decision.ts). The organizer queue and the
// admin panel show each size as its own card, so each card says how many sizes the decision covers.

import type { Prisma } from '@prisma/client'
import { db } from '../db'

const key = (vendorId: string, variantGroup: string) => `${vendorId}::${variantGroup}`

/** Count of PENDING ADD sizes per (vendor, variantGroup), within `scope` (e.g. one fair). */
export async function pendingSizeCounts(scope: Prisma.MenuRequestWhereInput): Promise<Map<string, number>> {
  const rows = await db.menuRequest.groupBy({
    by: ['vendorId', 'variantGroup'],
    where: { ...scope, type: 'ADD', status: 'PENDING', variantGroup: { not: null } },
    _count: { _all: true },
  })
  return new Map(rows.map(r => [key(r.vendorId, r.variantGroup as string), r._count._all]))
}

/** How many sizes deciding this row decides, or null when it is not a pending size of a new item. */
export function sizeCountFor(
  counts: Map<string, number>,
  r: { type: string; status: string; vendorId: string; variantGroup: string | null },
): number | null {
  if (r.type !== 'ADD' || r.status !== 'PENDING' || r.variantGroup === null) return null
  return counts.get(key(r.vendorId, r.variantGroup)) ?? null
}
