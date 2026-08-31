// ORGANIZER QUEUE GROUPING — vendor → batch → item, the outer layer.
//
// The organizer's approval queue arrives FLAT from the read route (rows, in a total
// (createdAt, id) sort) and is arranged here for display. Two layers, two modules:
//
//     groupByVendor      ← this file: which vendor's queue a row belongs to
//       └ groupIntoBatches ← group-by-batch.ts: which submission a row belongs to
//           └ row          ← the unit of action; approval stays PER ITEM
//
// ── IT COMPOSES, IT DOES NOT RE-DERIVE ──────────────────────────────────────────────────────
// The batch layer is imported and called, never reimplemented. Two copies of "which rows belong
// to one submission" is the failure this codebase keeps finding, and the null-batch rule
// (`batchId ?? solo:<id>`) is the single most dangerous line in the feature — a second copy of
// it that drifted would collapse every standalone request in a fair into one group.
// scripts/menu-request-vendor-group-guard.ts [2] asserts the delegation by comparing this
// helper's output against a direct call to groupIntoBatches.
//
// Three things therefore fall out for free rather than being written again:
//   • MIXED TYPES. DELETE, RESTORE, EDIT and a solo ADD all carry batchId = null, so each
//     becomes its own solo group. A vendor holding a batch of 3 plus a DELETE plus a RESTORE
//     is one isBatch group and two solo groups — no special-casing per request type.
//   • ORDER WITHIN A VENDOR. Rows arrive already sorted, and groupIntoBatches preserves
//     first-appearance and within-group arrival order, so a vendor's groups are in queue order.
//   • STRADDLING. A batch split across a pagination boundary still lands in one group, because
//     groupIntoBatches keys by id rather than adjacency.
//
// The only NEW work here is the vendor layer and its sort.
//
// ── NO NULL-VENDOR CASE ─────────────────────────────────────────────────────────────────────
// Unlike batchId — whose null IS the standalone meaning — MenuRequest.vendorId is
// `String` NOT NULL with a required relation, and the read route projects vendor:{id,name}. So
// there is no escape hatch to design and no bucket for orphans: every row has a vendor. The
// guard asserts that rather than trusting it, including that a hypothetically vendor-less row
// is not swallowed into an "undefined" bucket.
//
// ── ISOMORPHIC ──────────────────────────────────────────────────────────────────────────────
// Only a type-only import plus the sibling grouper — nothing server-only, no Prisma, no
// next/cache. A client component renders this, so anything reachable from here lands in the
// browser bundle. Enforced by the guard, not remembered.

import { groupIntoBatches, type BatchGroup, type BatchGroupable } from './group-by-batch'

/** The minimum a row needs to be grouped by vendor. Structural — never a Prisma type. */
export interface VendorGroupable extends BatchGroupable {
  status: string
  /** ISO timestamp as it arrives over the wire. */
  createdAt: string
  vendor: { id: string; name: string }
}

export interface VendorGroup<T extends VendorGroupable> {
  /** Stable React key, and the vendor's identity. */
  vendorId: string
  vendorName: string
  /** This vendor's rows, arranged into submissions — batches and standalones alike. */
  groups: BatchGroup<T>[]
  /** How many of this vendor's rows still await a decision. Rows, not groups. */
  pendingCount: number
  /**
   * The most recent request time in this vendor's set — the sort key, in epoch ms.
   * 0 when no row carries a parseable date, which keeps such a vendor last rather than
   * throwing the sort into NaN comparisons.
   */
  latestAt: number
}

/** Epoch ms, or 0 for a missing/unparseable date — never NaN, which would poison the sort. */
function timeOf(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * Arrange a flat queue into vendor groups, each holding that vendor's batches and standalones.
 *
 * Vendors are ordered MOST-RECENT-FIRST (latestAt descending): the organizer works a queue, so
 * the vendor who just submitted should surface, not the one whose name starts with A. Ties break
 * on vendor id so the order is total and cannot shuffle between renders of the same data — the
 * same reasoning as the (createdAt, id) sort on the read route.
 *
 * Rows keep their arrival order within a vendor; only the VENDOR layer is re-sorted.
 */
export function groupByVendor<T extends VendorGroupable>(rows: T[]): VendorGroup<T>[] {
  // Preserve encounter order while bucketing, so the batch layer still sees rows in the order
  // the route returned them.
  const byVendor = new Map<string, T[]>()
  const names = new Map<string, string>()

  for (const row of rows) {
    const id = row.vendor.id
    if (!byVendor.has(id)) {
      byVendor.set(id, [])
      names.set(id, row.vendor.name)
    }
    byVendor.get(id)!.push(row)
  }

  const groups: VendorGroup<T>[] = []
  for (const [vendorId, vendorRows] of byVendor) {
    groups.push({
      vendorId,
      vendorName: names.get(vendorId)!,
      // THE DELEGATION. Batch grouping is this call and nothing else.
      groups: groupIntoBatches(vendorRows),
      pendingCount: vendorRows.reduce((n, r) => n + (r.status === 'PENDING' ? 1 : 0), 0),
      latestAt: vendorRows.reduce((max, r) => Math.max(max, timeOf(r.createdAt)), 0),
    })
  }

  // Most recent first; vendorId breaks ties so the order is total.
  groups.sort((a, b) =>
    b.latestAt - a.latestAt || a.vendorId.localeCompare(b.vendorId),
  )
  return groups
}
