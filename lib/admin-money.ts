/**
 * C1 — ADMIN MONEY CONTROL. The write side of "admin has ultimate control over all
 * physical money movement".
 *
 * WHY THIS IS SAFE. Every dollar in FairSynq is platform-held until a delayed job
 * releases it (separate charges & transfers — vendors, runners and organizers alike;
 * nothing auto-splits at payment). So an admin acting BEFORE the payout fires is
 * acting on money that is still in the platform balance. These functions never move
 * money — they set DB state that the three payout EXECUTORS read as a gate:
 *
 *   lib/process-payout.ts     → VendorEarning.status    + Vendor.payoutsFrozenAt
 *   lib/runner-payout.ts      → RunnerEarning.status    + Runner.payoutsFrozenAt
 *   lib/organizer-payout.ts   → OrganizerPayout.status  + FairOrganizer.payoutsFrozenAt
 *                               (+ OrganizerEarning.status, which drops rows from the
 *                                next batch by construction)
 *
 * THE EXECUTOR IS THE GATE, NOT THE QUEUE. A hold is deliberately NOT implemented as
 * "cancel the BullMQ job" — the reconciler exists precisely to notice unpaid orders
 * and pay them, so a cancelled job would be silently resurrected and paid while the
 * admin UI still said "held". Because the gate lives inside the executors, and every
 * path to stripe.transfers.create runs through them, no enqueue path (job, inline
 * fallback, or any reconciler pattern) can route around an admin hold.
 *
 * HOLD vs CANCEL:
 *   hold      — reversible parking. Money stays in the platform balance; release
 *               puts the row back to payable and the reconciler pays it normally.
 *   cancel    — TERMINAL. Never paid, and never re-picked up as an "unpaid straggler"
 *               by a sweep. Use when the money is not owed at all.
 * Neither one refunds the customer — that is the refund engine's job (Slice 2).
 *
 * AUDIT. Every function here writes an AdminMoneyAction row in the SAME transaction
 * as the state change. Append-only: a release does not edit the hold row, it appends
 * a RELEASE row. This table is the record you produce when a payee contests an action.
 */

import { db } from './db'
import { ApiError } from './api-error'
import { logger } from './logger'

/**
 * WHO AN ADMIN MONEY ACTION CAN TARGET. Deliberately does NOT include 'customer' — see
 * AuditPayeeType. Three call sites branch exhaustively on this (`:140`, `:349`, `:366`) and
 * take it as a typed parameter, so widening THIS union would silently give each of them a
 * fall-through case on a value they have no handling for.
 */
export type PayeeType = 'vendor' | 'runner' | 'organizer'

/**
 * WHO A MONEY RECORD CAN BE ABOUT. Strictly wider than PayeeType, and the split is the point.
 *
 * A tip refund's payee is the CUSTOMER — money going back to the person who paid it, because no
 * runner earned it. That is a real payee for the AUDIT (the row records what happened) but not a
 * valid target for HOLD/RELEASE/CANCEL/FREEZE, which act on ledger rows a customer does not have.
 *
 * Keeping them separate is what lets 'customer' exist without handing the three PayeeType
 * switches an unhandled fourth case. Declared here rather than appearing as an undeclared string
 * in a call site: `AdminMoneyAction.payeeType` is a free String column, so an undeclared value
 * would have been accepted silently and only discovered by whoever next read the table.
 *
 * Readers of the STORED value: `reconciler.ts:1335` uses it as a map-key fragment (no switch, no
 * fall-through). Nothing else branches on a payeeType read back from the DB.
 */
export type AuditPayeeType = PayeeType | 'customer'

