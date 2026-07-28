/**
 * Organizer payout — Part B Phase B3. SHADOW-FIRST: this file currently only
 * PLANS (pure read, no writes, no Stripe transfers). The executor (the batched
 * transfer + OrganizerPayout batch record) is enabled after the shadow is reviewed.
 *
 * DIFFERENT SHAPE from runner payouts (the Phase 0 fork):
 *   - BATCHED, not per-order: one payout per EVENT summing all unpaid accrued
 *     OrganizerEarning for that event (organizers get one payout per event).
 *   - NO source_transaction: the batch spans multiple charges, so the executor
 *     will be a plain transfer from the platform balance (not tied to one charge).
 *   - DESTINATION resolves through the relation: event.organizer.stripeAccountId
 *     (the per-organizer account on FairOrganizer — NOT Event.operatorStripeAccountId).
 *   - Idempotency anchor (executor) = a batch id, not an orderId — because the
 *     SET is what's paid, and it grows as more orders deliver.
 *
 * PAYS THE LEDGER: the batch total is the SUM of the included OrganizerEarning
 * rows VERBATIM — no recompute feeds the transfer.
 *
 * The new correctness surface batching introduces is SET MEMBERSHIP: the batch
 * must include EXACTLY the unpaid + window-closed earnings for THIS event and no
 * others (not another event's, not already-paid, not in-window). planOrganizerPayout
 * returns the exact set + total so the shadow can prove it non-vacuously.
 */

import { db } from './db'
import { stripe } from './stripe'
import { REFUND_WINDOW_MS } from './constants'
import { PayoutNotSettledError, PayoutReconciliationError, transferOrTerminal, transferLinkage } from './process-payout'
import { logger } from './logger'
import { recordPayoutFailure, describeFailureCause } from './payout-failure-marker'

export type OrganizerPayoutOutcome = 'pay' | 'hold' | 'nothing'

export interface OrganizerPayoutPlan {
  eventId: string
  organizerId: string | null
  /** Organizer has a verified Connect account (resolved via event.organizer). */
  connected: boolean
  destinationAccountId: string | null
  outcome: OrganizerPayoutOutcome
  holdReason: 'unconnected' | null
  /** Sum of the included rows' amountCents — what the batch WOULD transfer. */
  batchTotalCents: number
  /** EXACTLY the earnings in the batch (unpaid + window-closed, this event). */
  includedEarningIds: string[]
  includedCount: number
}

/**
 * Decide what an organizer payout for this event WOULD do. Pure read — no writes,
 * no Stripe, no money moves.
 *
 * The set: OrganizerEarning WHERE eventId = X AND status = 'accrued' (unpaid) AND
 * createdAt < now − refund window (window closed) AND order not voided. Already-
 * paid rows, in-window rows, and other events' rows are excluded by construction.
 */
export async function planOrganizerPayout(eventId: string): Promise<OrganizerPayoutPlan> {
  const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      organizerId: true,
      organizer: { select: { stripeAccountId: true, stripeVerified: true } },
    },
  })
  if (!event) throw new Error(`planOrganizerPayout: event ${eventId} not found`)

  // The batch set — exactly the unpaid, window-closed earnings for THIS event.
  const rows = await db.organizerEarning.findMany({
    where: {
      eventId,
      status: 'accrued',
      createdAt: { lt: windowClosedBefore },
      order: { voidedAt: null },
    },
    select: { id: true, amountCents: true },
    orderBy: { createdAt: 'asc' },
  })

  const batchTotalCents = rows.reduce((s, r) => s + r.amountCents, 0)
  const includedEarningIds = rows.map(r => r.id)

  const destinationAccountId = event.organizer?.stripeAccountId ?? null
  const connected = !!(destinationAccountId && event.organizer?.stripeVerified)

  let outcome: OrganizerPayoutOutcome
  let holdReason: 'unconnected' | null = null
  if (rows.length === 0 || batchTotalCents <= 0) {
    outcome = 'nothing'
  } else if (!connected) {
    outcome = 'hold'
    holdReason = 'unconnected'
  } else {
    outcome = 'pay'
  }

  return {
    eventId,
    organizerId: event.organizerId,
    connected,
    destinationAccountId,
    outcome,
    holdReason,
    batchTotalCents,
    includedEarningIds,
    includedCount: rows.length,
  }
}

