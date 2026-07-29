/**
 * Reconciliation sweep — the periodic backstop (Bucket B from the leak audit).
 *
 * PRINCIPLE: Stripe = money-truth, DB = state-truth, Firebase = projection.
 * This sweep COMPARES money-truth against state-truth and repairs IDEMPOTENTLY
 * by calling the EXISTING proven functions. It ORCHESTRATES; it never
 * reimplements placement/payout/timeout/money logic. A reconciler with its own
 * copy of money math is a leak generator — so every repair here routes through:
 *
 *   placePaidOrder()       — convergent, idempotent placement      (Patterns A,B,F)
 *   enqueueOrderPayout()   — idempotent payout enqueue → worker     (Patterns C,D)
 *   JOB_UNACCEPTED enqueue — the SAME accept-timeout handler        (Pattern E)
 *
 * GUARDRAILS:
 *   - IDEMPOTENT: a second consecutive run changes nothing (all repairs dedupe).
 *   - BOUNDED: recent-time-window + per-pattern row cap + Stripe pagination cap.
 *   - NEVER act on ambiguous money: if a repair would move money and we cannot
 *     be CERTAIN it wasn't already paid, we DON'T — we alert. Under-pay-and-alert
 *     beats over-pay-silently.
 *   - OBSERVABLE: returns a per-run summary {scanned, repaired-by-pattern,
 *     alerted, ambiguousSkipped} and logs it.
 *   - BACKSTOP, NOT PRIMARY: non-zero repairs mean a real-time path is leaking —
 *     surfaced as backstopWarnings, never silently papered over.
 *
 * WORKER-DOWN CAVEAT: this sweep runs ON the worker, so it cannot self-heal
 * "the worker is down." Monitoring the worker process is a separate deploy-time
 * concern (e.g. Render health checks / external uptime monitor).
 */

import { OrderStatus, StrandedReason } from '@prisma/client'
import { db } from './db'
import { STRAND_THRESHOLDS_MS } from './constants'
import { recordSweepHeartbeat, WORKER_COMMIT } from './health'
import { stripe } from './stripe'
import { placePaidOrder } from './place-order'
import { enqueueOrderPayout } from './order-side-effects'
import { refundVendorPortion } from './process-refund'
import { retryChargebackClawback } from './process-chargeback'
import { splitRunnerFee } from './payout-split'
import { reconcileRunnerPayouts } from './runner-payout'
import { reconcileOrganizerPayouts } from './organizer-payout'
import { reconcileTipRefunds } from './tip-refund'
import { getOrderQueue, JOB_UNACCEPTED } from './queues'
import { enqueueJobSafely } from './queue-safe'
import { VENDOR_ACCEPT_TIMEOUT_MS, REFUND_WINDOW_MS, CURBSIDE_WAIT_TIMEOUT_MS } from './constants'
import { logger } from './logger'
import { findStuckPayouts } from './stuck-payouts'
import { deriveMasterStatus, canAdvance, reconcileMasterStatus, type MasterStatus, type FulfillmentType } from './reconcile-order-status'
import { reverseAccrualForRefundedPortion } from './reverse-accrual'
import { isPollutedTransfer } from './pollution-cohort'
import { writeMoneyAudit, type MoneyActor } from './admin-money'

/**
 * The sweep's own actor. Same vocabulary Pattern T already writes through the shared reverser
 * (`{ id: 'reconciler', type: 'reconciler' }` — 148 such rows exist in production), so the two
 * money-moving patterns are attributable the same way rather than each inventing an identity.
 */
const RECONCILER_ACTOR: MoneyActor = { id: 'reconciler', type: 'reconciler' }

// ─── Tunables (all overridable per-run) ─────────────────────────────────────

export interface SweepOptions {
  /** If true: detect + log only, no repairs of ANY pattern. */
  dryRun?: boolean
  /** DB-pattern lookback (B,C,E) and PENDING_PAYMENT age floor for F. Hours. */
  windowHours?: number
  /** Stripe PaymentIntent list lookback for Pattern A. Hours. */
  stripeWindowHours?: number
  /** Max rows acted on per pattern per run (bound). */
  maxPerPattern?: number
  /**
   * Row ceiling for the whole-live-space scanners (M, N, O, R). Separate from maxPerPattern
   * because their candidate pool is "every active order" and grows with the rush. Hitting it
   * is ALERTED, never silent — see DEFAULTS.scanCeiling.
   */
  scanCeiling?: number
  /** Max Stripe list pages for Pattern A (each page ≤100 PIs). */
  maxStripePages?: number
  /** Age (hours) a PENDING_PAYMENT order must exceed before Pattern F touches it. */
  pendingStaleHours?: number
  /**
   * Pattern E ACTS (enqueues real cancel+refund) only when true. Default false:
   * the recurring sweep only DETECTS + ALERTS which orders it WOULD cancel, so
   * its debut can never nuke test orders. Flip via RECONCILER_PATTERN_E_ENABLED.
   */
  patternEEnabled?: boolean
  /**
   * Pattern N (drift backstop) REPAIRS (calls the aggregator to heal a status that
   * diverged from per-vendor truth) only when true. Default false: the recurring
   * sweep DETECTS + ALERTS drift so its debut can never auto-move money via the
   * aggregator's side-effects. Flip via RECONCILER_BACKSTOP_ENABLED. On a converged
   * board drift should be ~0 — the alert is the early-warning that a new code path
   * started writing status outside the aggregator.
   */
  backstopEnabled?: boolean
  /**
   * Pattern T (phantom-accrual backstop) CANCELS an 'accrued' VendorEarning whose own portion
   * is REFUNDED/DECLINED/CANCELLED (owed nothing) only when true. Default false: the sweep
   * DETECTS + ALERTS which rows it WOULD cancel (via the reverser in dryRun), so its debut can
   * never move the ledger unreviewed. Flip via RECONCILER_PATTERN_T_ENABLED after diffing the
   * reported set. Its first enabled run cleans the existing residual (the 148) as the
   * reconciler — honest actor — replacing any one-off script.
   */
  patternTEnabled?: boolean
}

const DEFAULTS = {
  windowHours: 24,
  stripeWindowHours: 6,
  maxPerPattern: 100,
  maxStripePages: 5,
  pendingStaleHours: 2,
  /**
   * Cap for the four patterns that scan the WHOLE live-order space (M, N, O, R) rather than an
   * exception set. Their candidate pool is "every active order", which grows with the RUSH —
   * exactly when they matter.
   *
   * MEASURED (scripts/mn-coverage-guard.ts): with 153 active orders and an unordered
   * `take: 100`, five consecutive scans returned the IDENTICAL 100 ids and 53 orders were
   * NEVER returned. Not "rotates across sweeps" — permanently invisible.
   *
   * WHY A BIGGER SINGLE FETCH RATHER THAN PAGING: the sweep is LATENCY-bound, not row-bound
   * (every all-time query measured ≤49 rows in 97–306ms), so extra round-trips cost far more
   * than extra rows. One ordered fetch of 1000 covers ~10× any realistic fair peak in a single
   * trip. Paging would add 10 round-trips to save memory we are not short of.
   *
   * ORDERING IS WHAT MAKES THE CAP SAFE: oldest-first is now total and stable, so the cap
   * truncates the NEWEST rather than an arbitrary set — and truncation is ALERTED, never silent.
   */
  scanCeiling: 1000,
}

export interface SweepSummary {
  startedAt: string
  finishedAt: string
  durationMs: number
  dryRun: boolean
  patternEEnabled: boolean
  backstopEnabled: boolean
  scanned: {
    stripePIs: number
    completedOrders: number
    activeOrders: number
    pendingOrders: number
    unresolvedHolds: number
  }
  /** Counts of orders/holds actually repaired (or, in dryRun, that WOULD be). */
  repaired: { A: number; B: number; C: number; D: number; E: number; F: number; G: number; H: number; I: number; J: number; K: number; L: number; M: number; N: number; O: number; P: number; Q: number; R: number; S: number; T: number; X: number }
  /** Order/PI ids touched per pattern (for the human-readable log). */
  details: {
    A: string[]; B: string[]; C: string[]; D: string[]; E: string[]; F: string[]; G: string[]; H: string[]; I: string[]; J: string[]; K: string[]; L: string[]; M: string[]; N: string[]; O: string[]; P: string[]; Q: string[]; R: string[]; S: string[]; T: string[]; X: string[]
  }
  /** Unrepairable-by-design — needs a human. Money is safe; we just can't auto-fix. */
  alerted: string[]
  /**
   * KNOWN and DELIBERATELY NOT ALERTED — a declared cohort whose disposition is already
   * decided (see ACKNOWLEDGED_X2). Kept OUT of `alerted` so the triage list stays things a
   * human must act on, but never dropped: the count rides the summary line and one flat
   * line names the total, so suppressed never means invisible.
   */
  suppressed: string[]
  /** Money repairs we refused because we couldn't be certain it wasn't already paid. */
  ambiguousSkipped: number
  /** Non-zero repairs ⇒ a real-time path is leaking. Surfaced, never hidden. */
  backstopWarnings: string[]
}

// Post-placement, non-terminal states an order can sit in (Pattern B).
const ACTIVE_STATES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.RUNNER_COLLECTED,
]

// Terminal-complete states a payout is owed against (Pattern C).
const COMPLETE_STATES: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.DELIVERED]

/**
 * WHAT A REPAIR MEANS, PER PATTERN — read by the backstop-warning block in runReconciliationSweep.
 *
 *   backstop — repairing means a REAL-TIME PATH LEAKED. Warn: something upstream should have
 *              done this and didn't.
 *   designed — repairing IS the primary path. There is no real-time path to have leaked, so a
 *              warning would be a false statement.
 *   mixed    — genuinely BOTH, and not distinguishable from what is stored today. Stays loud,
 *              with honest either/or wording, because silencing it could hide a real leak.
 *
 * ONLY patterns that increment `sum.repaired` can reach the warning; alert-only patterns
 * (J, K, L, M, O, U, V, W) never do and are deliberately absent rather than listed as no-ops.
 */
const PATTERN_KIND: Record<string, { kind: 'backstop' | 'designed' | 'mixed'; why: string }> = {
  A: { kind: 'backstop', why: 'paid in Stripe but not fully placed — placement leaked' },
  B: { kind: 'backstop', why: 'active order with 0 vendor rows — the placement side-effect leaked' },
  C: { kind: 'backstop', why: 'COMPLETED without payout — the payout enqueue leaked' },
  D: { kind: 'designed', why: 'PAY-WHEN-A-HELD-VENDOR-CONNECTS. The hold exists BECAUSE the vendor was unconnected; no real-time path could have paid it, so draining the hold on verification is the design, not a leak' },
  E: { kind: 'backstop', why: 'stuck PLACED past the accept window — the timeout leaked' },
  F: { kind: 'backstop', why: 'stale PENDING_PAYMENT — the payment-confirm path leaked' },
  G: { kind: 'backstop', why: 'refund stuck PENDING/FAILED — the refund engine leaked' },
  H: { kind: 'backstop', why: 'marked REFUNDED with no completed refund — a refund leaked' },
  I: { kind: 'backstop', why: 'chargeback clawback retry — the first clawback attempt failed' },
  N: { kind: 'backstop', why: 'master-status drift — a writer bypassed the aggregator (named a backstop in its own header)' },
  P: { kind: 'mixed',    why: "its OWN doc says BOTH: 'the post-window backstop for a dropped DELIVERED enqueue (like Pattern C) AND the pay-when-a-held-runner-connects mechanism (like Pattern D)'. Nothing stored distinguishes the two, so it stays loud" },
  Q: { kind: 'mixed',    why: 'same shape as P for organizer batches — backstop AND pay-when-an-organizer-connects, indistinguishable from stored state' },
  R: { kind: 'designed', why: 'tip-refund EXECUTION. reconcileTipRefunds: "there is no per-order enqueue; an owed-back tip is refunded on the next sweep" — the sweep IS the primary path, so there is nothing that could have leaked' },
  S: { kind: 'backstop', why: 'missing VendorEarning accrual — the completion-path accrual failed' },
  T: { kind: 'backstop', why: 'phantom accrual on a refunded portion — the refund-time reverser leaked' },
  X: { kind: 'backstop', why: 'settled transfer vs ledger — a real-time path crashed mid-payout' },
}