// HOLD|RELEASE|CANCEL|FREEZE|UNFREEZE|REFUND are admin/organizer/reconciler money moves.
// PAYOUT_FAILED is a SYSTEM record: a payout job exhausted its retries. It is written by the
// worker's failed handler and doubles as the durable failed-since timestamp Pattern U reads
// (the earning rows carry no updatedAt), giving the honest-actor audit that system money-ops
// otherwise lacked. Column is a free String — extending this union needs no migration.
//
// TIP_REFUND_FAILED is its OWN string, never PAYOUT_FAILED, for two independent reasons:
//   1. A tip refund is not a payout. Reusing the term would put a false statement in a money
//      audit — the same class as the X2 referral and the hardcoded "exhausted after N attempts".
//   2. Pattern U reads `action: 'PAYOUT_FAILED'` with `take: 2000` (reconciler.ts:1328). Sharing
//      the string would put tip-refund rows in contention for that window and push older
//      vendor/runner/organizer audits out of it, degrading the failed-since age those three
//      lanes report. A separate namespace cannot contend.
export type MoneyActionType =
  | 'HOLD' | 'RELEASE' | 'CANCEL' | 'FREEZE' | 'UNFREEZE' | 'REFUND'
  | 'PAYOUT_FAILED'
  | 'TIP_REFUND_FAILED'

export interface AdminMoneyContext {
  /** From requireAdminFairContext — proves platform admin + resolves the fair. */
  adminClerkId: string
  eventId: string
}

export interface MoneyActionResult {
  action: MoneyActionType
  payeeType: PayeeType
  payeeId: string
  orderId?: string
  amountCents?: number
  previousStatus?: string
  newStatus?: string
  auditId: string
}

/** WHO acted on money — recorded honestly. Not admin-only: an organizer refund, a reconciler
 *  sweep, or a system/webhook path each writes its own actor here. Never lie about the actor
 *  by routing a non-admin action through an admin field. */
export type MoneyActor = { id: string; type: 'admin' | 'organizer' | 'system' | 'reconciler' }

interface AuditFields {
  action: MoneyActionType
  /** WIDER than PayeeType on purpose — an audit row may be ABOUT a customer. See AuditPayeeType. */
  payeeType: AuditPayeeType
  payeeId: string
  orderId?: string | null
  earningId?: string | null
  amountCents?: number | null
  reason: string
  metadata?: Record<string, unknown>
}

/**
 * The ONE money-audit writer. Exported so every actor — admin routes here, the accrual
 * reverser, the reconciler backstop — records through the same place with an HONEST actor,
 * rather than each inventing its own AdminMoneyAction.create (the two-writers-one-truth trap).
 * Always called inside the state-change transaction.
 */
export function writeMoneyAudit(actor: MoneyActor, eventId: string, fields: AuditFields) {
  return db.adminMoneyAction.create({
    data: {
      actorId: actor.id,
      actorType: actor.type,
      eventId,
      action: fields.action,
      payeeType: fields.payeeType,
      payeeId: fields.payeeId,
      orderId: fields.orderId ?? null,
      earningId: fields.earningId ?? null,
      amountCents: fields.amountCents ?? null,
      reason: fields.reason,
      metadata: (fields.metadata ?? {}) as object,
    },
    select: { id: true },
  })
}

/** Admin wrapper — the admin routes always act as an 'admin' actor (ctx.adminClerkId). */
function auditRow(ctx: AdminMoneyContext, fields: AuditFields) {
  return writeMoneyAudit({ id: ctx.adminClerkId, type: 'admin' }, ctx.eventId, fields)
}

// ─── Per-order holds (vendor + runner) ────────────────────────────────────────

/**
 * Hold, release, or cancel ONE payee's payout on ONE order.
 *
 * Fair-scoping is structural, not a filter we remember to add: every lookup is keyed
 * by BOTH the earning's id and ctx.eventId, so an admin holding inside Fair A cannot
 * touch a row belonging to Fair B even with a valid row id. A cross-fair id returns
 * 404, not someone else's money.
 */
