/**
 * THE COHORT-RETIREMENT RECEIPT — derived from what the WRITES RETURNED, never from the plan.
 *
 * ── THE INCIDENT THIS FILE EXISTS FOR (2026-07-28) ──────────────────────────────────────────
 * The first version of scripts/retire-pollution-cohort.ts built its receipt like this:
 *
 *     for (const e of toCancel) {                       // toCancel = the PLAN, read before any write
 *       await db.$transaction([ update…, audit… ])      // ← result discarded, never inspected
 *       receipt.push({ orderId: e.orderId, cents: e.netCents ?? 0 })   // ← pushes PLAN data
 *     }
 *
 * `receipt.length` therefore meant "76 transactions did not throw", not "76 rows changed". The
 * distinction is not academic: the run printed `rows cancelled: 76 (301834¢)` and the ledger
 * came back with 76 rows still `paid`. A receipt computed from intent is not a receipt.
 *
 * (The cancels DID commit that day — the reconciler's Pattern X2 healed them straight back from
 * the fabricated Payout rows within 250ms. That is fixed at its source in lib/reconciler.ts.
 * This file fixes the OTHER half: a receipt that could not have told the difference.)
 *
 * ── THE PROPERTY, AND HOW IT IS PROVEN ──────────────────────────────────────────────────────
 * `cancelled`, `centsCancelled` and `rows` advance ONLY when the writer reports a non-zero
 * change count. The writer is injected, so the guard can hand in one that changes nothing and
 * assert the receipt says ZERO — a control that FAILS rather than crashes, and one the previous
 * code would have failed. See scripts/pollution-cohort-guard.ts §[6].
 *
 * ── AND THE RECEIPT IS NOT THE LAST WORD ────────────────────────────────────────────────────
 * Even an honest per-row receipt only describes the moment each write returned. `verifyCohort`
 * re-reads the rows AFTERWARDS and asserts the FINAL state, which is what actually caught the
 * X2 re-heal. Set-based money ops must assert the end state, not the sum of their steps.
 */

/** One row the plan intends to retire. Carries only what the receipt and the audit need. */
export interface CohortPlanRow {
  id: string
  orderId: string
  vendorId: string
  eventId: string
  netCents: number | null
  subtotalCents: number
}

/**
 * Performs ONE row's state change.
 *
 * ⛔ CONTRACT: returns the number of rows the write ACTUALLY changed — `updateMany().count`, not
 * a constant, and not `1` inferred from "it didn't throw". Returning a hardcoded 1 reintroduces
 * the exact defect this module exists to prevent.
 */
export type CohortCancelWriter = (row: CohortPlanRow) => Promise<number>

export interface CohortReceiptRow {
  orderId: string
  vendorId: string
  from: string
  to: string
  cents: number
}

export interface CohortReceipt {
  /** How many rows were INTENDED — the plan. Reported separately, never conflated with the result. */
  planned: number
  /** Sum of the writers' reported change counts. The only source of "rows cancelled". */
  cancelled: number
  /** Cents attributable to rows a writer CONFIRMED it changed. */
  centsCancelled: number
  /** Writer returned 0 — already cancelled, or lost a race. Not a failure; not a success either. */
  noop: CohortPlanRow[]
  /** Writer threw. The run continues so one bad row cannot strand the rest half-done. */
  failed: { row: CohortPlanRow; error: string }[]
  /** One line per CONFIRMED change. Empty when nothing changed. */
  rows: CohortReceiptRow[]
}

/**
 * Runs the plan through the writer and returns a receipt of what the writer reported.
 *
 * Sequential on purpose: these are money rows on a live event, and a readable per-row receipt is
 * worth more than the seconds parallelism would save.
 */
export async function applyCohortRetirement(
  plan: readonly CohortPlanRow[],
  write: CohortCancelWriter,
): Promise<CohortReceipt> {
  const receipt: CohortReceipt = {
    planned: plan.length,
    cancelled: 0,
    centsCancelled: 0,
    noop: [],
    failed: [],
    rows: [],
  }

  for (const row of plan) {
    let changed: number
    try {
      changed = await write(row)
    } catch (e) {
      // Recorded, not swallowed: `failed` rides the receipt and forces a non-zero exit.
      receipt.failed.push({ row, error: e instanceof Error ? e.message : String(e) })
      continue
    }

    // ⛔ THE LOAD-BEARING BRANCH. Nothing below runs on a zero-change write.
    if (changed <= 0) {
      receipt.noop.push(row)
      continue
    }

    receipt.cancelled += changed
    receipt.centsCancelled += row.netCents ?? 0
    receipt.rows.push({
      orderId: row.orderId,
      vendorId: row.vendorId,
      from: 'paid',
      to: 'cancelled',
      cents: row.netCents ?? 0,
    })
  }

  return receipt
}