// ─── The executor (Part B B3 — MOVES MONEY) ──────────────────────────────────

// Avoid both PayoutNotSettledError being flagged unused (it's part of the reused
// error vocabulary; organizer batches don't currently throw it, but the worker
// handler treats any non-reconciliation throw as retryable, same as runner).
void PayoutNotSettledError

export interface OrganizerPayoutResult {
  eventId: string
  outcome: 'paid' | 'held' | 'blocked' | 'nothing'
  batchId?: string
  totalCents?: number
  transferId?: string
  reason?: string
}

/**
 * Pay an event's organizer their accrued share as ONE batched transfer.
 *
 * Idempotency flow (the batch id is the anchor — the set is what's paid, not one
 * row):
 *   1. If a PENDING batch already exists for this event → reuse it (crash recovery:
 *      the transfer may have succeeded but the finalize was lost). Do NOT create a
 *      second batch.
 *   2. Else plan the set, create the batch FIRST (status='pending', gets an id),
 *      link exactly the included earnings to it (batchId).
 *   3. transfers.create with idempotencyKey = `organizer_payout_${batch.id}`, NO
 *      source_transaction (plain transfer from platform balance). A re-run sends
 *      the SAME key → Stripe returns the original transfer, never a second one —
 *      even if our batch still says 'pending' (the crash-recovery guard).
 *   4. Finalize: batch→paid + transfer id; covered earnings→paid + paidAt.
 *
 * Unconnected organizer → no transfer, earnings stay accrued (the ledger rows ARE
 * the hold), no error. Reconciliation guard: batch total ≠ live covered sum → halt.
 */