export async function setOrderPayoutState(
  ctx: AdminMoneyContext,
  params: {
    payeeType: 'vendor' | 'runner'
    orderId: string
    /** Required for vendor (an order has N vendors); ignored for runner (1 per order). */
    vendorId?: string
    action: 'HOLD' | 'RELEASE' | 'CANCEL'
    reason: string
  },
): Promise<MoneyActionResult> {
  const { payeeType, orderId, vendorId, action, reason } = params
  if (!reason?.trim()) throw new ApiError('A reason is required for every money action', 400, 'REASON_REQUIRED')

  // accrued/tracked → payable. The two ledgers use different words for it.
  const payableStatus = payeeType === 'vendor' ? 'accrued' : 'tracked'
  const target =
    action === 'HOLD' ? 'held' : action === 'CANCEL' ? 'cancelled' : payableStatus

  if (payeeType === 'vendor') {
    if (!vendorId) throw new ApiError('vendorId is required for a vendor payout action', 400, 'VENDOR_ID_REQUIRED')

    const earning = await db.vendorEarning.findFirst({
      where: { orderId, vendorId, eventId: ctx.eventId }, // ← fair-scoped by construction
      select: { id: true, status: true, subtotalCents: true },
    })
    if (!earning) throw new ApiError('No vendor earning found for that order in this fair', 404, 'EARNING_NOT_FOUND')

    // Money that already left is not holdable. Say so plainly rather than pretending
    // the hold worked — reversing a sent transfer is a DIFFERENT operation (Slice 2).
    if (earning.status === 'paid') {
      throw new ApiError(
        'That payout has already been transferred — it can no longer be held or cancelled. Reversing a sent transfer is a separate action.',
        409,
        'ALREADY_PAID',
      )
    }

    const [, audit] = await db.$transaction([
      db.vendorEarning.update({ where: { id: earning.id }, data: { status: target } }),
      auditRow(ctx, {
        action, payeeType, payeeId: vendorId, orderId, earningId: earning.id,
        amountCents: earning.subtotalCents, reason,
        metadata: { previousStatus: earning.status, newStatus: target },
      }),
    ])

    logger.warn('[AdminMoney] vendor payout state changed', {
      admin: ctx.adminClerkId, eventId: ctx.eventId, orderId, vendorId,
      action, from: earning.status, to: target,
    })
    return {
      action, payeeType, payeeId: vendorId, orderId,
      amountCents: earning.subtotalCents,
      previousStatus: earning.status, newStatus: target, auditId: audit.id,
    }
  }

  // ── runner ──────────────────────────────────────────────────────────────────
  const earning = await db.runnerEarning.findFirst({
    where: { orderId, eventId: ctx.eventId }, // ← fair-scoped by construction
    select: { id: true, status: true, amountCents: true, runnerId: true },
  })
  if (!earning) throw new ApiError('No runner earning found for that order in this fair', 404, 'EARNING_NOT_FOUND')

  if (earning.status === 'paid') {
    throw new ApiError(
      'That payout has already been transferred — it can no longer be held or cancelled. Reversing a sent transfer is a separate action.',
      409,
      'ALREADY_PAID',
    )
  }

  const [, audit] = await db.$transaction([
    db.runnerEarning.update({ where: { id: earning.id }, data: { status: target } }),
    auditRow(ctx, {
      action, payeeType, payeeId: earning.runnerId, orderId, earningId: earning.id,
      amountCents: earning.amountCents, reason,
      metadata: { previousStatus: earning.status, newStatus: target },
    }),
  ])

  logger.warn('[AdminMoney] runner payout state changed', {
    admin: ctx.adminClerkId, eventId: ctx.eventId, orderId, runnerId: earning.runnerId,
    action, from: earning.status, to: target,
  })
  return {
    action, payeeType, payeeId: earning.runnerId, orderId,
    amountCents: earning.amountCents,
    previousStatus: earning.status, newStatus: target, auditId: audit.id,
  }
}

// ─── Organizer batch hold (per-event, not per-order) ──────────────────────────

/**
 * Hold / release / cancel the organizer's payout for THIS event.
 *
 * Organizers are paid as one batched transfer per event, so the unit of control is
 * the event's batch, not an order. Two cases:
 *   - a batch already exists (pending) → flip the BATCH's status. Must be the batch,
 *     not just the earnings: the batch is the idempotency anchor, and the executor's
 *     crash-recovery path reuses a pending batch, so a hold on the earnings alone
 *     would leave a payable batch behind.
 *   - no batch yet → hold the accrued EARNINGS. planOrganizerPayout only ever selects
 *     status='accrued', so held rows simply never enter a batch.
 */