// ─── Sweep ───────────────────────────────────────────────────────────────────

export async function runReconciliationSweep(opts: SweepOptions = {}): Promise<SweepSummary> {
  const dryRun = opts.dryRun ?? false
  const windowHours = opts.windowHours ?? DEFAULTS.windowHours
  const stripeWindowHours = opts.stripeWindowHours ?? DEFAULTS.stripeWindowHours
  const maxPerPattern = opts.maxPerPattern ?? DEFAULTS.maxPerPattern
  const scanCeiling = opts.scanCeiling ?? DEFAULTS.scanCeiling
  const maxStripePages = opts.maxStripePages ?? DEFAULTS.maxStripePages
  const pendingStaleHours = opts.pendingStaleHours ?? DEFAULTS.pendingStaleHours
  const patternEEnabled =
    opts.patternEEnabled ?? (process.env.RECONCILER_PATTERN_E_ENABLED === 'true')
  const backstopEnabled =
    opts.backstopEnabled ?? (process.env.RECONCILER_BACKSTOP_ENABLED === 'true')
  const patternTEnabled =
    opts.patternTEnabled ?? (process.env.RECONCILER_PATTERN_T_ENABLED === 'true')

  const startedAt = new Date()
  const windowStart = new Date(startedAt.getTime() - windowHours * 3600_000)

  const sum: SweepSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: '',
    durationMs: 0,
    dryRun,
    patternEEnabled,
    backstopEnabled,
    scanned: { stripePIs: 0, completedOrders: 0, activeOrders: 0, pendingOrders: 0, unresolvedHolds: 0 },
    repaired: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, K: 0, L: 0, M: 0, N: 0, O: 0, P: 0, Q: 0, R: 0, S: 0, T: 0, X: 0 },
    details: { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [], K: [], L: [], M: [], N: [], O: [], P: [], Q: [], R: [], S: [], T: [], X: [] },
    alerted: [],
    suppressed: [],
    ambiguousSkipped: 0,
    backstopWarnings: [],
  }

  try {
    await patternA(sum, { stripeWindowHours, maxStripePages, dryRun })
    await patternB(sum, { windowStart, maxPerPattern, dryRun })
    // S BEFORE C/D — ORDER IS LOAD-BEARING. Pattern S restores a missing VendorEarning
    // (the admin's hold target). Patterns C and D PAY unpaid orders. If S ran after
    // them, C would pay the money out — and incidentally materialise the row via the
    // executor's re-accrual — before S could restore anything holdable. The row would
    // reappear at the exact moment it stopped being useful, which is the failure this
    // pattern exists to prevent. Restore the hold target FIRST, then pay.
    await patternS(sum, { windowStart, maxPerPattern, dryRun })
    await patternC(sum, { windowStart, maxPerPattern, dryRun })
    await patternD(sum, { maxPerPattern, dryRun })
    await patternE(sum, { windowStart, maxPerPattern, dryRun, patternEEnabled })
    await patternF(sum, { pendingStaleHours, maxPerPattern, dryRun })
    await patternG(sum, { maxPerPattern, dryRun })
    await patternH(sum, { windowStart, maxPerPattern, dryRun })
    await patternI(sum, { maxPerPattern, dryRun })
    await patternJ(sum, { maxPerPattern })
    await patternK(sum, { maxPerPattern })
    await patternL(sum, { windowStart, maxPerPattern })
    await patternM(sum, { maxPerPattern, scanCeiling })
    await patternN(sum, { maxPerPattern, scanCeiling, backstopEnabled })
    await patternO(sum, { maxPerPattern, scanCeiling })
    await patternP(sum, { maxPerPattern, dryRun })
    await patternQ(sum, { maxPerPattern, dryRun })
    await patternR(sum, { maxPerPattern, scanCeiling, dryRun })
    await patternT(sum, { maxPerPattern, dryRun, patternTEnabled })
    // U is a read-only alerter (never moves money) — always runs live, no env gate. It reads
    // the durable payout-failure markers so a permanently-failed payout can't stay a flag with
    // no reader. Runs regardless of dryRun (it writes nothing).
    await patternU(sum, { maxPerPattern })
    await patternV(sum, { maxPerPattern })
    await patternW(sum, { maxPerPattern, dryRun })
    await patternX(sum, { scanCeiling, maxPerPattern, dryRun, windowStart })
  } catch (err) {
    logger.error('[Reconciler] Sweep aborted mid-run', { error: String(err) })
    sum.alerted.push(`SWEEP ABORTED: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── BACKSTOP SIGNAL — per-pattern, because "any repair means a leak" was FALSE ─────────
  // This block used to assert that of EVERY pattern unconditionally, so a successful
  // pay-when-connected produced "Pattern P repaired 2 — a real-time path is leaking". It fired
  // on the organizer batch (2026-07-28 00:08) and the runner payouts — the two most important
  // successful sweeps this project has had — and went unnoticed both times.
  //
  // That matters more than its size: this is the block where a genuine Pattern C/D leak would
  // surface during the fair, and a warning that cries wolf on the designed path trains the
  // reader to skip it. Alert-fatigue, in the worst possible place.
  //
  // Each pattern now DECLARES its kind, so a new pattern must choose rather than inherit the
  // wrong default. Bias is deliberate: mislabelling a backstop as designed SILENCES A REAL
  // LEAK, while the reverse is only noise — so anything genuinely both stays loud.
  if (!dryRun) {
    for (const [pat, n] of Object.entries(sum.repaired)) {
      if (n <= 0) continue
      const k = PATTERN_KIND[pat]
      if (!k) {
        // Declared passes, silent fails — an unclassified pattern warns rather than hiding.
        sum.backstopWarnings.push(`Pattern ${pat} repaired ${n} — UNCLASSIFIED pattern (add it to PATTERN_KIND); treating as a leak.`)
        continue
      }
      if (k.kind === 'designed') continue // repairing IS the primary path here — nothing leaked
      sum.backstopWarnings.push(
        k.kind === 'mixed'
          ? `Pattern ${pat} repaired ${n} — EITHER a dropped enqueue (leak) OR a pay-on-connect (designed). ` +
            `Check whether the payee's stripeConnectedAt is AFTER the refund window closed: if so this is the designed path, if not a real-time path leaked.`
          : `Pattern ${pat} repaired ${n} — a real-time path is leaking; investigate, don't rely on the sweep.`,
      )
    }
  }

  const finishedAt = new Date()
  sum.finishedAt = finishedAt.toISOString()
  sum.durationMs = finishedAt.getTime() - startedAt.getTime()

  // ── THE SUMMARY MUST BE UNCONDITIONAL AND PROD-VISIBLE (Q5) ──────────────────
  // logger.info is a HARD NO-OP in production (logger.ts: `if (!isDev) return`), so the old
  // info summary NEVER reached Railway — a sweep that changed the ledger logged "clean" while
  // repaired counts were invisible. The fix: one flat, greppable line at WARN (captured in
  // prod), emitted EVERY sweep, carrying repaired-per-pattern AND the resulting payable total.
  // Now silence provably means zero — it can't be info-suppressed. (info line kept for dev.)
  let ledger: LedgerBreakdown
  try {
    ledger = await computeLedgerBreakdown()
  } catch {
    ledger = { all: { payableCents: 0, paidCents: 0, cancelledCents: 0 }, byEvent: [], readable: false }
  }
  logger.warn(formatSweepSummary(sum, ledger))

  logger.info('[Reconciler] sweep complete', {
    dryRun, patternEEnabled, scanned: sum.scanned, repaired: sum.repaired,
    alerted: sum.alerted.length, ambiguousSkipped: sum.ambiguousSkipped, durationMs: sum.durationMs,
  })
  if (sum.alerted.length) logger.warn('[Reconciler] ALERTS (human review)', { alerted: sum.alerted })
  // ONE flat line, never one-per-row — the whole point is that a settled cohort stops
  // costing five lines a sweep. Deliberately NOT in ALERTS: nothing here needs a human.
  if (sum.suppressed.length) logger.warn(
    `[Reconciler] SUPPRESSED — ${sum.suppressed.length} known row(s), NO ACTION ` +
    `(declared in ACKNOWLEDGED_X2 or POLLUTED_TRANSFER_IDS)`,
  )
  if (sum.backstopWarnings.length) logger.warn('[Reconciler] BACKSTOP WARNINGS', { backstopWarnings: sum.backstopWarnings })

  // Worker liveness heartbeat (best-effort — never breaks the sweep). Reaching here means the
  // sweep RAN; /api/health reads this to tell a live-but-quiet sweep from a dead worker.
  await recordSweepHeartbeat()

  // Durable history (best-effort, same contract as the heartbeat above).
  await recordSweepRun(sum)

  return sum
}

/**
 * DURABLE SWEEP HISTORY — one row per completed sweep. See the SweepRun model for why.
 *
 * ⛔ BEST-EFFORT BY CONSTRUCTION. The entire body is inside try/catch and the function returns
 * void, so there is no failure mode in which recording the run can fail the run. That ordering
 * is deliberate and is the same contract recordSweepHeartbeat already has: this table is a
 * record OF the work, never a participant IN it. A database hiccup here must cost us the
 * knowledge that a sweep happened, never the sweep itself.
 *
 * It is also called LAST, after the heartbeat, so nothing downstream of the sweep's real work
 * depends on it — and a row's existence therefore means the sweep reached the end.
 */