export async function processEventOrganizerPayout(eventId: string): Promise<OrganizerPayoutResult> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      organizerId: true,
      // C1: payoutsFrozenAt — the organizer-wide admin kill-switch. DISTINCT from
      // suspendedAt (which blocks portal REQUESTS); this blocks their MONEY.
      organizer: { select: { stripeAccountId: true, stripeVerified: true, payoutsFrozenAt: true } },
    },
  })
  if (!event) throw new Error(`processEventOrganizerPayout: event ${eventId} not found`)
  const destination = event.organizer?.stripeAccountId ?? null
  const connected = !!(destination && event.organizer?.stripeVerified)

  // ── C1 ADMIN GATE (a) — organizer-wide freeze. Checked FIRST, before any batch is
  // formed, so a frozen organizer never even accumulates a payable batch.
  if (event.organizer?.payoutsFrozenAt) {
    logger.warn('[OrganizerPayout] organizer FROZEN — no batch, no transfer', { eventId })
    return { eventId, outcome: 'blocked', reason: 'payouts_frozen' }
  }

  // ── C1 ADMIN GATE (b) — a HELD batch.
  // THE TRAP THIS AVOIDS: step (1) below reuses a batch by looking for status
  // 'pending'. A held batch is NOT 'pending', so that lookup returns null and the
  // executor would cheerfully form a BRAND NEW batch from the remaining accrued
  // earnings and pay it — routing straight around the admin's hold. Checking for a
  // held batch BEFORE the pending lookup is what makes the hold real.
  const heldBatch = await db.organizerPayout.findFirst({ where: { eventId, status: 'held' } })
  if (heldBatch) {
    logger.warn('[OrganizerPayout] BLOCKED — batch is admin-held', { eventId, batchId: heldBatch.id })
    return {
      eventId, outcome: 'blocked', reason: 'admin_hold',
      batchId: heldBatch.id, totalCents: heldBatch.totalCents,
    }
  }

  // (1) Reuse an existing pending batch (crash recovery) BEFORE creating a new one.
  let batch = await db.organizerPayout.findFirst({ where: { eventId, status: 'pending' } })

  if (!batch) {
    const plan = await planOrganizerPayout(eventId)
    if (plan.outcome === 'nothing') {
      // ── C1 ADMIN GATE (c) — held EARNINGS with no batch yet.
      // planOrganizerPayout selects only status='accrued', so admin-held rows are
      // already excluded and the plan comes back empty. Reporting that as 'nothing'
      // would be a LIE to the admin who just held them ("nothing to pay" vs "you are
      // holding it"). The money is safe either way; the ADMIN-FACING TRUTH is not.
      const heldCount = await db.organizerEarning.count({
        where: { eventId, status: { in: ['held', 'cancelled'] } },
      })
      if (heldCount > 0) {
        logger.warn('[OrganizerPayout] BLOCKED — accrued earnings are admin-held', { eventId, heldCount })
        return { eventId, outcome: 'blocked', reason: 'admin_hold' }
      }
      return { eventId, outcome: 'nothing' }
    }
    if (plan.outcome === 'hold' || !connected) {
      logger.warn('[OrganizerPayout] HELD (organizer unconnected; ledger rows are the hold)', {
        eventId, totalCents: plan.batchTotalCents,
      })
      return { eventId, outcome: 'held', reason: 'unconnected', totalCents: plan.batchTotalCents }
    }
    // (2) Create the batch FIRST (the idempotency anchor), link exactly the set.
    batch = await db.organizerPayout.create({
      data: { eventId, organizerId: plan.organizerId, totalCents: plan.batchTotalCents, status: 'pending' },
    })
    await db.organizerEarning.updateMany({
      where: { id: { in: plan.includedEarningIds }, batchId: null, status: 'accrued' },
      data: { batchId: batch.id },
    })
  }

  // If the organizer isn't connected at execute time, leave the pending batch and
  // hold — never error (the batch + its linked rows pay once they connect).
  if (!connected) {
    logger.warn('[OrganizerPayout] organizer unconnected at execute — batch left pending', { eventId, batchId: batch.id })
    return { eventId, outcome: 'held', reason: 'unconnected', batchId: batch.id, totalCents: batch.totalCents }
  }

  // RECONCILIATION GUARD — the batch total must equal the LIVE sum of its covered
  // rows. A drift (a row changed/unlinked since the batch formed) is ambiguity →
  // halt, move no money.
  const covered = await db.organizerEarning.findMany({ where: { batchId: batch.id }, select: { amountCents: true } })
  const liveSum = covered.reduce((s, r) => s + r.amountCents, 0)
  if (covered.length === 0 || liveSum !== batch.totalCents) {
    throw new PayoutReconciliationError(
      `event ${eventId} batch ${batch.id}: covered sum ${liveSum}¢ (${covered.length} rows) ≠ batch total ${batch.totalCents}¢ — halting (no money moves)`,
    )
  }

  // (3) Plain transfer from the platform balance — NO source_transaction (the
  // batch spans multiple charges). Exactly-once via idempotencyKey = batch id.
  const transfer = await transferOrTerminal(`organizer payout event ${eventId} batch ${batch.id}`, () =>
    stripe.transfers.create(
      {
        amount: batch.totalCents,
        currency: 'usd',
        destination: destination as string,
        // NO source_transaction — the batch spans several charges and draws on the platform
        // balance, so there is no charge whose group could be inherited and this transfer must
        // carry its own. Routed through the SAME rule as the runner leg so the distinction is
        // expressed once rather than being a coincidence of two hand-written call sites; this
        // is why the organizer leg never hit the transfer_group conflict that broke the runner.
        ...transferLinkage({ groupWhenUnsourced: `event_${eventId}` }),
        metadata: { eventId, batchId: batch.id, kind: 'organizer_payout' },
      },
      { idempotencyKey: `organizer_payout_${batch.id}` },
    ),
  )

  // (4) Finalize — batch paid + transfer id; covered earnings paid + paidAt.
  await db.$transaction([
    db.organizerPayout.updateMany({
      where: { id: batch.id, status: { not: 'paid' } },
      data: { status: 'paid', stripeTransferId: transfer.id, paidAt: new Date() },
    }),
    db.organizerEarning.updateMany({
      where: { batchId: batch.id, status: { not: 'paid' } },
      data: { status: 'paid', paidAt: new Date() },
    }),
  ])

  logger.money('[OrganizerPayout] batch paid', { eventId, batchId: batch.id, totalCents: batch.totalCents, transferId: transfer.id })
  return { eventId, outcome: 'paid', batchId: batch.id, totalCents: batch.totalCents, transferId: transfer.id }
}