export async function setOrganizerPayoutState(
  ctx: AdminMoneyContext,
  params: { action: 'HOLD' | 'RELEASE' | 'CANCEL'; reason: string },
): Promise<MoneyActionResult> {
  const { action, reason } = params
  if (!reason?.trim()) throw new ApiError('A reason is required for every money action', 400, 'REASON_REQUIRED')

  const event = await db.event.findUnique({
    where: { id: ctx.eventId },
    select: { organizerId: true },
  })
  const organizerId = event?.organizerId
  if (!organizerId) throw new ApiError('This fair has no organizer to pay', 404, 'NO_ORGANIZER')

  const batchTarget = action === 'HOLD' ? 'held' : action === 'CANCEL' ? 'failed' : 'pending'
  const earningTarget = action === 'HOLD' ? 'held' : action === 'CANCEL' ? 'cancelled' : 'accrued'

  // An already-PAID batch is out of reach — same honesty as the per-order path.
  const paid = await db.organizerPayout.findFirst({
    where: { eventId: ctx.eventId, status: 'paid' },
    select: { id: true },
  })

  const batch = await db.organizerPayout.findFirst({
    where: { eventId: ctx.eventId, status: { in: ['pending', 'held'] } },
    select: { id: true, status: true, totalCents: true },
  })

  if (!batch && paid) {
    throw new ApiError(
      "This event's organizer payout has already been transferred — it can no longer be held. Reversing a sent transfer is a separate action.",
      409,
      'ALREADY_PAID',
    )
  }

  // Earnings not yet in any batch (or in this batch) — flip them so they don't get
  // swept into the NEXT batch either.
  const affected = await db.organizerEarning.findMany({
    where: {
      eventId: ctx.eventId,
      status: { in: action === 'RELEASE' ? ['held'] : ['accrued'] },
    },
    select: { id: true, amountCents: true },
  })

  const writes: any[] = [
    db.organizerEarning.updateMany({
      where: { id: { in: affected.map(a => a.id) } },
      data: { status: earningTarget },
    }),
  ]
  if (batch) {
    writes.push(
      db.organizerPayout.update({ where: { id: batch.id }, data: { status: batchTarget } }),
    )
  }

  const amountCents = (batch?.totalCents ?? 0) || affected.reduce((s, a) => s + a.amountCents, 0)

  writes.push(
    auditRow(ctx, {
      action, payeeType: 'organizer', payeeId: organizerId,
      amountCents, reason,
      metadata: {
        batchId: batch?.id ?? null,
        previousBatchStatus: batch?.status ?? null,
        newBatchStatus: batch ? batchTarget : null,
        earningsAffected: affected.length,
        newEarningStatus: earningTarget,
      },
    }),
  )

  const results = await db.$transaction(writes)
  const audit = results[results.length - 1] as { id: string }

  logger.warn('[AdminMoney] organizer payout state changed', {
    admin: ctx.adminClerkId, eventId: ctx.eventId, organizerId,
    action, batchId: batch?.id ?? null, earningsAffected: affected.length,
  })
  return {
    action, payeeType: 'organizer', payeeId: organizerId,
    amountCents, previousStatus: batch?.status, newStatus: batch ? batchTarget : earningTarget,
    auditId: audit.id,
  }
}

// ─── Entity-wide freeze (the kill-switch pattern) ─────────────────────────────

/**
 * Freeze / unfreeze EVERY payout for one payee, across every order in this fair.
 *
 * Mirrors the proven org kill-switch (FairOrganizer.suspendedAt): admin-only write,
 * plain DB state read fresh by the executor on every payout, so it takes effect on
 * the very next attempt with no token or queue lag, and the payee cannot self-rescue.
 * This is the blunt "stop paying this person while we investigate" lever; the
 * surgical one is setOrderPayoutState.
 *
 * NOTE for organizers: this is deliberately SEPARATE from suspendedAt. Suspension
 * blocks their portal requests; a payout freeze stops their money while leaving them
 * able to run the fair. An admin may well want one without the other.
 */