export async function recordSweepRun(sum: SweepSummary): Promise<void> {
  try {
    await db.sweepRun.create({
      data: {
        startedAt: new Date(sum.startedAt),
        finishedAt: new Date(sum.finishedAt || Date.now()),
        durationMs: sum.durationMs,
        dryRun: sum.dryRun,
        commit: WORKER_COMMIT,
        // FULL map, zeros included — see the model comment: this records which patterns
        // existed at this commit, not merely which ones fired.
        repaired: sum.repaired as unknown as object,
        repairedTotal: Object.values(sum.repaired).reduce((s, n) => s + n, 0),
        alertedCount: sum.alerted.length,
        suppressedCount: sum.suppressed.length,
        ambiguousSkipped: sum.ambiguousSkipped,
      },
    })
  } catch (err) {
    // Logged, never rethrown. A lost row is a lost observation, not a lost sweep.
    logger.error('[Reconciler] failed to record SweepRun (sweep itself is unaffected)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export interface LedgerTotals { payableCents: number; paidCents: number; cancelledCents: number }
export interface EventLedger extends LedgerTotals { eventId: string; name: string }
/** readable=false ⇒ the ledger read failed; the line still emits, never swallowed. */
export interface LedgerBreakdown { all: LedgerTotals; byEvent: EventLedger[]; readable: boolean }

/**
 * The vendor ledger, split by event AND rolled up. WHY per-event: the sweep is global, but the
 * admin panel any human watches is PER-EVENT. A single global `payable` matched a panel only
 * while ONE event had accruals; the moment a second fair accrues, a global figure equals NO
 * panel and every watch procedure keyed to it silently goes wrong. So the summary carries both.
 * Fields mirror the panel: payable=Σsubtotal(accrued), paid=Σnet(paid), cancelled=Σsubtotal(cancelled).
 */
async function computeLedgerBreakdown(): Promise<LedgerBreakdown> {
  const grouped = await db.vendorEarning.groupBy({
    by: ['eventId', 'status'],
    where: { status: { in: ['accrued', 'paid', 'cancelled'] } },
    _sum: { subtotalCents: true, netCents: true },
  })
  const byId = new Map<string, LedgerTotals>()
  const all: LedgerTotals = { payableCents: 0, paidCents: 0, cancelledCents: 0 }
  for (const g of grouped) {
    let t = byId.get(g.eventId)
    if (!t) { t = { payableCents: 0, paidCents: 0, cancelledCents: 0 }; byId.set(g.eventId, t) }
    const sub = g._sum.subtotalCents ?? 0
    const net = g._sum.netCents ?? 0
    if (g.status === 'accrued')   { t.payableCents += sub;   all.payableCents += sub }
    if (g.status === 'paid')      { t.paidCents += net;      all.paidCents += net }
    if (g.status === 'cancelled') { t.cancelledCents += sub; all.cancelledCents += sub }
  }
  const ids = [...byId.keys()]
  const events = ids.length ? await db.event.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nameOf = new Map(events.map(e => [e.id, e.name]))
  const byEvent: EventLedger[] = ids
    .map(id => ({ eventId: id, name: nameOf.get(id) ?? id, ...byId.get(id)! }))
    .filter(e => e.payableCents || e.paidCents || e.cancelledCents)
    .sort((a, b) => b.payableCents - a.payableCents)
  return { all, byEvent, readable: true }
}

/**
 * The one flat, greppable sweep-summary line — pure, so it can be proven without running a
 * sweep. Always names the repaired TOTAL (so "repaired=0" is an explicit, unmissable zero),
 * lists only the non-zero patterns, and carries the vendor ledger BOTH globally (labeled
 * [all-events]) and PER-EVENT, so a watch on one fair stays correct once a second fair
 * accrues. `[Reconciler] SUMMARY` is the grep anchor; any non-zero repaired signals money moved.
 */
export function formatSweepSummary(sum: SweepSummary, ledger: LedgerBreakdown): string {
  const total = Object.values(sum.repaired).reduce((a, b) => a + b, 0)
  const nonZero = Object.entries(sum.repaired).filter(([, n]) => n > 0).map(([p, n]) => `${p}${n}`).join(' ')
  const m = (c: number) => `$${(c / 100).toFixed(2)}`
  const ledgerStr = !ledger.readable
    ? 'payable=(unreadable)'
    : `payable=${m(ledger.all.payableCents)} paid=${m(ledger.all.paidCents)} cancelled=${m(ledger.all.cancelledCents)} [all-events]`
  const perEvent = ledger.readable && ledger.byEvent.length
    ? ' | by-event: ' + ledger.byEvent.slice(0, 10).map(e =>
        `${e.name}(pay=${m(e.payableCents)} paid=${m(e.paidCents)} canc=${m(e.cancelledCents)})`).join(' ')
      + (ledger.byEvent.length > 10 ? ` +${ledger.byEvent.length - 10} more` : '')
    : ''
  return `[Reconciler] SUMMARY repaired=${total}${nonZero ? ` [${nonZero}]` : ''} ${ledgerStr}${perEvent} ` +
    `alerts=${sum.alerted.length} suppressed=${sum.suppressed.length} ` +
    `ambiguousSkipped=${sum.ambiguousSkipped} dryRun=${sum.dryRun} ${sum.durationMs}ms`
}

// ─── PATTERN A — Paid in Stripe, not fully placed (boundary 1) ───────────────
// List recent SUCCEEDED PIs that are OURS (metadata marker). For each, find the
// order by PI id. If missing → ALERT (cannot reconstruct without reimplementing
// placement). If PENDING_PAYMENT or PLACED-with-0-vendor-rows → placePaidOrder
// converges it. Catches money-in-Stripe with no/half order even if BOTH the
// client confirm AND the webhook failed.
async function patternA(
  sum: SweepSummary,
  o: { stripeWindowHours: number; maxStripePages: number; dryRun: boolean },
) {
  if (!process.env.STRIPE_SECRET_KEY) {
    sum.alerted.push('Pattern A skipped — STRIPE_SECRET_KEY unset')
    return
  }
  const createdGte = Math.floor((Date.now() - o.stripeWindowHours * 3600_000) / 1000)

  let startingAfter: string | undefined
  for (let page = 0; page < o.maxStripePages; page++) {
    const res = await stripe.paymentIntents.list({
      created: { gte: createdGte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const pi of res.data) {
      // OUR-platform marker: our checkout always stamps eventId + customerId.
      // Filtering on it ignores unrelated charges on the same Stripe account.
      const isOurs = !!(pi.metadata?.eventId && pi.metadata?.customerId)
      if (!isOurs || pi.status !== 'succeeded') continue
      sum.scanned.stripePIs++

      const order = await db.order.findFirst({
        where: { stripePaymentIntentId: pi.id, voidedAt: null },
        select: {
          id: true, status: true,
          _count: { select: { vendorOrderStatuses: true } },
        },
      })

      if (!order) {
        // Money exists in Stripe but no order row at all. We will NOT reconstruct
        // the order from metadata (that reimplements placement). Flag for a human.
        sum.alerted.push(`Pattern A: succeeded PI ${pi.id} has NO order row — human review (place or refund manually)`)
        continue
      }

      const needsPlacement =
        order.status === OrderStatus.PENDING_PAYMENT ||
        (order.status === OrderStatus.PLACED && order._count.vendorOrderStatuses === 0)
      if (!needsPlacement) continue

      if (o.dryRun) { sum.repaired.A++; sum.details.A.push(order.id); continue }

      const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : undefined
      const r = await placePaidOrder(order.id, chargeId)
      if (r.placed) { sum.repaired.A++; sum.details.A.push(order.id) }
    }
    if (!res.has_more) break
    startingAfter = res.data[res.data.length - 1]?.id
  }
}

// ─── PATTERN B — Active order, 0 vendor rows (boundary 2) ────────────────────
// An order at PLACED+ with zero VendorOrderStatus rows is invisible to vendors.
// placePaidOrder converges (creates the rows, re-pushes Firebase, schedules the
// accept-timeout). Idempotent.
async function patternB(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const candidates = await db.order.findMany({
    where: {
      status: { in: ACTIVE_STATES },
      placedAt: { gte: o.windowStart },
      vendorOrderStatuses: { none: {} },
      voidedAt: null,
    },
    select: { id: true },
    orderBy: { placedAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.activeOrders += candidates.length

  for (const c of candidates) {
    if (o.dryRun) { sum.repaired.B++; sum.details.B.push(c.id); continue }
    const r = await placePaidOrder(c.id)
    if (r.placed) { sum.repaired.B++; sum.details.B.push(c.id) }
  }
}

// ─── PATTERN C — COMPLETED without payout (boundary 4, the critical one) ─────
// For each terminal-complete order, every PAYABLE vendor must be covered by a
// Payout row, a PayoutHold, or a DECLINED status. A vendor covered by none was
// never paid → the enqueue dropped (worker/Redis down). enqueueOrderPayout is
// idempotent (jobId dedup + Stripe per-order+vendor idempotency keys + Payout
// upsert), so re-running can never double-pay — but we still gate detection so
// covered orders are never re-enqueued needlessly.
async function patternC(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  // WINDOW BOUNDARY (decision C2): payout fires at completedAt + REFUND_WINDOW_MS.
  // Pattern C must ONLY flag orders whose window has CLOSED — otherwise it would
  // pay every order immediately and defeat the refund window. The band is:
  //   windowStart (boundedness lower bound) ≤ completedAt < now − REFUND_WINDOW_MS
  // i.e. completed long enough ago that the delayed payout should already have
  // fired, but recent enough to still be in scan range.
  const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
  const orders = await db.order.findMany({
    where: {
      status: { in: COMPLETE_STATES },
      completedAt: { gte: o.windowStart, lt: windowClosedBefore },
      voidedAt: null,
    },
    select: {
      id: true, eventId: true,
      total: true, fairSynqFee: true, deliveryFee: true, serviceCharge: true, tip: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      payouts: { select: { vendorId: true } },
      payoutHolds: { select: { vendorId: true } },
      refunds: { select: { vendorId: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
      // C1: admin-gated slices. An admin hold writes NO PayoutHold row (that table is
      // the "pay me when I connect" waiting room that Pattern D drains), so without
      // this the gap check below would see a held vendor as an unpaid gap and
      // re-enqueue the payout on EVERY sweep.
      vendorEarnings: { select: { vendorId: true, status: true } },
    },
    orderBy: { completedAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.completedOrders += orders.length

  for (const ord of orders) {
    const payableVendors = new Set(ord.orderItems.map(i => i.vendorId))
    const paid = new Set(ord.payouts.map(p => p.vendorId))
    const held = new Set(ord.payoutHolds.map(h => h.vendorId))
    const refunded = new Set(ord.refunds.map(r => r.vendorId))
    const declined = new Set(
      ord.vendorOrderStatuses
        .filter(s => s.status === 'DECLINED' || s.status === 'REFUNDED')
        .map(s => s.vendorId),
    )
    // C1 — admin-blocked vendors. NOT a gap: the money is deliberately parked in the
    // platform balance. This is an ANTI-CHURN optimisation only; correctness does not
    // depend on it, because processOrderPayout's gate refuses these slices even if
    // this pattern does enqueue them. Belt (gate) and braces (this).
    const adminBlocked = new Set(
      ord.vendorEarnings
        .filter(e => e.status === 'held' || e.status === 'cancelled')
        .map(e => e.vendorId),
    )

    // A gap = a payable vendor with no payout, no hold, not admin-blocked, not
    // declined, NOT refunded. (A refunded vendor must never be paid — their slice
    // went back to the customer.)
    const gap = [...payableVendors].some(
      v => !paid.has(v) && !held.has(v) && !adminBlocked.has(v) && !declined.has(v) && !refunded.has(v),
    )
    if (!gap) continue

    // Pre-flight the SAME customer-side money identity processOrderPayout asserts
    // first. If it doesn't hold (e.g. total omits the service fee — malformed
    // data), the payout would HALT and never settle. Re-enqueuing it every sweep
    // is futile noise, so we DON'T act on this ambiguous money — we ALERT it for
    // a human. Under-pay-and-flag beats churning an unreconcilable order forever.
    const subtotalCents = ord.orderItems.reduce((s, i) => s + Math.round(i.subtotal * 100), 0)
    const customerSide = subtotalCents
      + Math.round(ord.fairSynqFee * 100)
      + Math.round((ord.deliveryFee ?? 0) * 100)
      + Math.round((ord.serviceCharge ?? 0) * 100)
      + Math.round((ord.tip ?? 0) * 100)
    const totalCents = Math.round(ord.total * 100)
    if (customerSide !== totalCents) {
      sum.ambiguousSkipped++
      sum.alerted.push(
        `Pattern C: order ${ord.id} has an UNRECONCILABLE money identity ` +
        `(charge ${totalCents}¢ ≠ subtotal ${subtotalCents} + fee ${Math.round(ord.fairSynqFee * 100)} ` +
        `+ delivery ${Math.round((ord.deliveryFee ?? 0) * 100)} + serviceCharge ${Math.round((ord.serviceCharge ?? 0) * 100)} ` +
        `+ tip ${Math.round((ord.tip ?? 0) * 100)}) ` +
        `— payout would halt; manual review (do NOT auto-pay)`,
      )
      continue
    }

    if (o.dryRun) { sum.repaired.C++; sum.details.C.push(ord.id); continue }
    // enqueueOrderPayout → worker runs processOrderPayout (proven, idempotent).
    const ok = await enqueueOrderPayout({ orderId: ord.id, eventId: ord.eventId })
    if (ok) { sum.repaired.C++; sum.details.C.push(ord.id) }
    else { sum.alerted.push(`Pattern C: payout enqueue DROPPED for order ${ord.id} — Redis/queue down`) }
  }
}

// ─── PATTERN D — Unresolved hold for a now-verified vendor (boundary 4b) ─────
// A held slice whose vendor has since completed Stripe onboarding can now be
// paid. enqueueOrderPayout → worker pays the connected vendor and resolves the
// hold (processOrderPayout marks resolved on a successful transfer).
async function patternD(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  const holds = await db.payoutHold.findMany({
    where: {
      resolved: false,
      // C1: a frozen vendor's holds are NOT drained. Anti-churn only — an admin hold
      // never lands in this table in the first place, and processOrderPayout's gate
      // is the authoritative stop either way.
      vendor: { stripeVerified: true, stripeAccountId: { not: null }, payoutsFrozenAt: null },
      order: { voidedAt: null },
    },
    select: { orderId: true, eventId: true, vendorId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  sum.scanned.unresolvedHolds += holds.length

  // One enqueue per order (a single payout run covers all that order's holds).
  const seen = new Set<string>()
  for (const h of holds) {
    if (seen.has(h.orderId)) continue
    seen.add(h.orderId)
    if (o.dryRun) { sum.repaired.D++; sum.details.D.push(h.orderId); continue }
    const ok = await enqueueOrderPayout({ orderId: h.orderId, eventId: h.eventId })
    if (ok) { sum.repaired.D++; sum.details.D.push(h.orderId) }
    else { sum.alerted.push(`Pattern D: payout enqueue DROPPED for held order ${h.orderId} — Redis/queue down`) }
  }
}

// ─── PATTERN E — Stuck PLACED past the accept window (boundary 3b) ───────────
// An order PLACED longer than the accept window with NO vendor action means the
// accept-timeout never fired (worker/Redis down at enqueue time). Re-enqueuing
// JOB_UNACCEPTED runs the EXACT SAME handler that the real-time path uses (it
// re-checks status===PLACED and cancels+refunds). DANGEROUS: it moves money, so
// it ACTS only when patternEEnabled; otherwise it ALERTS the orders it WOULD act
// on — the log-only first pass that protects test orders on debut.
async function patternE(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean; patternEEnabled: boolean },
) {
  const cutoff = new Date(Date.now() - VENDOR_ACCEPT_TIMEOUT_MS)
  const candidates = await db.order.findMany({
    where: {
      status: OrderStatus.PLACED,
      placedAt: { gte: o.windowStart, lt: cutoff },
      // No vendor has moved off PLACED (no acceptance/decline/progress anywhere).
      vendorOrderStatuses: { none: { status: { not: 'PLACED' } } },
      voidedAt: null,
    },
    select: { id: true, eventId: true, vendorId: true, placedAt: true },
    orderBy: { placedAt: 'asc' },
    take: o.maxPerPattern,
  })

  if (!o.patternEEnabled || o.dryRun) {
    // Log-only: surface exactly which orders WOULD be cancelled+refunded.
    for (const c of candidates) {
      sum.details.E.push(c.id)
      sum.alerted.push(
        `Pattern E (LOG-ONLY): order ${c.id} PLACED since ${c.placedAt.toISOString()} would be auto-cancelled+refunded` +
        `${o.patternEEnabled ? ' (dryRun)' : ' (set RECONCILER_PATTERN_E_ENABLED=true to act)'}`,
      )
    }
    return
  }

  const queue = getOrderQueue()
  if (!queue) {
    if (candidates.length) sum.alerted.push(`Pattern E: ${candidates.length} stuck order(s) but queue unavailable`)
    return
  }
  for (const c of candidates) {
    // Reuse the real-time accept-timeout job; jobId dedupes against any still-
    // pending original. delay:0 fires it now.
    const r = await enqueueJobSafely({
      queue,
      name: JOB_UNACCEPTED,
      data: { orderId: c.id, vendorId: c.vendorId, eventId: c.eventId },
      jobId: `unaccepted-${c.id}`,
      delay: 0,
      priority: 'normal',
    })
    if (r !== 'dropped') { sum.repaired.E++; sum.details.E.push(c.id) }
    else { sum.alerted.push(`Pattern E: accept-timeout enqueue DROPPED for order ${c.id}`) }
  }
}

// ─── PATTERN F — Stale PENDING_PAYMENT (boundary 5) ──────────────────────────
// A PENDING_PAYMENT order older than the stale floor is either a paid order
// whose placement was missed, or an abandoned/declined checkout. Ask Stripe:
//   succeeded                → placePaidOrder (dedupes with Pattern A)
//   canceled / no PI          → phantom: delete the unpaid row (no money moved)
//   anything else (ambiguous) → leave + count ambiguousSkipped (never delete a
//                               checkout that might still complete)
async function patternF(
  sum: SweepSummary,
  o: { pendingStaleHours: number; maxPerPattern: number; dryRun: boolean },
) {
  const cutoff = new Date(Date.now() - o.pendingStaleHours * 3600_000)
  const candidates = await db.order.findMany({
    where: { status: OrderStatus.PENDING_PAYMENT, createdAt: { lt: cutoff }, voidedAt: null },
    select: { id: true, stripePaymentIntentId: true },
    orderBy: { createdAt: 'asc' },
    take: o.maxPerPattern,
  })
  sum.scanned.pendingOrders += candidates.length

  for (const c of candidates) {
    let piStatus: string | 'missing' = 'missing'
    if (process.env.STRIPE_SECRET_KEY && c.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(c.stripePaymentIntentId)
        piStatus = pi.status
        if (pi.status === 'succeeded') {
          if (o.dryRun) { sum.repaired.F++; sum.details.F.push(c.id); continue }
          const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : undefined
          const r = await placePaidOrder(c.id, chargeId)
          if (r.placed) { sum.repaired.F++; sum.details.F.push(c.id) }
          continue
        }
      } catch {
        piStatus = 'missing' // PI not retrievable → never really charged
      }
    }

    // Safe to clean up ONLY when we're certain no money is at stake.
    const isPhantom = piStatus === 'canceled' || piStatus === 'missing'
    if (!isPhantom) { sum.ambiguousSkipped++; continue } // requires_payment_method / processing → leave

    if (o.dryRun) { sum.repaired.F++; sum.details.F.push(c.id); continue }
    await db.$transaction([
      db.vendorOrderStatus.deleteMany({ where: { orderId: c.id } }),
      db.orderItem.deleteMany({ where: { orderId: c.id } }),
      db.order.deleteMany({ where: { id: c.id, status: OrderStatus.PENDING_PAYMENT } }),
    ])
    sum.repaired.F++; sum.details.F.push(c.id)
  }
}

// ─── PATTERN G — Refund PENDING/FAILED past a threshold (refund backstop) ────
// A Refund row stuck PENDING/FAILED means refundVendorPortion started but didn't
// finish (Stripe hiccup, crash mid-flight). Re-run it — it's idempotent (Stripe
// idempotency keys + Refund-row upsert), so a partially-done refund converges and
// a done one is a no-op. Reuses the engine, never reimplements refund logic.
async function patternG(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  // Small grace period so we don't race a refund that's completing right now.
  const cutoff = new Date(Date.now() - 2 * 60 * 1000) // 2 min
  const stuck = await db.refund.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      updatedAt: { lt: cutoff },
      order: { voidedAt: null },
    },
    select: { orderId: true, vendorId: true, reason: true },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })

  for (const r of stuck) {
    if (o.dryRun) { sum.repaired.G++; sum.details.G.push(`${r.orderId}:${r.vendorId}`); continue }
    try {
      const res = await refundVendorPortion({
        orderId: r.orderId, vendorId: r.vendorId,
        reason: r.reason ?? 'reconciler retry', actor: 'reconciler',
      })
      if (res.status === 'refunded' || res.status === 'noop') {
        sum.repaired.G++; sum.details.G.push(`${r.orderId}:${r.vendorId}`)
      }
    } catch (err) {
      // Reconciliation halt or Stripe error — never silently pass; flag it.
      sum.alerted.push(`Pattern G: refund retry FAILED for ${r.orderId}:${r.vendorId} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN H — Vendor portion marked REFUNDED but no completed refund ──────
// A VendorOrderStatus='REFUNDED' with no COMPLETED Refund row = a half-done state
// (status flipped but the money record never settled). Re-run the engine to make
// the Stripe refund real, or surface it if it can't reconcile. Bounded by window.
async function patternH(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const rows = await db.vendorOrderStatus.findMany({
    where: {
      status: 'REFUNDED',
      updatedAt: { gte: o.windowStart },
      order: { voidedAt: null },
    },
    select: { orderId: true, vendorId: true },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  if (rows.length === 0) return

  // Which (order,vendor) already have a COMPLETED refund? Those are fine.
  const completed = await db.refund.findMany({
    where: { status: 'COMPLETED', orderId: { in: rows.map(r => r.orderId) } },
    select: { orderId: true, vendorId: true },
  })
  const done = new Set(completed.map(c => `${c.orderId}:${c.vendorId}`))

  for (const r of rows) {
    if (done.has(`${r.orderId}:${r.vendorId}`)) continue // money already settled
    if (o.dryRun) { sum.repaired.H++; sum.details.H.push(`${r.orderId}:${r.vendorId}`); continue }
    try {
      const res = await refundVendorPortion({
        orderId: r.orderId, vendorId: r.vendorId, reason: 'reconciler repair (REFUNDED w/o refund)', actor: 'reconciler',
      })
      if (res.status === 'refunded' || res.status === 'noop') {
        sum.repaired.H++; sum.details.H.push(`${r.orderId}:${r.vendorId}`)
      }
    } catch (err) {
      sum.alerted.push(`Pattern H: repair FAILED for ${r.orderId}:${r.vendorId} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN I — Chargeback clawback not fully done → retry ──────────────────
// A Chargeback whose clawback is pending/partial (a vendor reversal failed at
// dispute time). Re-run via the shared retry (idempotent — reverses only the
// not-yet-reversed paid vendors).
async function patternI(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  const stuck = await db.chargeback.findMany({
    where: { clawbackStatus: { in: ['pending', 'partial'] } },
    select: { id: true, orderId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  for (const cb of stuck) {
    if (o.dryRun) { sum.repaired.I++; sum.details.I.push(cb.id); continue }
    try {
      await retryChargebackClawback(cb.id)
      sum.repaired.I++; sum.details.I.push(cb.id)
    } catch (err) {
      sum.alerted.push(`Pattern I: chargeback clawback retry FAILED for ${cb.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN J — Chargeback not yet closed, aging → surface for manual check ─
// The webhook reconciles WON/LOST; this is a backstop if a closed event was
// missed. We do NOT auto-move money — just alert so an admin checks Stripe.
async function patternJ(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000) // 7 days
  const open = await db.chargeback.findMany({
    where: { status: { notIn: ['won', 'lost', 'warning_closed'] }, createdAt: { lt: cutoff } },
    select: { id: true, stripeDisputeId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  for (const cb of open) {
    sum.details.J.push(cb.id)
    sum.alerted.push(`Pattern J: chargeback ${cb.stripeDisputeId} unresolved >7d — verify WON/LOST in Stripe (no auto-move)`)
  }
}

// ─── PATTERN K — Unresolved dispute debts → surface (chase) ──────────────────
// Open NegativeBalanceEvents from disputes (clawback gaps FairSynq fronted, or
// the recoverable dispute fee). These are vendor debts — surface, never auto-act.
async function patternK(
  sum: SweepSummary,
  o: { maxPerPattern: number },
) {
  const debts = await db.negativeBalanceEvent.findMany({
    where: { status: 'open', kind: { in: ['dispute_clawback', 'dispute_fee'] } },
    select: { id: true, vendorId: true, amountCents: true, kind: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  let total = 0
  for (const d of debts) {
    total += d.amountCents
    sum.details.K.push(d.id)
  }
  if (debts.length > 0) {
    sum.alerted.push(`Pattern K: ${debts.length} open dispute debt(s) totalling ${total}¢ — vendors owe FairSynq (chase; no auto-deduct)`)
  }
}

// ─── PATTERN L — Earnings decomposition + tip location (Part A) ───────────────
// Asserts the recorded runner/organizer earnings reconcile to the order's fee +
// tip to the cent, and that the tip lands in EXACTLY ONE place: the runner's
// earning when delivered, or owed-back-to-customer when cancelled with no runner.
// Alert-only — never moves money (runner/organizer payouts + tip refunds are a
// later money-flow phase). This is the guard that the tip is never silently kept.
async function patternL(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number },
) {
  // 1. DELIVERED runner-fulfilled orders → earnings must decompose exactly.
  // Window by updatedAt, NOT completedAt: DELIVERED never sets completedAt (only
  // COMPLETED does), so the old completedAt filter silently matched ZERO delivered
  // orders — the earnings-decomposition audit never ran on them. updatedAt is
  // touched on the DELIVERED write, so it's the correct "recently delivered" bound.
  const delivered = await db.order.findMany({
    where: {
      status: OrderStatus.DELIVERED,
      updatedAt: { gte: o.windowStart },
      OR: [{ deliveryFee: { gt: 0 } }, { tip: { gt: 0 } }],
    },
    select: {
      id: true, deliveryFee: true, tip: true,
      runnerEarning: { select: { amountCents: true } },
      organizerEarning: { select: { amountCents: true } },
      event: { select: { fulfillmentConfig: { select: { runnerFeePercent: true } } } },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  for (const ord of delivered) {
    const feeCents = Math.round((ord.deliveryFee ?? 0) * 100)
    const tipCents = Math.round((ord.tip ?? 0) * 100)
    const pct = ord.event?.fulfillmentConfig?.runnerFeePercent ?? 0
    const { runnerShareCents, organizerShareCents } = splitRunnerFee(feeCents, pct)
    const expectedRunner = runnerShareCents + tipCents
    const recordedRunner = ord.runnerEarning?.amountCents ?? null
    const recordedOrg = ord.organizerEarning?.amountCents ?? 0

    if (recordedRunner == null) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} DELIVERED with fee/tip but NO RunnerEarning — runner owed ${expectedRunner}¢ unrecorded`)
      continue
    }
    if (recordedRunner !== expectedRunner) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} RunnerEarning ${recordedRunner}¢ ≠ runnerShare ${runnerShareCents} + tip ${tipCents}`)
      continue
    }
    if (recordedOrg !== organizerShareCents) {
      sum.details.L.push(ord.id)
      sum.alerted.push(`Pattern L: order ${ord.id} OrganizerEarning ${recordedOrg}¢ ≠ organizerShare ${organizerShareCents}`)
    }
  }

  // 2. Tip in limbo: a CANCELLED runner-fulfilled order with a tip but no runner
  //    earned it → the tip is OWED BACK to the customer, never kept by FairSynq.
  //    Surface any such tip so it is never silently retained as revenue.
  // Only alert on the STILL-UNREFUNDED owed-back tips: once Pattern R refunds one
  // (tipRefundId set) it must go quiet (no double-alerting on resolved tips).
  const cancelledTipped = await db.order.findMany({
    where: { status: OrderStatus.CANCELLED, tip: { gt: 0 }, runnerEarning: { is: null }, tipRefundId: null },
    select: { id: true, tip: true },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })
  for (const ord of cancelledTipped) {
    sum.details.L.push(ord.id)
    sum.alerted.push(`Pattern L: cancelled order ${ord.id} has a ${Math.round((ord.tip ?? 0) * 100)}¢ tip but no runner earned it — OWED BACK to customer (Pattern R executes the refund; alert means not yet refunded)`)
  }
}

// ─── PATTERN M — Fully-refunded order whose master is still non-terminal ──────
// The order-status shadow sweep surfaced orders sitting at a non-terminal master
// status (PLACED/ACCEPTED/…) where every vendor portion is terminal AND at least
// one is REFUNDED — i.e. the order is fully refunded but the master status never
// moved off its in-flight value.
//
// The status aggregator (lib/reconcile-order-status.ts) deliberately ABSTAINS on
// these: REFUNDED is a lossy money event — from per-vendor status alone you can't
// tell a cancelled-then-refunded order from a completed-then-refunded one, so the
// status deriver must NOT fabricate CANCELLED. Whether such an order SHOULD be
// terminal is a MONEY judgment that lives in the Refund rows, not the status
// machine — so it belongs here, in the money/reconciler domain.
//
// ALERT-ONLY. We never auto-set CANCELLED (same discipline as Patterns J/K): the
// refund's nature decides the right terminal, and a human/refund-policy owns that
// call. This just guarantees the smell is never silently left as "refunded but
// PLACED".
async function patternM(
  sum: SweepSummary,
  o: { scanCeiling: number; maxPerPattern: number },
) {
  const FAILED = new Set(['DECLINED', 'REFUNDED', 'CANCELLED'])

  // Non-terminal master orders, with their per-vendor truth. (voided excluded.)
  const candidates = await db.order.findMany({
    where: { status: { in: ACTIVE_STATES }, voidedAt: null },
    select: { id: true, status: true, vendorOrderStatuses: { select: { status: true } } },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: o.scanCeiling,
  })

  if (candidates.length >= o.scanCeiling) sum.alerted.push(
    `Pattern M: SCAN CEILING HIT — ${candidates.length} rows at the ${o.scanCeiling} limit. Orders beyond it were NOT examined this sweep. Raise scanCeiling.`,
  )

  for (const ord of candidates) {
    const rows = ord.vendorOrderStatuses
    if (rows.length === 0) continue // no per-vendor truth — not this pattern's concern
    const allTerminal = rows.every(r => FAILED.has(r.status))
    const anyRefunded = rows.some(r => r.status === 'REFUNDED')
    if (allTerminal && anyRefunded) {
      sum.details.M.push(ord.id)
      sum.alerted.push(
        `Pattern M: order ${ord.id} is fully refunded (portions ${rows.map(r => r.status).join('/')}) ` +
        `but master status is still ${ord.status} — review whether it should be terminal ` +
        `(money judgment; status aggregator abstains, no auto-cancel)`
      )
    }
  }
}

// ─── PATTERN N — Master-status drift backstop (the no-side-door guarantee) ────
// The convergence's final guarantee: master Order.status is now owned by ONE
// function (reconcileMasterStatus), so for any active order the stored status
// should already equal what the aggregator DERIVES from per-vendor truth + the
// runner overlay. If it diverges AND the derivation is a forward (canAdvance)
// move, some path wrote status outside the aggregator — drift. On a converged
// board this should be ZERO; a non-zero count is the early-warning that a new
// writer slipped the net.
//
// REPAIRS only when backstopEnabled (calls the aggregator → which fires real
// side-effects: payout enqueue, earnings accrual). Default ALERT-ONLY — the same
// log-first debut as Pattern E, so it can never auto-move money on first run.
// Asserted/terminal states (UNCOLLECTED/UNDELIVERABLE/cancel) are NOT drift — the
// derivation can't see them, so it abstains and canAdvance refuses; they're skipped.
async function patternN(
  sum: SweepSummary,
  o: { scanCeiling: number; maxPerPattern: number; backstopEnabled: boolean },
) {
  const DERIVED_OK = new Set<MasterStatus>(['READY', 'RUNNER_COLLECTED', 'COMPLETED', 'DELIVERED', 'CANCELLED'])

  const candidates = await db.order.findMany({
    where: { status: { in: ACTIVE_STATES }, voidedAt: null },
    select: {
      id: true, status: true, fulfillmentType: true, runnerId: true,
      deliveryProofPath: true, vendorOrderStatuses: { select: { status: true } },
    },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: o.scanCeiling,
  })

  if (candidates.length >= o.scanCeiling) sum.alerted.push(
    `Pattern N: SCAN CEILING HIT — ${candidates.length} rows at the ${o.scanCeiling} limit. Orders beyond it were NOT examined this sweep. Raise scanCeiling.`,
  )

  for (const ord of candidates) {
    if (ord.vendorOrderStatuses.length === 0) continue // no jurisdiction (pre-placement / legacy)
    const stored = ord.status as MasterStatus
    const { derived } = deriveMasterStatus({
      fulfillmentType: ord.fulfillmentType as FulfillmentType,
      vendorStatuses: ord.vendorOrderStatuses,
      runnerId: ord.runnerId,
      deliveryProofPath: ord.deliveryProofPath,
    })
    if (derived === 'SKIP' || !DERIVED_OK.has(derived)) continue // abstain / not derivable
    if (!canAdvance(stored, derived)) continue                   // already at/ahead of derived — no drift
    if (stored === derived) continue

    // Genuine drift: stored lags the derivable truth.
    if (!o.backstopEnabled) {
      sum.details.N.push(ord.id)
      sum.alerted.push(`Pattern N: order ${ord.id} status ${stored} but per-vendor truth derives ${derived} — DRIFT (a writer bypassed the aggregator). ALERT-only; set RECONCILER_BACKSTOP_ENABLED to auto-heal`)
      continue
    }
    try {
      const rec = await reconcileMasterStatus(ord.id) // heal through the single owner (+ its side-effects)
      if (rec.wrote) { sum.repaired.N++; sum.details.N.push(ord.id) }
    } catch (err) {
      sum.alerted.push(`Pattern N: heal FAILED for ${ord.id} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── PATTERN O — Stranded READY delivery with no runner → surface ─────────────
// The stranding state Phase 1 created: a delivery/curbside order promoted to
// master READY that no runner ever claimed. The UNDELIVERABLE/UNCOLLECTED timeout
// eventually terminates it, but this surfaces the strand EARLIER (food ready, no
// driver) for ops visibility. ALERT-only — the timeout owns the terminal write.
async function patternO(
  sum: SweepSummary,
  o: { scanCeiling: number; maxPerPattern: number },
) {
  const cutoff = new Date(Date.now() - CURBSIDE_WAIT_TIMEOUT_MS)
  const stranded = await db.order.findMany({
    where: {
      status: OrderStatus.READY,
      runnerId: null,
      voidedAt: null,
      fulfillmentType: { in: ['HOME_DELIVERY', 'CURBSIDE'] as never },
      readyAt: { lt: cutoff },
    },
    select: { id: true, fulfillmentType: true, readyAt: true },
    orderBy: [{ readyAt: 'asc' }, { id: 'asc' }],
    take: o.scanCeiling,
  })

  if (stranded.length >= o.scanCeiling) sum.alerted.push(
    `Pattern O: SCAN CEILING HIT — ${stranded.length} rows at the ${o.scanCeiling} limit. Orders beyond it were NOT examined this sweep. Raise scanCeiling.`,
  )
  for (const ord of stranded) {
    const mins = ord.readyAt ? Math.round((Date.now() - ord.readyAt.getTime()) / 60000) : null
    sum.details.O.push(ord.id)
    sum.alerted.push(`Pattern O: ${ord.fulfillmentType} order ${ord.id} READY ${mins}min with NO runner — stranded delivery (food ready, no driver claimed)`)
  }
}

// ─── PATTERN P — Runner payout backstop + pay-when-connected (Part B B2) ──────
// Pays every eligible runner earning (status='tracked', runner connected, refund
// window closed). This is BOTH the post-window backstop for a dropped DELIVERED
// enqueue (like Pattern C for vendors) AND the pay-when-a-held-runner-connects
// mechanism (like Pattern D — an unconnected runner's earning held in the ledger,
// paid here once they onboard). Delegates to reconcileRunnerPayouts, which routes
// through processRunnerPayout (idempotent — never double-pays, never reimplements
// payout math). dryRun detects-without-paying.
async function patternP(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    // Count what WOULD pay without moving money: tracked + connected + window-closed.
    const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
    const eligible = await db.runnerEarning.findMany({
      where: {
        status: 'tracked',
        createdAt: { lt: windowClosedBefore },
        order: { voidedAt: null },
        runner: { stripeVerified: true, stripeAccountId: { not: null } },
      },
      select: { orderId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: o.maxPerPattern,
    })
    for (const e of eligible) { sum.repaired.P++; sum.details.P.push(e.orderId) }
    return
  }

  const res = await reconcileRunnerPayouts({ maxPerRun: o.maxPerPattern })
  sum.repaired.P += res.paid
  for (const a of res.alerts) sum.alerted.push(`Pattern P: ${a}`)
}

// ─── PATTERN Q — Organizer batch payout backstop + pay-when-connected (B3) ────
// Pays each eligible event's organizer batch (accrued + connected + window-closed),
// re-attempts stuck pending batches (crash recovery), and is the pay-when-an-
// organizer-connects mechanism. Delegates to reconcileOrganizerPayouts → routes
// through processEventOrganizerPayout (idempotent; batch-id anchored). dryRun
// counts events that WOULD pay without moving money.
async function patternQ(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
    const accrued = await db.organizerEarning.findMany({
      where: {
        status: 'accrued',
        createdAt: { lt: windowClosedBefore },
        order: { voidedAt: null },
      },
      select: { eventId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: o.maxPerPattern * 10,
    })
    const events = [...new Set(accrued.map(a => a.eventId))].slice(0, o.maxPerPattern)
    for (const e of events) { sum.repaired.Q++; sum.details.Q.push(e) }
    return
  }

  const res = await reconcileOrganizerPayouts({ maxPerRun: o.maxPerPattern })
  sum.repaired.Q += res.paid
  for (const a of res.alerts) sum.alerted.push(`Pattern Q: ${a}`)
}

// ─── PATTERN R — Tip-refund execution (Part B B4) — the paying sibling of L ────
// Executes the owed-back tips Pattern L only ALERTED on: a CANCELLED runner-
// fulfilled order with a tip but NO RunnerEarning → the tip is owed back to the
// customer (no one earned it). Delegates to reconcileTipRefunds → routes through
// processTipRefund (idempotent; idempotencyKey tip_refund_${orderId}; policy gate
// re-checked at execute so a runner-earned tip is NEVER refunded). dryRun counts
// what WOULD refund without moving money. Pattern L (narrowed to tipRefundId=null)
// keeps alerting on any R couldn't auto-execute (e.g. no charge).
async function patternR(
  sum: SweepSummary,
  o: { scanCeiling: number; maxPerPattern: number; dryRun: boolean },
) {
  if (o.dryRun) {
    const owed = await db.order.findMany({
      where: {
        status: OrderStatus.CANCELLED, tip: { gt: 0 },
        runnerEarning: { is: null }, tipRefundId: null, voidedAt: null,
      },
      select: { id: true },
      orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
      take: o.scanCeiling,
    })

  if (owed.length >= o.scanCeiling) sum.alerted.push(
    `Pattern R: SCAN CEILING HIT — ${owed.length} rows at the ${o.scanCeiling} limit. Orders beyond it were NOT examined this sweep. Raise scanCeiling.`,
  )
    for (const ord of owed) { sum.repaired.R++; sum.details.R.push(ord.id) }
    return
  }

  const res = await reconcileTipRefunds({ maxPerRun: o.maxPerPattern })
  sum.repaired.R += res.refunded
  for (const a of res.alerts) sum.alerted.push(`Pattern R: ${a}`)
}

// ─── PATTERN S — Missing VendorEarning accrual (C1 hardening) ─────────────────
// The recovery half of the completion-path vendor accrual.
//
// WHAT IT GUARDS. VendorEarning is accrued in reconcileMasterStatus at
// COMPLETED/DELIVERED. That write is fail-soft ON PURPOSE — it must never block an
// order completing or a vendor being paid. But when it fails, something real IS lost:
// the row is the admin's per-order HOLD TARGET and the money view's source, so a
// missed accrual silently costs the admin the ability to see or hold that payout for
// the whole refund window. The executor's defensive re-accrual eventually pays the
// vendor, but it materialises the row at payout time — i.e. exactly when holding it is
// no longer possible. Relying on that alone is what turns a failed write into silent
// capability loss.
//
// WHY IT REPAIRS RATHER THAN JUST ALERTS. Pattern L (the runner/organizer equivalent)
// only alerts, because reconstructing a runner's split after the fact is ambiguous.
// A vendor's claim is NOT ambiguous — it is Σ their OrderItem subtotals, available
// verbatim from the order. So this pattern re-accrues, restoring the in-window hold
// while the window is still open. Repairing beats alerting when the repair is exact.
//
// MONEY SAFETY. accrueVendorEarnings is an idempotent upsert on (orderId, vendorId)
// and NEVER touches `status`, so re-accruing cannot resurrect an admin-held or
// cancelled row, cannot double-accrue, and cannot un-pay a paid one. A repair here
// creates missing rows and nothing else.
//
// Any repair increments sum.repaired.S, which the sweep turns into a BACKSTOP WARNING
// — the loud signal that the real-time completion path is failing and needs a look.
async function patternS(
  sum: SweepSummary,
  o: { windowStart: Date; maxPerPattern: number; dryRun: boolean },
) {
  const orders = await db.order.findMany({
    where: {
      status: { in: COMPLETE_STATES },
      completedAt: { gte: o.windowStart },
      voidedAt: null,
    },
    select: {
      id: true,
      orderItems: { select: { vendorId: true } },
      vendorEarnings: { select: { vendorId: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
    },
    orderBy: { completedAt: 'asc' },
    take: o.maxPerPattern,
  })

  const { payableVendorIds } = await import('./process-payout')
  for (const ord of orders) {
    // ONE payable definition, shared with accrueVendorEarnings: a REFUNDED/DECLINED/
    // CANCELLED portion is owed NOTHING — counting it here made S write phantom
    // 'accrued' rows for refunded money (and would alert forever once accrual refused).
    const payable = payableVendorIds(ord.orderItems, ord.vendorOrderStatuses)
    const accrued = new Set(ord.vendorEarnings.map(e => e.vendorId))
    const missing = [...payable].filter(v => !accrued.has(v))
    if (missing.length === 0) continue

    sum.details.S.push(ord.id)
    sum.alerted.push(
      `Pattern S: order ${ord.id} completed with ${missing.length} vendor(s) having NO VendorEarning — ` +
      `in-window admin hold/visibility was lost for them (completion-path accrual failed). ` +
      `${o.dryRun ? 'WOULD re-accrue' : 'Re-accrued'}.`,
    )
    if (o.dryRun) { sum.repaired.S += 1; continue } // count consistently with A–C in dryRun

    try {
      const { accrueVendorEarnings } = await import('./process-payout')
      await accrueVendorEarnings(ord.id)
      sum.repaired.S += 1
    } catch (err) {
      sum.alerted.push(
        `Pattern S: order ${ord.id} RE-ACCRUAL FAILED — ${err instanceof Error ? err.message : String(err)}. ` +
        `Payout still safe (executor re-accrues at payout), but the in-window hold cannot be restored.`,
      )
    }
  }
}

// ─── PATTERN T — phantom accrual on a refunded/declined portion → CANCEL ─────
// The EXCESS counterpart to Pattern S's MISSING: an 'accrued' VendorEarning whose OWN portion
// is REFUNDED/DECLINED/CANCELLED is owed nothing — it inflates the admin's payableCents with
// money no one should receive (the executor already skips it at pay time, so no wrong transfer;
// this is a ledger-VIEW correction). It is BOTH the race net between accrual and refund AND the
// mechanism that cleans the existing residual as the reconciler (honest actor), not a one-off.
//
// SAFETY: routes every cancel through the ONE shared reverser (reverseAccrualForRefundedPortion),
// which re-checks the non-payable predicate and REFUSES a payable row — so this can never cancel
// a legit COMPLETED accrual. DETECT-ONLY unless patternTEnabled (the reverser runs in dryRun),
// so its debut reports the set + WOULD-cancel total without touching the ledger until reviewed.
// NOT time-windowed: phantom accruals are permanent until reversed (the residual is months old),
// so it scans all non-payable-portion accruals, bounded by maxPerPattern.
async function patternT(
  sum: SweepSummary,
  o: { maxPerPattern: number; dryRun: boolean; patternTEnabled: boolean },
) {
  // Accrued rows whose OWN vendor portion is non-payable. Query mirrors the reverser's predicate.
  const NON_PAYABLE = ['REFUNDED', 'DECLINED', 'CANCELLED']
  const candidates = await db.vendorEarning.findMany({
    where: {
      status: 'accrued',
      order: { voidedAt: null, vendorOrderStatuses: { some: { status: { in: NON_PAYABLE } } } },
    },
    select: {
      orderId: true, vendorId: true, subtotalCents: true,
      order: { select: { vendorOrderStatuses: { select: { vendorId: true, status: true } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })

  // Filter to the vendor's OWN portion being non-payable (the `some` above is order-level).
  const phantoms = candidates.filter(e =>
    NON_PAYABLE.includes(e.order.vendorOrderStatuses.find(v => v.vendorId === e.vendorId)?.status ?? ''))

  if (phantoms.length === 0) return

  // DETECT-ONLY unless enabled — the reverser runs in dryRun so nothing is written.
  const effectiveDryRun = o.dryRun || !o.patternTEnabled
  let wouldCents = 0
  for (const e of phantoms) {
    const r = await reverseAccrualForRefundedPortion({
      orderId: e.orderId, vendorId: e.vendorId,
      actor: { id: 'reconciler', type: 'reconciler' },
      reason: 'reconciler Pattern-T backstop: accrued on a refunded/declined portion — no earning owed',
      dryRun: effectiveDryRun,
    })
    if (r.reversed) { wouldCents += r.cents; sum.repaired.T += 1; sum.details.T.push(e.orderId) }
  }

  const verb = effectiveDryRun ? 'WOULD cancel' : 'cancelled'
  sum.alerted.push(
    `Pattern T: ${sum.repaired.T} phantom accrual(s) ${verb} — $${(wouldCents / 100).toFixed(2)} of payableCents on refunded/declined portions` +
    `${effectiveDryRun ? ' (detect-only; set RECONCILER_PATTERN_T_ENABLED=true to act after diffing the set)' : ''}.`,
  )
}

// ─── PATTERN U — STUCK MONEY (read-only alerter; never moves money) ──────────
// The single reader for "money that should have moved and didn't." Durable failure
// states are otherwise flags with no reader: a vendor/runner/organizer payout can fail
// permanently, be marked, and stay operationally invisible until someone queries a
// column. This funnels all of them to the ONE alert surface (sum.alerted → the
// prod-visible '[Reconciler] ALERTS' line), with the condition NAMED so the alert says
// which fired and on what. Each condition has its OWN threshold because urgency differs:
//   • orphaned intent   (2m)  — a recordMoneyMove intent with no matching confirmed: a
//        Stripe transfer may have gone out with nothing recorded. MOST urgent. WIRED but
//        dormant until the chokepoint writes intent records (no source yet → no-op).
//   • vendor payout FAILED    (15m) — Order.payoutStatus='FAILED'
//   • runner payout failed    (15m) — RunnerEarning.status='failed'
//   • organizer payout failed (15m) — OrganizerPayout.status='failed'
// The 15m gate lets the reconciler's own 60s retries (C/P/Q) heal a transient failure
// before a human is paged; older-than-15m means those retries have had ~15 chances and
// still can't. Age comes from the PAYOUT_FAILED audit createdAt (the marker rows carry no
// updatedAt). New (<30m) vs standing (>=30m) so a fresh failure never hides inside a
// standing count. Wallpaper-resistant: every alert carries count, $total, and ids.
const STUCK_FAILED_MIN = 15
const STUCK_INTENT_MIN = 2   // orphaned-intent threshold (used when the chokepoint lands)
const STUCK_NEW_MIN = 30     // failed newer than this = "new"; else "standing"

type StuckRow = { id: string; cents: number | null; sinceMs: number | null }

export async function patternU(sum: SweepSummary, o: { maxPerPattern: number }) {
  const now = Date.now()

  // Failed-since ages now come from findStuckPayouts (it reads the PAYOUT_FAILED audits,
  // which carry both the timestamp AND — since cause-capture — why it failed).
  const fmt = (cents: number | null) => (cents == null ? '$?' : `$${(cents / 100).toFixed(2)}`)

  // One emitter, parameterised by threshold — this is where per-condition urgency lives.
  // Unknown age (no audit row, e.g. a legacy FAILED) counts as stuck: conservative, alert.
  const emit = (condition: string, rows: StuckRow[], thresholdMin: number) => {
    const stuck = rows.filter(r => r.sinceMs == null || r.sinceMs >= thresholdMin * 60_000)
    if (!stuck.length) return
    const totalCents = stuck.reduce((s, r) => s + (r.cents ?? 0), 0)
    const newN = stuck.filter(r => r.sinceMs != null && r.sinceMs < STUCK_NEW_MIN * 60_000).length
    const idList = stuck.slice(0, 20).map(r => {
      const age = r.sinceMs == null ? 'age?' : `${Math.floor(r.sinceMs / 60_000)}m`
      return `${r.id}(${fmt(r.cents)},${age})`
    }).join(' ')
    sum.alerted.push(
      `[STUCK-MONEY ${condition}] ${stuck.length} failed >${thresholdMin}m, ${fmt(totalCents)} total ` +
      `(${newN} new, ${stuck.length - newN} standing) — auto-retry exhausted, manual intervention. ` +
      `ids: ${idList}${stuck.length > 20 ? ` +${stuck.length - 20} more` : ''}`,
    )
  }

  // ── THE STUCK SET — one derivation, shared with the admin money page ────────────────
  // These three queries used to live inline here. They are now lib/stuck-payouts.ts, called
  // by BOTH this pattern and app/api/admin/events/[id]/money — because deriving "which
  // payouts are stuck" once for an alert and again for a screen is the two-sources class.
  // Pattern U keeps its own policy: platform-wide (no eventId) and age-thresholded below.
  const stuckRows = await findStuckPayouts({ limit: o.maxPerPattern, legs: ['vendor', 'runner', 'organizer'] })
  const byLeg = (leg: string) => stuckRows.filter(r => r.leg === leg).map(r => ({
    id: r.id, cents: r.amountCents,
    sinceMs: r.failedAt ? now - r.failedAt.getTime() : null,
  }))

  emit('vendor', byLeg('vendor'), STUCK_FAILED_MIN)
  emit('runner', byLeg('runner'), STUCK_FAILED_MIN)
  emit('organizer', byLeg('organizer'), STUCK_FAILED_MIN)

  // ── orphaned intent (2m) — dormant until recordMoneyMove writes intent records. ──
  // When the chokepoint lands, an INTENT money-audit with no CONFIRMED sibling older than
  // STUCK_INTENT_MIN calls emit('orphaned-intent', rows, STUCK_INTENT_MIN). Left explicit
  // (not silently omitted) so the reader is complete-by-construction the moment the source
  // exists. No source today ⇒ intentionally a no-op, never a false alert.
  void STUCK_INTENT_MIN
}

// ─── PATTERN V — delivery-custody strand clocks (Commit 2, U4) ─────────────────
// Time-based flags for orders stuck in a runner-custody state. FLAG ONLY — sets strandedAt +
// strandedReason (with a `stranded` custody event) and reads them to the ALERTS line; it NEVER
// moves money or order status. A human decides — that's the whole point of strandedReason: it
// names the action (find/release the runner · go find the runner · go tap the vendor).
//
// SELF-HEALING, the single owner of strand state. Each sweep reconciles every candidate to its
// DESIRED strand — the condition it is currently in past threshold, or none:
//   none → reason      SET    (+ `stranded`)
//   reason → none      CLEAR  (+ `strand_cleared`) — a legitimate action (collect / deliver /
//                      release / return-confirm) resolved the condition
//   reason → reason'   re-point (both events; rare — a clock reset moved the condition)
// Clearing RESETS, never immunises: a re-claimed order that stalls again strands afresh.
// voidedAt orders are skipped — excluded/test data never strands.
//
// Conditions, all within status=RUNNER_COLLECTED (the only stranding status):
//   CLAIMED_NOT_COLLECTED        collectedAt null,      returnRequestedAt null, dispatchedAt aged
//   RUNNER_UNREACHABLE_WITH_FOOD collectedAt set,       returnRequestedAt null, collectedAt aged
//   AWAITING_VENDOR_CONFIRMATION returnRequestedAt set,                         returnRequestedAt aged
type StrandRow = {
  id: string; status: string
  collectedAt: Date | null; returnRequestedAt: Date | null; dispatchedAt: Date | null
  strandedAt: Date | null; strandedReason: StrandedReason | null
}

/** The strand condition this order is CURRENTLY in past its threshold, or null. Thresholds
 *  live in one named home (STRAND_THRESHOLDS_MS) — no timing literals in the reconciler. */
function strandConditionOf(r: StrandRow, now: number): StrandedReason | null {
  if (r.status !== OrderStatus.RUNNER_COLLECTED) return null
  const T = STRAND_THRESHOLDS_MS
  if (r.returnRequestedAt) {
    return now - r.returnRequestedAt.getTime() >= T.awaitingVendorConfirm ? StrandedReason.AWAITING_VENDOR_CONFIRMATION : null
  }
  if (r.collectedAt) {
    return now - r.collectedAt.getTime() >= T.runnerUnreachable ? StrandedReason.RUNNER_UNREACHABLE_WITH_FOOD : null
  }
  if (r.dispatchedAt) {
    return now - r.dispatchedAt.getTime() >= T.claimedNotCollected ? StrandedReason.CLAIMED_NOT_COLLECTED : null
  }
  return null
}

const STRAND_NEW_MIN = 30 // stranded newer than this = "new"; else "standing" (mirrors Pattern U)
const STRAND_ACTION: Record<StrandedReason, string> = {
  CLAIMED_NOT_COLLECTED:        'food on the counter — find or release the runner',
  RUNNER_UNREACHABLE_WITH_FOOD: 'food in the wild — go find the runner',
  AWAITING_VENDOR_CONFIRMATION: 'return requested — go tap the vendor to confirm',
}

export async function patternV(sum: SweepSummary, o: { maxPerPattern: number }) {
  const now = Date.now()

  // Candidates: anything that could NEED a strand (RUNNER_COLLECTED) OR already carries one
  // (so a resolved strand gets cleared). Never voided.
  const candidates: StrandRow[] = await db.order.findMany({
    where: { voidedAt: null, OR: [{ status: OrderStatus.RUNNER_COLLECTED }, { strandedAt: { not: null } }] },
    select: {
      id: true, status: true, collectedAt: true, returnRequestedAt: true, dispatchedAt: true,
      strandedAt: true, strandedReason: true,
    },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: o.maxPerPattern,
  })

  const stranded: { id: string; reason: StrandedReason; sinceMs: number | null }[] = []

  for (const r of candidates) {
    const desired = strandConditionOf(r, now)
    const current = r.strandedAt ? r.strandedReason : null
    if (desired === current) {
      if (current) stranded.push({ id: r.id, reason: current, sinceMs: r.strandedAt ? now - r.strandedAt.getTime() : null })
      continue
    }
    // Transition current → desired: flag-only write + the matching custody event(s), one tx.
    await db.$transaction(async tx => {
      await tx.order.updateMany({ where: { id: r.id }, data: { strandedAt: desired ? new Date() : null, strandedReason: desired } })
      if (current) {
        await tx.deliveryCustodyEvent.create({ data: { orderId: r.id, eventType: 'strand_cleared', actorRole: 'system', metadata: { clearedReason: current } } })
      }
      if (desired) {
        await tx.deliveryCustodyEvent.create({ data: { orderId: r.id, eventType: 'stranded', actorRole: 'system', metadata: { strandedReason: desired } } })
      }
    })
    if (desired) stranded.push({ id: r.id, reason: desired, sinceMs: 0 })
  }

  // ── Read to the ALERTS line — one entry per condition, NAMED for the human action. ──
  const byReason = new Map<StrandedReason, typeof stranded>()
  for (const s of stranded) {
    const arr = byReason.get(s.reason) ?? []
    arr.push(s); byReason.set(s.reason, arr)
  }
  for (const [reason, rows] of byReason) {
    const newN = rows.filter(r => r.sinceMs != null && r.sinceMs < STRAND_NEW_MIN * 60_000).length
    const ids = rows.slice(0, 20).map(r => `${r.id}(${r.sinceMs == null ? 'age?' : `${Math.floor(r.sinceMs / 60_000)}m`})`).join(' ')
    sum.alerted.push(
      `[STRAND ${reason}] ${rows.length} stranded (${newN} new, ${rows.length - newN} standing) — ${STRAND_ACTION[reason]}. ` +
      `ids: ${ids}${rows.length > 20 ? ` +${rows.length - 20} more` : ''}`,
    )
  }
}

/**
 * Pattern W — PII RETENTION. Purge RunnerProfileChange rows past their window (180d after the
 * runner's event ends). The enforcer behind the schema's retention promise, so the label has a
 * reader. Thin wrapper over lib/runner-profile-log; respects dryRun; silent when nothing expired.
 */
// ─── PATTERN X — SETTLED TRANSFER vs LEDGER (the crash window + the refund race) ───
//
// WHY THIS EXISTS. Two distinct holes, both created by the same ordering in
// process-payout.ts: the Stripe transfer fires at :406, the Payout row lands at :420, and the
// durable earning flag only at :445. Anything happening in between sees an inconsistent world.
//
//   X1 — DOUBLE-HOLD (customer AND vendor have the money). A refund landing in that window
//        reads no Payout row, decides CASE 1, refunds the customer and does NOT reverse the
//        transfer (process-refund.ts:241). Result: a non-reversed transfer coexisting with a
//        COMPLETED refund that has no reversal id. This is REAL LOST MONEY and it is NEVER
//        auto-repaired — reversing a transfer under a human's feet is its own hazard. ALERT
//        with both ids and the dollar amount; a human decides.
//
//   X2 — LEDGER LAG (money moved, books say otherwise). Crash between :406 and :445 leaves a
//        settled transfer with an earning still 'accrued'. The vendor HAS been paid, the
//        admin's payable overstates, and a human may pay again by hand. Safe to heal — the
//        transfer is the fact, the flag is the lag — but ONLY when the amounts agree.
//
// WHY NOT PATTERN C: C is windowed on completedAt (>= windowStart, 24h). An order whose crash
// coincides with it ageing out of that lookback is retried by NOTHING — that gap is precisely
// why this hole was unreachable. X is UNWINDOWED and keys on the Payout row, never completedAt.
/**
 * ⚠️ TEMPORARY — DELETE WHEN THE `OperationalAlert` TABLE EXISTS. That table is the real home
 * for "known, decided, stop telling me"; this const is a hardcoded stand-in so a settled cohort
 * stops costing five alert lines every 60 seconds. Do NOT grow this into a general
 * acknowledgment mechanism — build that once, properly, in the DB.
 *
 * THE COHORT, and why it is closed rather than merely quiet:
 * these five settled Payout rows PREDATE the VendorEarning model. Measured 2026-07-26 —
 * earliest Payout `2026-06-04T05:05:24Z`, earliest VendorEarning `2026-07-11T19:45:26Z`;
 * **5 settled payouts fall before that boundary and 83 after, and all 83 have earning rows.**
 * A perfect partition. There was never a row to lose: the model did not exist when the money
 * moved. The set therefore CANNOT grow — anything new arriving here is a genuine defect.
 *
 * IT IS TEST-MODE MONEY. Stripe was in test mode; these are test-mode transfers in a test-mode
 * account on Italian Fest 2026 — the same cohort and the same disposition as
 * `CURRENT_STATE.md` §6 item 3. There is nothing to reconcile. Recorded explicitly because
 * "settled transfer with no ledger row" reads as a books emergency to anyone who finds it
 * later without the key-mode context.
 *
 * Matching is EXACT on all three of order + vendor + amount. Loosening it to order+vendor
 * would let a genuinely new discrepancy on the same pair inherit this suppression silently.
 */
const ACKNOWLEDGED_X2: { orderId: string; vendorId: string; amountCents: number; why: string }[] = [
  { orderId: 'cmpyb72m800217rj2mw1zro00', vendorId: 'cmni6x68q000211znxtpw0076', amountCents: 3856,
    why: 'pre-VendorEarning-model (paid 2026-06-04); test-mode; ALL PRO TEES' },
  { orderId: 'cmpyb72m800217rj2mw1zro00', vendorId: 'cmni6x6gz000611znpe5c5hhp', amountCents: 3665,
    why: "pre-VendorEarning-model (paid 2026-06-04); test-mode; RANDY'S HOUSE OF BBQ" },
  { orderId: 'cmpy7km7y00167rj2588ob5ye', vendorId: 'cmni6x68q000211znxtpw0076', amountCents: 1918,
    why: 'pre-VendorEarning-model (paid 2026-06-04); test-mode; ALL PRO TEES' },
  { orderId: 'cmpy7km7y00167rj2588ob5ye', vendorId: 'cmni6x6gz000611znpe5c5hhp', amountCents: 1344,
    why: "pre-VendorEarning-model (paid 2026-06-04); test-mode; RANDY'S HOUSE OF BBQ" },
  // The odd one out, and the one worth reading twice. NOT a ledger lag: $19.90 was transferred
  // 2026-06-05, then the order was VOIDED 2026-06-20 (status now PLACED). patternS filters
  // `voidedAt: null` CORRECTLY — you do not re-accrue a struck order — so no window width heals
  // this. It is the void-after-payout shape, here with test money. See CURRENT_STATE §7.
  { orderId: 'cmq0c60gf00012icnrmby6a15', vendorId: 'cmni6x6gz000611znpe5c5hhp', amountCents: 1990,
    why: 'VOID-AFTER-PAYOUT: paid 2026-06-05, order voided 2026-06-20; unhealable by design, not by window' },
]

const ackKey = (o: string, v: string, c: number) => `${o}::${v}::${c}`
const ACK_X2 = new Set(ACKNOWLEDGED_X2.map(a => ackKey(a.orderId, a.vendorId, a.amountCents)))

export async function patternX(
  sum: SweepSummary,
  o: { scanCeiling: number; maxPerPattern: number; dryRun: boolean; windowStart: Date },
) {
  const settled = await db.payout.findMany({
    where: { reversedAt: null, orderId: { not: null } },
    select: {
      id: true, orderId: true, vendorId: true, eventId: true,
      netAmount: true, stripeTransferId: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: o.scanCeiling,
  })
  if (settled.length >= o.scanCeiling) sum.alerted.push(
    `Pattern X: SCAN CEILING HIT — ${settled.length} settled payouts at the ${o.scanCeiling} limit. Rows beyond it were NOT examined this sweep.`,
  )
  if (settled.length === 0) return

  const orderIds = [...new Set(settled.map(p => p.orderId!))]
  const [earnings, refunds, orders] = await Promise.all([
    db.vendorEarning.findMany({
      where: { orderId: { in: orderIds } },
      // `id` is selected ONLY so the heal's audit row can carry earningId, matching what the
      // shared reverser records for Pattern T. It changes no filtering and no heal decision.
      select: { id: true, orderId: true, vendorId: true, status: true, netCents: true },
    }),
    db.refund.findMany({
      where: { orderId: { in: orderIds }, status: 'COMPLETED' },
      select: { orderId: true, vendorId: true, amountCents: true, stripeRefundId: true, stripeReversalId: true },
    }),
    // Needed ONLY to say WHY a row is unhealable. X2 used to defer to Pattern S without
    // knowing whether S could even see the row; that is the bug being fixed here.
    db.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, status: true, completedAt: true, voidedAt: true },
    }),
  ])
  const eKey = (oid: string, vid: string) => `${oid}::${vid}`
  const earningBy = new Map(earnings.map(e => [eKey(e.orderId, e.vendorId), e]))
  const refundBy  = new Map(refunds.map(r => [eKey(r.orderId, r.vendorId), r]))
  const orderBy   = new Map(orders.map(ord => [ord.id, ord]))

  /**
   * Why Pattern S will not restore this row — stated from the ORDER, not assumed.
   *
   * patternS runs at the S call site EARLIER IN THIS SAME SWEEP and is windowed on
   * `completedAt >= windowStart` (24h) with `voidedAt: null`. So by the time X runs, an
   * in-window order has already been re-accrued and cannot still be an orphan here. Every
   * row X2 actually reports is one S already declined — which is exactly why the old
   * "Pattern S restores the row" referral was false for the entire observable population.
   */
  const whyUnhealable = (orderId: string): string => {
    const ord = orderBy.get(orderId)
    if (!ord) return 'order row not found'
    const reasons: string[] = []
    if (ord.voidedAt) reasons.push(
      `order VOIDED ${ord.voidedAt.toISOString().slice(0, 10)} — Pattern S filters voidedAt:null CORRECTLY, so no window width heals this`)
    if (!COMPLETE_STATES.includes(ord.status)) reasons.push(`status ${ord.status} is not COMPLETED/DELIVERED`)
    if (ord.completedAt == null) reasons.push('completedAt is NULL — never matches S\'s gte')
    else if (ord.completedAt < o.windowStart) reasons.push(
      `completed ${((Date.now() - ord.completedAt.getTime()) / 86_400_000).toFixed(0)}d ago — outside Pattern S's 24h window`)
    return reasons.length ? reasons.join('; ') : 'in S\'s window and payable — S ran earlier this sweep and did NOT restore it; re-accrual likely THREW (see the Pattern S alert)'
  }

  for (const p of settled) {
    // ── ⛔ THE FABRICATED COHORT — X'S PREMISE DOES NOT HOLD HERE ────────────────────────
    // Every branch below reasons from "the transfer settled, so the money MOVED". For the
    // declared pollution cohort that sentence is false: those transfer ids have never existed
    // in Stripe. Their Payout rows are kept deliberately (deleting them destroys the artifact
    // the transfer-existence audit names), which means X sees them on every single sweep.
    //
    // MEASURED, not hypothetical: on 2026-07-28 the remediation cancelled all 76 rows and X2
    // healed every one back to `paid` within 250ms — re-stamping `paidAt` and the fabricated
    // `stripeTransferId`, and leaving a receipt that had already printed "success". Without
    // this skip the cohort can never be retired; the sweep would undo any correction forever.
    //
    // Suppressed, never dropped: the count rides the summary line, so the cohort stays visible
    // without costing 76 alert lines a sweep.
    if (isPollutedTransfer(p.stripeTransferId)) {
      sum.suppressed.push(
        `Pattern X: payout ${p.stripeTransferId} (order ${p.orderId}, vendor ${p.vendorId}) is a DECLARED ` +
        `fabricated transfer — never existed in Stripe. No money moved, so there is nothing to heal.`,
      )
      continue
    }

    const key = eKey(p.orderId!, p.vendorId)
    const earning = earningBy.get(key)
    const refund  = refundBy.get(key)
    const netCents = Math.round(p.netAmount * 100)

    // ── X1: transfer stands AND the customer was refunded, with no reversal ──
    if (refund && !refund.stripeReversalId) {
      sum.alerted.push(
        `Pattern X1 🔴 DOUBLE-HOLD: order ${p.orderId} vendor ${p.vendorId} — transfer ${p.stripeTransferId} ` +
        `($${(netCents / 100).toFixed(2)}) is NOT reversed, but refund ${refund.stripeRefundId ?? '(no stripe id)'} ` +
        `($${(refund.amountCents / 100).toFixed(2)}) COMPLETED with no reversal. Customer AND vendor hold the money. ` +
        `MANUAL REVIEW — not auto-repaired.`,
      )
      continue // never heal a row that needs a human
    }

    if (earning?.status === 'paid') continue // the healthy case

    // ── X2: money moved, ledger lags ─────────────────────────────────────────
    if (!earning) {
      const line =
        `Pattern X2: order ${p.orderId} vendor ${p.vendorId} — settled transfer ${p.stripeTransferId} ` +
        `($${(netCents / 100).toFixed(2)}) with NO VendorEarning row at all. NOT auto-healed: ${whyUnhealable(p.orderId!)}.`
      // Declared cohort → suppressed, never dropped. Anything NOT declared is still loud:
      // the set cannot grow (see ACKNOWLEDGED_X2), so a sixth orphan is a genuine defect.
      if (ACK_X2.has(ackKey(p.orderId!, p.vendorId, netCents))) sum.suppressed.push(line)
      else sum.alerted.push(line)
      continue
    }
    if (earning.netCents != null && earning.netCents !== netCents) {
      sum.alerted.push(
        `Pattern X2 ⚠️ AMOUNTS DISAGREE: order ${p.orderId} vendor ${p.vendorId} — transfer ${p.stripeTransferId} ` +
        `paid $${(netCents / 100).toFixed(2)} but earning records $${(earning.netCents / 100).toFixed(2)}. ` +
        `NOT healed — a human decides which is true.`,
      )
      continue
    }

    if (o.dryRun) { sum.repaired.X++; sum.details.X.push(p.orderId!); continue }

    // ── THE HEAL, AND ITS RECORD — one transaction ──────────────────────────────────────
    //
    // ⚠️ WHY THIS IS AUDITED (2026-07-28). X2 is the ONLY pattern proven to have changed money
    // rows in production at scale — 76 on that date — and it did so with NO AdminMoneyAction.
    // The only reason anyone knows it fired is that it was reconstructed forensically from
    // `paidAt` timestamps and `stripeTransferId` fingerprints, days later, while investigating
    // why a remediation had silently reverted.
    //
    // The gap is ATTRIBUTION, not absence of a trace. X does leave `paidAt` + `stripeTransferId`
    // behind — but they are indistinguishable from the executor's own write, and that difference
    // is the whole point: the executor stamps a transfer it JUST CREATED, whereas X copies a
    // transfer id that already existed and asserts `paid` having moved no money at all. Without
    // a row saying so, those two writes read identically forever.
    //
    // IN THE SAME TRANSACTION, and conditional on count — an audit written outside the
    // transaction can describe a heal that rolled back, and the array form
    // `$transaction([update, audit])` cannot branch, so it would write the audit even when the
    // update matched nothing. Both are the receipt-computed-from-intent class (§8).
    //
    // The `status: { not: 'paid' }` guard is UNCHANGED — a concurrent executor still wins.
    const healed = await db.$transaction(async (tx) => {
      const res = await tx.vendorEarning.updateMany({
        where: { orderId: p.orderId!, vendorId: p.vendorId, status: { not: 'paid' } },
        data: { status: 'paid', netCents, stripeTransferId: p.stripeTransferId, paidAt: new Date() },
      })
      if (res.count === 0) return res // lost the race → no heal, and therefore no audit row
      await writeMoneyAudit(RECONCILER_ACTOR, p.eventId, {
        action: 'LEDGER_HEAL',
        payeeType: 'vendor',
        payeeId: p.vendorId,
        orderId: p.orderId,
        earningId: earning.id,
        amountCents: netCents,
        reason:
          `Pattern X2 backstop: transfer ${p.stripeTransferId} had already settled in Stripe while the ` +
          `earning was still '${earning.status}'. The LEDGER was corrected to match; the reconciler ` +
          `moved NO money and created no transfer.`,
        metadata: {
          pattern: 'X2',
          previousStatus: earning.status,
          newStatus: 'paid',
          netCents,
          stripeTransferId: p.stripeTransferId,
        },
      }, tx)
      return res
    })
    if (healed.count > 0) {
      sum.repaired.X++
      sum.details.X.push(p.orderId!)
      sum.alerted.push(
        `Pattern X2: HEALED order ${p.orderId} vendor ${p.vendorId} — earning was '${earning.status}' while transfer ` +
        `${p.stripeTransferId} ($${(netCents / 100).toFixed(2)}) had already settled. A real-time path crashed mid-payout.`,
      )
    }
  }
}

export async function patternW(sum: SweepSummary, o: { maxPerPattern: number; dryRun: boolean }) {
  const { purgeExpiredProfileChanges, PROFILE_CHANGE_RETENTION_DAYS } = await import('./runner-profile-log')
  const r = await purgeExpiredProfileChanges({ dryRun: o.dryRun, maxPerPattern: o.maxPerPattern })
  if (r.matched > 0) {
    sum.alerted.push(
      r.dryRun
        ? `Pattern W (dry-run): ${r.matched} RunnerProfileChange row(s) past ${PROFILE_CHANGE_RETENTION_DAYS}d retention WOULD be purged`
        : `Pattern W: purged ${r.purged} RunnerProfileChange row(s) past ${PROFILE_CHANGE_RETENTION_DAYS}d retention (PII hygiene)`,
    )
  }
}