// ─── Reconciler: pay-when-connected + window backstop (mirror runner Pattern P) ─

export interface OrganizerReconcileSummary {
  scannedEvents: number
  paid: number
  held: number
  blocked: number
  nothing: number
  alerts: string[]
}

/**
 * Pays every eligible event's organizer batch: accrued + window-closed earnings,
 * organizer connected. ALSO re-attempts stuck pending batches (crash recovery) and
 * is the pay-when-an-organizer-connects mechanism. Routes through
 * processEventOrganizerPayout (idempotent) — never reimplements payout.
 */
export async function reconcileOrganizerPayouts(opts?: { maxPerRun?: number }): Promise<OrganizerReconcileSummary> {
  const max = opts?.maxPerRun ?? 100
  const windowClosedBefore = new Date(Date.now() - REFUND_WINDOW_MS)
  const summary: OrganizerReconcileSummary = { scannedEvents: 0, paid: 0, held: 0, blocked: 0, nothing: 0, alerts: [] }

  // Stuck pending batches first (a dropped finalize / crash mid-flight). status
  // 'held' is excluded by construction here — and processEventOrganizerPayout's gate
  // stops it anyway, which is the authoritative guarantee.
  const pending = await db.organizerPayout.findMany({ where: { status: 'pending' }, select: { eventId: true }, take: max })
  // Candidate events: any with accrued + window-closed earnings. Connectedness is
  // decided per-event inside processEventOrganizerPayout (unconnected → held), so we
  // don't filter on it here (OrganizerEarning has no event relation to filter through).
  const accrued = await db.organizerEarning.findMany({
    where: {
      status: 'accrued',
      createdAt: { lt: windowClosedBefore },
      order: { voidedAt: null },
    },
    select: { eventId: true },
    take: max * 10,
  })

  const events = [...new Set([...pending.map(p => p.eventId), ...accrued.map(a => a.eventId)])].slice(0, max)
  summary.scannedEvents = events.length

  for (const eventId of events) {
    try {
      const r = await processEventOrganizerPayout(eventId)
      if (r.outcome === 'paid') summary.paid++
      else if (r.outcome === 'held') summary.held++
      else if (r.outcome === 'blocked') summary.blocked++
      else summary.nothing++
    } catch (err) {
      // The alert is KEPT — unchanged.
      summary.alerts.push(`organizer payout failed for event ${eventId}: ${err instanceof Error ? err.message : String(err)}`)

      // TERMINAL ⇒ mark the batch failed and stop; transient/unknown ⇒ keep retrying. Same rule
      // and the same shared writer as the runner leg — one marker, one vocabulary, and Pattern U
      // already reads OrganizerPayout.status='failed'. A marked batch is surfaced with its cause
      // on the admin money page, with a Retry that returns it to 'pending'.
      const cause = describeFailureCause(err)
      if (cause.verdict === 'terminal') {
        await recordPayoutFailure({
          leg: 'organizer', eventId,
          actor: { id: 'reconciler:pattern-Q', type: 'reconciler' },
          finality: 'halted — terminal Stripe failure, no further retries',
          cause,
        })
        summary.blocked++
      }
    }
  }

  // Integrity: paid earning ⟺ batchId set; paid batch ⟺ transfer id set.
  const paidNoBatch = await db.organizerEarning.count({ where: { status: 'paid', batchId: null } })
  if (paidNoBatch > 0) summary.alerts.push(`${paidNoBatch} OrganizerEarning paid but no batchId — investigate`)
  const batchNoTransfer = await db.organizerPayout.count({ where: { status: 'paid', stripeTransferId: null } })
  if (batchNoTransfer > 0) summary.alerts.push(`${batchNoTransfer} OrganizerPayout paid but no transfer id — investigate`)

  return summary
}
