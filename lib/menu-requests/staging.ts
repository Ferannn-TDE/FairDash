// VENDOR STAGING TRAY — the pure logic behind "assemble several items, then submit them once".
//
// WHY THIS IS A MODULE AND NOT INLINE STATE. Everything up to this point could be proven by a
// guard script hitting a route. A React component cannot: a script can assert that an array
// grew, but not that the row the vendor clicked is the row that disappeared. So the parts that
// CAN be reasoned about — what the tray holds, what gets submitted, and how optimistic rows are
// reconciled against the server's answer — live here as pure functions over plain values, and
// the component keeps only rendering and wiring. What a script cannot see is called out in the
// review notes rather than papered over with a green tick.
//
// NO IMPORTS, for the same reason as group-by-batch.ts: a client component consumes this, so
// anything reachable from here would be bundled into the browser.
//
// ── THE BATCH ID IS NOT OURS TO MAKE ────────────────────────────────────────────────────────
// Nothing here generates or forwards a batchId. The tray stages ITEMS; the server mints the
// submission id and writes it across the rows. A client-supplied batch id would let a caller
// graft rows onto someone else's submission, which is exactly the hole the write route closes
// by minting it server-side — reopening it here would undo that at the other end of the wire.

/** One item sitting in the tray, not yet submitted. */
export interface StagedItem {
  /** Client-only identity, for list keys and removal. Never sent to the server. */
  stageId: string
  name: string
  description: string
  price: number
  prepTime: number
  category: string
  imageUrl: string
}

/** A row in the vendor's "pending approval" list. Mirrors the page's PendingRequest. */
export interface PendingRow {
  id: string
  type: 'ADD' | 'EDIT' | 'DELETE'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string | null
  menuItemId: string | null
  menuItem: { name: string } | null
  createdAt: string
  batchId?: string | null
  /** True while this row exists only on the client, awaiting the server's answer. */
  optimistic?: boolean
}

export type StageableFields = Omit<StagedItem, 'stageId'>

/** Prefix for optimistic row ids, so a temporary can never be mistaken for a real request id. */
export const TEMP_ID_PREFIX = 'tmp_'

export const isTempId = (id: string): boolean => id.startsWith(TEMP_ID_PREFIX)

// ── Copy ────────────────────────────────────────────────────────────────────────────────────
//
// THE LABELS ARE PART OF THE MECHANISM, NOT DECORATION. Step 5 first shipped with the staging
// form still captioned "Submit for Approval" — the wiring was correct, the tray only appeared
// once something was staged, and so a fresh form was pixel-identical to the old single-submit
// one while its button described the wrong action. Nothing was broken; it was unreadable.
//
// The rule that prevents the recurrence: there are TWO controls and they must never be
// confusable at ANY tray count. Staging says "add", never "submit" and never "approval";
// submitting is the only control that mentions approval. Kept here as functions so the one
// machine-checkable slice of that defect (the strings themselves) is actually checked.

/** The control that puts an item in the tray. Must never read as the submit action. */
export const STAGE_BUTTON_LABEL = 'Add to submission'

/** The control that sends the tray. The ONLY control that mentions approval. */
export function submitButtonLabel(count: number): string {
  return `Submit ${count} ${count === 1 ? 'item' : 'items'} for approval`
}

export function trayHeading(count: number): string {
  return count === 0
    ? 'Your submission'
    : `Your submission · ${count} ${count === 1 ? 'item' : 'items'}`
}

/**
 * The zero state has a job: an empty tray is the only place a vendor learns that items collect
 * before being sent. Without it the feature is invisible until after the first add.
 */
export function trayHint(count: number): string {
  if (count === 0) return 'Items you add collect here. Send them to the organizer together, in one submission.'
  if (count === 1) return 'Not sent yet — add more items, or submit just this one.'
  return 'Not sent yet. These go to the organizer together, and are approved one by one.'
}

// ── Tray operations ─────────────────────────────────────────────────────────────────────────
// All pure: they return a new array and never mutate the input, so React sees a new identity.

export function addStaged(list: StagedItem[], item: StageableFields, stageId: string): StagedItem[] {
  return [...list, { ...item, stageId }]
}

/** Remove by stageId — never by index. An index-based remove drops the neighbour after a sort. */
export function removeStaged(list: StagedItem[], stageId: string): StagedItem[] {
  return list.filter(i => i.stageId !== stageId)
}