export interface CohortVerification {
  /** Rows re-read after the writes. */
  total: number
  cancelled: number
  /** ⛔ Non-zero means the remediation did NOT stick, whatever the receipt said. */
  stillPaid: number
  other: { orderId: string; status: string }[]
  ok: boolean
}

/**
 * THE FINAL-STATE ASSERTION. Pure, so it is provable without a database.
 *
 * Takes the cohort RE-READ after the writes complete. `ok` is true only when every row is
 * `cancelled` — not when the receipt totals look right. This is the check that would have
 * caught the X2 re-heal on the night it happened.
 */
export function verifyCohort(rows: readonly { orderId: string; status: string }[]): CohortVerification {
  const cancelled = rows.filter(r => r.status === 'cancelled').length
  const stillPaid = rows.filter(r => r.status === 'paid').length
  const other = rows.filter(r => r.status !== 'cancelled' && r.status !== 'paid')
    .map(r => ({ orderId: r.orderId, status: r.status }))
  return {
    total: rows.length,
    cancelled,
    stillPaid,
    other,
    ok: rows.length > 0 && cancelled === rows.length,
  }
}

/**
 * Renders the receipt. Separated from the writing so the guard can assert on TEXT as well as
 * counts — "a run that changed nothing must SAY nothing changed" is a property of the output,
 * not just of the numbers behind it.
 */
export function formatCohortReceipt(
  receipt: CohortReceipt,
  verification: CohortVerification | null,
  meta: { timestamp: string; actor: string; alreadyCancelled: number },
): string {
  const bar = '═'.repeat(72)
  const out: string[] = []
  const changedNothing = receipt.cancelled === 0

  out.push(bar)
  out.push(changedNothing
    ? '  RECEIPT — NOTHING CHANGED'
    : '  RECEIPT — fourth pollution incident, resolved')
  out.push(bar)
  out.push(`  timestamp        : ${meta.timestamp}`)
  out.push(`  actor            : ${meta.actor}`)
  out.push(`  rows PLANNED     : ${receipt.planned}   ← what the candidate query found`)
  out.push(`  rows CANCELLED   : ${receipt.cancelled}  (${receipt.centsCancelled}¢)   ← what the writes RETURNED`)
  out.push(`  no-op writes     : ${receipt.noop.length}   (changed 0 rows — already cancelled, or raced)`)
  out.push(`  failed writes    : ${receipt.failed.length}`)
  out.push(`  already cancelled: ${meta.alreadyCancelled} (untouched, idempotent)`)

  if (changedNothing) {
    out.push('')
    out.push('  ⚠️  THIS RUN CHANGED NOTHING. No row list follows, because there is nothing to list.')
  }

  for (const f of receipt.failed) {
    out.push(`    ❌ ${f.row.orderId} vendor ${f.row.vendorId} — ${f.error}`)
  }

  if (receipt.rows.length) {
    out.push('')
    out.push('  rows (CONFIRMED changed):')
    for (const r of receipt.rows) {
      out.push(`    ${r.orderId}  vendor ${r.vendorId}  ${r.from} → ${r.to}  ${r.cents}¢`)
    }
  }

  out.push('')
  if (!verification) {
    out.push('  ⛔ FINAL STATE: NOT VERIFIED — the re-read failed. Treat this run as UNKNOWN.')
  } else if (verification.ok) {
    out.push(`  ✅ FINAL STATE VERIFIED: all ${verification.total} cohort rows are 'cancelled'.`)
  } else {
    out.push(`  ⛔ FINAL STATE WRONG: ${verification.stillPaid} of ${verification.total} cohort rows are STILL 'paid'`)
    if (verification.other.length) {
      out.push(`     and ${verification.other.length} sit in another status: ${verification.other.map(o => `${o.orderId}:${o.status}`).join(', ')}`)
    }
    out.push("     The writes reported success and the ledger disagrees — something re-wrote these rows.")
    out.push('     FIRST SUSPECT: reconciler Pattern X2, which heals a non-paid earning back to')
    out.push('     `paid` from any un-reversed Payout row. The cohort\'s Payout rows are kept on')
    out.push('     purpose, so X2 must exclude them (lib/reconciler.ts). DO NOT re-run blindly.')
  }
  out.push(bar)
  return out.join('\n')
}
