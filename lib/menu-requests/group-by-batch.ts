// MENU-REQUEST BATCH GROUPING — the single definition of "which rows belong to one submission".
//
// A vendor who stages several items and sends them together gets one server-minted cuid written
// across that submission's rows (MenuRequest.batchId). The organizer still approves or rejects
// PER ITEM: grouping is presentational, the row remains the unit of action, and the API keeps
// returning a FLAT list because the cursor is a row id.
//
// ── THE RULE, AND WHY IT IS WRITTEN ONCE ────────────────────────────────────────────────────
// NULL MEANS STANDALONE — a legacy request, or a single add — and NEVER "the null batch".
// A raw `groupBy(batchId)` would collapse every ungrouped request in a fair into one giant
// group, which is the single most visible regression this feature can produce and the reason
// this file exists rather than an inline `reduce` at each call site. Null rows are keyed
// INDIVIDUALLY (`solo:<id>`), so the collapse is not merely avoided — it is unexpressible.
//
// Empty-string and whitespace batchIds are treated as standalone too. Nothing should ever write
// one (the id is minted server-side), but `?? ` alone would let `''` in through a side door and
// group every such row together — the same bug wearing a different hat.
//
// ── ISOMORPHIC BY CONSTRUCTION ──────────────────────────────────────────────────────────────
// This module has NO imports. It is consumed by a client component (the organizer page) AND by
// a Node guard script, so anything reachable from here would be bundled into the browser; a
// stray `@prisma/client` or `next/server` import would break the client consumer without
// failing a single test. It takes a structural row shape rather than a Prisma type for exactly
// that reason. scripts/menu-request-batch-compat-guard.ts asserts the no-imports property, so
// it is enforced rather than remembered.

/** The minimum a row must carry to be grouped. Structural on purpose — never a Prisma type. */
export interface BatchGroupable {
  id: string
  batchId: string | null
}

export interface BatchGroup<T extends BatchGroupable> {
  /** Stable React key. Either the batch id, or `solo:<row id>` for a standalone row. */
  key: string
  /** The submission id, or null when this group is a single standalone row. */
  batchId: string | null
  /** True when this group represents one submission of several items. */
  isBatch: boolean
  /** Member rows, in the order they arrived. */
  rows: T[]
}

/**
 * The grouping key for one row. Exported so a caller that needs to key a single row (a React
 * key, a lookup) uses the SAME rule rather than re-deriving it.
 */
export function batchGroupKey(row: BatchGroupable): string {
  const id = row.batchId?.trim()
  return id ? id : `solo:${row.id}`
}

/**
 * Group rows into submissions, preserving order.
 *
 * Groups appear in the order of their FIRST member, and rows keep their relative order within a
 * group — the list is FIFO (oldest first) and the queue's reading order must survive grouping.
 *
 * Rows of one batch need not be adjacent: a batch can straddle a pagination boundary, and the
 * organizer page merges pages by row id, so members can arrive separated. They still land in
 * one group, positioned where the batch first appeared.
 */
export function groupIntoBatches<T extends BatchGroupable>(rows: T[]): BatchGroup<T>[] {
  const byKey = new Map<string, BatchGroup<T>>()
  const order: string[] = []

  for (const row of rows) {
    const key = batchGroupKey(row)
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        // Normalised: a whitespace-only batchId groups as standalone, so it must not be
        // reported as this group's batch id either.
        batchId: key.startsWith('solo:') ? null : key,
        isBatch: false,
        rows: [],
      }
      byKey.set(key, group)
      order.push(key)
    }
    group.rows.push(row)
  }

  for (const key of order) {
    const group = byKey.get(key)!
    // A "batch" of one is still a batch — the vendor submitted it as one, and calling it
    // standalone would misreport a real submission. What makes a group a batch is having a
    // batch id, not how many rows survived the current filter.
    group.isBatch = group.batchId !== null
  }

  return order.map(key => byKey.get(key)!)
}