/**
 * Edit an item that is still in the tray. LOCAL ONLY — no request, because the item does not
 * exist server-side yet. This is a different verb from editing an approved MenuItem, which goes
 * through the EDIT request path; conflating them would either fire a stray EDIT for something
 * that was never submitted, or swallow a real edit into the tray.
 */
export function updateStaged(
  list: StagedItem[],
  stageId: string,
  patch: Partial<StageableFields>,
): StagedItem[] {
  return list.map(i => (i.stageId === stageId ? { ...i, ...patch } : i))
}

// ── Submit ──────────────────────────────────────────────────────────────────────────────────

export interface SingleSubmitBody {
  vendorId: string
  type: 'ADD'
  name: string
  description: string
  price: number
  prepTime: number
  category: string
  imageUrl: string
}

export interface BatchSubmitBody {
  vendorId: string
  items: Omit<SingleSubmitBody, 'vendorId'>[]
}

/**
 * The request body for the tray.
 *
 * ONE item submits through the SINGLE form, not a batch of one. A lone add has always produced a
 * standalone request and must keep doing so: `batchId = null` means "standalone" everywhere
 * downstream (group-by-batch.ts), so wrapping a single add in a submission would render it with
 * a batch wrapper around one item and quietly reclassify what a solo request is.
 *
 * Note what is absent: no batchId, no stageId. The tray's identities are client-only.
 */
export function buildSubmitBody(
  vendorId: string,
  staged: StagedItem[],
): SingleSubmitBody | BatchSubmitBody {
  const items = staged.map(({ stageId: _stageId, ...fields }) => ({ type: 'ADD' as const, ...fields }))
  if (items.length === 1) return { vendorId, ...items[0] }
  return { vendorId, items }
}

// ── Optimistic rows and their reconciliation ────────────────────────────────────────────────

/**
 * The N temporary rows shown the moment the vendor submits, before the server answers.
 * `newId` supplies the ids so callers stay deterministic and testable.
 */
export function optimisticRowsFor(
  staged: StagedItem[],
  newId: (index: number) => string,
  now: string,
): PendingRow[] {
  return staged.map((item, i) => ({
    id: `${TEMP_ID_PREFIX}${newId(i)}`,
    type: 'ADD' as const,
    status: 'PENDING' as const,
    name: item.name,
    menuItemId: null,
    menuItem: null,
    createdAt: now,
    batchId: null,
    optimistic: true,
  }))
}

/**
 * Replace the N temporaries with the N rows the server actually wrote.
 *
 * The client mirror of the write route's atomicity, and it has the same three ways to be wrong:
 * APPEND leaves 2N rows, replacing only the first leaves N-1 phantoms behind, and dropping the
 * server's batchId loses the grouping the submission just earned. So: every temporary is
 * removed by id, and the server's rows take their place at the head — the list is newest-first,
 * which is where the temporaries were inserted.
 */
export function reconcileAfterSubmit(
  current: PendingRow[],
  tempIds: string[],
  serverRows: PendingRow[],
): PendingRow[] {
  const temps = new Set(tempIds)
  return [...serverRows, ...current.filter(r => !temps.has(r.id))]
}

/**
 * The failure half. The write route is all-or-nothing, so when a submit is refused NOTHING was
 * written — every optimistic row must go, together. Leaving them would show the vendor items
 * that do not exist, and removing only some would be worse: the list would then disagree with
 * both the server and itself.
 */
export function rollbackOptimistic(current: PendingRow[], tempIds: string[]): PendingRow[] {
  const temps = new Set(tempIds)
  return current.filter(r => !temps.has(r.id))
}

/**
 * Normalise either response shape into rows. The single form answers with a bare request; the
 * batch form answers `{ batchId, requests: [...] }`. Both must land as PendingRows carrying
 * whatever batchId the server assigned (null for a standalone).
 */
export function rowsFromSubmitResponse(data: unknown): PendingRow[] {
  const asBatch = data as { batchId?: string | null; requests?: unknown[] } | null
  const raw: unknown[] = Array.isArray(asBatch?.requests) ? asBatch!.requests! : data ? [data] : []
  return raw.map(r => {
    const row = r as Partial<PendingRow> & { id: string }
    return {
      id: row.id,
      type: (row.type ?? 'ADD') as PendingRow['type'],
      status: (row.status ?? 'PENDING') as PendingRow['status'],
      name: row.name ?? null,
      menuItemId: row.menuItemId ?? null,
      menuItem: null,
      createdAt: row.createdAt ?? new Date().toISOString(),
      batchId: row.batchId ?? null,
    }
  })
}