export async function setPayoutFreeze(
  ctx: AdminMoneyContext,
  params: { payeeType: PayeeType; payeeId: string; frozen: boolean; reason: string },
): Promise<MoneyActionResult> {
  const { payeeType, payeeId, frozen, reason } = params
  if (!reason?.trim()) throw new ApiError('A reason is required for every money action', 400, 'REASON_REQUIRED')

  const action: MoneyActionType = frozen ? 'FREEZE' : 'UNFREEZE'
  const data = frozen
    ? { payoutsFrozenAt: new Date(), payoutsFrozenReason: reason, payoutsFrozenBy: ctx.adminClerkId }
    : { payoutsFrozenAt: null, payoutsFrozenReason: null, payoutsFrozenBy: null }

  // Fair-scoping. Vendors and Runners are event-scoped rows, so we require the row to
  // live in THIS fair — an admin in Fair A cannot freeze Fair B's vendor.
  // Organizers are NOT event-scoped (one org, many fairs — the locked Part B decision),
  // so we require the organizer to be the one that OWNS this fair. Freezing them is
  // inherently cross-fair, which is correct: it is their Connect account, and it is
  // exactly why the action is recorded against this eventId in the audit trail.
  if (payeeType === 'vendor') {
    const v = await db.vendor.findFirst({
      where: { id: payeeId, eventId: ctx.eventId },
      select: { id: true, payoutsFrozenAt: true },
    })
    if (!v) throw new ApiError('Vendor not found in this fair', 404, 'VENDOR_NOT_FOUND')
    const [, audit] = await db.$transaction([
      db.vendor.update({ where: { id: v.id }, data }),
      auditRow(ctx, {
        action, payeeType, payeeId, reason,
        metadata: { previouslyFrozen: !!v.payoutsFrozenAt, scope: 'all payouts for this vendor' },
      }),
    ])
    logger.warn('[AdminMoney] vendor payout freeze', { admin: ctx.adminClerkId, eventId: ctx.eventId, vendorId: payeeId, frozen })
    return { action, payeeType, payeeId, auditId: audit.id }
  }

  if (payeeType === 'runner') {
    const r = await db.runner.findFirst({
      where: { id: payeeId, eventId: ctx.eventId },
      select: { id: true, payoutsFrozenAt: true },
    })
    if (!r) throw new ApiError('Runner not found in this fair', 404, 'RUNNER_NOT_FOUND')
    const [, audit] = await db.$transaction([
      db.runner.update({ where: { id: r.id }, data }),
      auditRow(ctx, {
        action, payeeType, payeeId, reason,
        metadata: { previouslyFrozen: !!r.payoutsFrozenAt, scope: 'all payouts for this runner' },
      }),
    ])
    logger.warn('[AdminMoney] runner payout freeze', { admin: ctx.adminClerkId, eventId: ctx.eventId, runnerId: payeeId, frozen })
    return { action, payeeType, payeeId, auditId: audit.id }
  }

  // organizer — must be the organizer that owns THIS fair.
  const event = await db.event.findUnique({ where: { id: ctx.eventId }, select: { organizerId: true } })
  if (!event?.organizerId || event.organizerId !== payeeId) {
    throw new ApiError('That organizer does not own this fair', 404, 'ORGANIZER_NOT_FOUND')
  }
  const o = await db.fairOrganizer.findUnique({ where: { id: payeeId }, select: { id: true, payoutsFrozenAt: true } })
  if (!o) throw new ApiError('Organizer not found', 404, 'ORGANIZER_NOT_FOUND')

  const [, audit] = await db.$transaction([
    db.fairOrganizer.update({ where: { id: o.id }, data }),
    auditRow(ctx, {
      action, payeeType, payeeId, reason,
      metadata: {
        previouslyFrozen: !!o.payoutsFrozenAt,
        scope: 'ALL fairs this organizer runs (their Connect account is org-level, not per-fair)',
      },
    }),
  ])
  logger.warn('[AdminMoney] organizer payout freeze', { admin: ctx.adminClerkId, eventId: ctx.eventId, organizerId: payeeId, frozen })
  return { action, payeeType, payeeId, auditId: audit.id }
}
