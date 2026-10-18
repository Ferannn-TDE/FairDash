/**
 * Owed-back refunds — the TIP and the DELIVERY FEE of a cancelled order that no runner earned.
 * (File name kept from Part B B4, when only the tip went back.) LIVE: plans AND executes.
 * reconcileTipRefunds is the PRIMARY path — Pattern R in lib/reconciler.ts calls it every sweep;
 * there is no per-order enqueue.
 *
 * THE CASE: a CANCELLED runner-fulfilled order where NO runner earned anything (no RunnerEarning).
 * Nobody did the delivery, so neither the tip nor the delivery/curbside fee belongs to anyone →
 * both go BACK to the customer. The per-vendor refund engine returns the food and never touches
 * either, so this is the only path that returns them. FairSynq's service fee and the organizer's
 * service charge are kept.
 *
 * THE POLICY BOUNDARY: owed back ONLY when no RunnerEarning exists. If one exists a runner did
 * the work and the tip + fee share are THEIRS — never refunded. Re-checked at execute.
 * The fee is accrued as RunnerEarning + OrganizerEarning in the SAME write at DELIVERED, so an
 * OrganizerEarning without a RunnerEarning is an impossible state → halt, never refund.
 *
 * NO DOUBLE REFUNDS — checked against STRIPE'S OWN RECORDS, not just our marker and key.
 * Before refunding we read the charge and every refund on it (all pages), then:
 *   priorOwedBack = earlier owed-back refunds on this charge for this order (metadata kind
 *                   'tip_owed_back' from the tip-only era, or 'owed_back'), pending or succeeded
 *   owedNet       = tip + fee − priorOwedBack
 *   room          = charge − service fee − service charge − every pending/succeeded refund
 *   owedNet ≤ 0   → already covered: record the existing refund id as the marker, audit, no refund
 *   room < owedNet → HALT (unrecorded refunds on the charge — a person decides), no refund
 *   otherwise     → refund owedNet under `owed_back_${orderId}`
 * Subtracting priorOwedBack BY LABEL is what makes this key-independent: a tip refunded under the
 * old key `tip_refund_${id}` whose marker write was lost is still seen, even when the food refund
 * has not happened yet and `room` alone would allow the tip a second time.
 *
 * HALTS are durable (OwedBackHalt), shown on the admin money page until an admin resolves them
 * with a note, and re-checked every sweep meanwhile. Resolving never refunds.
 */

import type { Prisma } from '@prisma/client'
import { db } from './db'
import { stripe } from './stripe'
import { logger } from './logger'
import { writeMoneyAudit } from './admin-money'

/**
 * NO RETROACTIVE FEE REFUNDS (decision 2). Before 1.2 the scan only looked at tipped orders, so
 * a cancelled fee-only order from before this change was never owed anything by the code and
 * carries no marker. The fee is owed back only when the order was cancelled at or after this
 * instant; earlier cancels keep the old rule (tip only). A fixed constant, never the clock.
 * Orders with no cancelledAt are treated as before the cutoff.
 */
export const OWED_BACK_FEE_FROM = new Date('2026-10-19T00:00:00Z')

/** Metadata `kind` values that mark a refund as an owed-back refund for metadata.orderId. */
export const OWED_BACK_KINDS = ['tip_owed_back', 'owed_back'] as const
export const owedBackIdempotencyKey = (orderId: string) => `owed_back_${orderId}`

/** Per Stripe request. The page cap bounds the whole read (pages × timeout). */
export const STRIPE_READ_TIMEOUT_MS = 8000
const REFUND_PAGE_SIZE = 100
const REFUND_MAX_PAGES = 10

const cents = (v: number | null | undefined) => Math.round((v ?? 0) * 100)

/**
 * THE scan — shared by the executor, Pattern R's dry run and Pattern L's alert so the three can't
 * drift. A RESOLVED halt drops the order out for good; an unresolved one stays in (re-checked).
 */
export function owedBackCandidateWhere(): Prisma.OrderWhereInput {
  return {
    status: 'CANCELLED',
    OR: [{ tip: { gt: 0 } }, { deliveryFee: { gt: 0 }, cancelledAt: { gte: OWED_BACK_FEE_FROM } }],
    runnerEarning: { is: null },
    tipRefundId: null,
    voidedAt: null,
    NOT: { owedBackHalt: { is: { resolvedAt: { not: null } } } },
  }
}

// ─── The plan (pure read) ─────────────────────────────────────────────────────

export type TipRefundOutcome =
  | 'refund'                  // owed back: cancelled, tip and/or fee, NO runner earned it
  | 'excluded_runner_earned'  // a runner earned it → theirs, NEVER refund
  | 'already_refunded'        // tipRefundId set → idempotent skip
  | 'nothing_owed'            // no tip and no fee
  | 'not_terminal'            // not cancelled → not owed back yet

export interface TipRefundPlan {
  orderId: string
  outcome: TipRefundOutcome
  tipCents: number
  /** The fee part owed back: the order's fee, or 0 when it was cancelled before OWED_BACK_FEE_FROM. */
  deliveryFeeCents: number
  /** tip + fee when outcome 'refund', else 0. Earlier owed-back refunds are subtracted at execute. */
  owedBackCents: number
  chargeId: string | null
  hasRunnerEarning: boolean
  alreadyRefunded: boolean
}

export async function planTipRefund(orderId: string): Promise<TipRefundPlan> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, status: true, tip: true, deliveryFee: true, stripeChargeId: true, tipRefundId: true, cancelledAt: true,
      runnerEarning: { select: { id: true } },
    },
  })
  if (!order) throw new Error(`planTipRefund: order ${orderId} not found`)

  const tipCents = cents(order.tip)
  const feeOwed = !!order.cancelledAt && order.cancelledAt >= OWED_BACK_FEE_FROM
  const deliveryFeeCents = feeOwed ? cents(order.deliveryFee) : 0
  const base = {
    orderId: order.id,
    tipCents,
    deliveryFeeCents,
    chargeId: order.stripeChargeId ?? null,
    hasRunnerEarning: !!order.runnerEarning,
    alreadyRefunded: !!order.tipRefundId,
  }

  if (tipCents + deliveryFeeCents <= 0) return { ...base, outcome: 'nothing_owed', owedBackCents: 0 }
  if (base.alreadyRefunded) return { ...base, outcome: 'already_refunded', owedBackCents: 0 }
  // POLICY BOUNDARY — checked BEFORE the cancelled gate so earned money can never slip through.
  if (base.hasRunnerEarning) return { ...base, outcome: 'excluded_runner_earned', owedBackCents: 0 }
  if (order.status !== 'CANCELLED') return { ...base, outcome: 'not_terminal', owedBackCents: 0 }
  return { ...base, outcome: 'refund', owedBackCents: tipCents + deliveryFeeCents }
}

// ─── The ceiling (pure) ───────────────────────────────────────────────────────

export interface ChargeRefundRow {
  id: string
  amount: number
  status: string | null
  metadata: Record<string, string> | null
  created: number
}

export interface OwedBackLedger {
  orderId: string
  /** tip + fee, in cents. */
  owedCents: number
  chargeAmountCents: number
  /** What the customer never gets back: FairSynq's service fee + the service charge. */
  keptCents: number
  refunds: ChargeRefundRow[]
}

export type OwedBackDecision =
  | { kind: 'refund'; amountCents: number; priorOwedBackCents: number; roomCents: number }
  | { kind: 'covered'; adoptRefundId: string; priorOwedBackCents: number }
  | { kind: 'halt'; owedNetCents: number; roomCents: number; priorOwedBackCents: number; detail: string }

/** A refund that holds money back from the charge: pending or succeeded (also requires_action). */
const counts = (r: ChargeRefundRow) => r.status !== 'failed' && r.status !== 'canceled'

export function isOwedBackRefundFor(r: ChargeRefundRow, orderId: string): boolean {
  return r.metadata?.orderId === orderId && (OWED_BACK_KINDS as readonly string[]).includes(r.metadata?.kind ?? '')
}

export function decideOwedBack(l: OwedBackLedger): OwedBackDecision {
  const live = l.refunds.filter(counts)
  const prior = live.filter(r => isOwedBackRefundFor(r, l.orderId))
  const priorOwedBackCents = prior.reduce((s, r) => s + r.amount, 0)
  const refundedCents = live.reduce((s, r) => s + r.amount, 0)

  const owedNetCents = l.owedCents - priorOwedBackCents
  const roomCents = l.chargeAmountCents - l.keptCents - refundedCents

  if (owedNetCents <= 0) {
    const latest = [...prior].sort((a, b) => b.created - a.created)[0]
    if (latest) return { kind: 'covered', adoptRefundId: latest.id, priorOwedBackCents }
  }
  if (roomCents < owedNetCents || owedNetCents <= 0) {
    return {
      kind: 'halt', owedNetCents, roomCents, priorOwedBackCents,
      detail:
        `Owed back ${owedNetCents}¢ (tip + fee ${l.owedCents}¢ − earlier owed-back ${priorOwedBackCents}¢), ` +
        `but Stripe shows only ${roomCents}¢ refundable (charge ${l.chargeAmountCents}¢ − kept fees ${l.keptCents}¢ ` +
        `− refunds ${refundedCents}¢ across ${live.length}). Refunds on the charge we can't account for — check Stripe before acting.`,
    }
  }
  return { kind: 'refund', amountCents: owedNetCents, priorOwedBackCents, roomCents }
}

// ─── Stripe reads (bounded) ───────────────────────────────────────────────────

/** Every refund on the charge, all pages. Throws on timeout or if the list exceeds the cap. */
export async function readChargeRefunds(chargeId: string): Promise<ChargeRefundRow[]> {
  const rows: ChargeRefundRow[] = []
  let startingAfter: string | undefined
  for (let page = 0; page < REFUND_MAX_PAGES; page++) {
    const res = await stripe.refunds.list(
      { charge: chargeId, limit: REFUND_PAGE_SIZE, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      { timeout: STRIPE_READ_TIMEOUT_MS },
    )
    for (const r of res.data) {
      rows.push({ id: r.id, amount: r.amount, status: r.status, metadata: (r.metadata ?? null) as Record<string, string> | null, created: r.created })
    }
    if (!res.has_more || res.data.length === 0) return rows
    startingAfter = res.data[res.data.length - 1].id
  }
  throw new Error(`refund list for ${chargeId} exceeds ${REFUND_PAGE_SIZE * REFUND_MAX_PAGES} — not deciding on a partial read`)
}

// ─── Halts ────────────────────────────────────────────────────────────────────

export type OwedBackHaltReason = 'NO_CHARGE' | 'CHARGE_DISPUTED' | 'REFUND_ROOM_SHORT' | 'ORGANIZER_SHARE_WITHOUT_RUNNER'

async function recordHalt(
  o: { id: string; eventId: string },
  h: { reason: OwedBackHaltReason; detail: string; owedCents: number; roomCents: number | null },
) {
  const now = new Date()
  const existing = await db.owedBackHalt.findUnique({ where: { orderId: o.id }, select: { id: true } })
  if (existing) {
    await db.owedBackHalt.update({
      where: { orderId: o.id },
      data: { reason: h.reason, detail: h.detail, owedCents: h.owedCents, roomCents: h.roomCents, lastHaltedAt: now },
    })
    return
  }
  await db.owedBackHalt.create({
    data: { orderId: o.id, eventId: o.eventId, reason: h.reason, detail: h.detail, owedCents: h.owedCents, roomCents: h.roomCents, firstHaltedAt: now, lastHaltedAt: now },
  })
  // The audit row is written once, when the halt first appears — not every sweep.
  await writeMoneyAudit({ id: 'reconciler:owed-back', type: 'reconciler' }, o.eventId, {
    action: 'OWED_BACK_HALTED', payeeType: 'customer', payeeId: o.id, orderId: o.id,
    amountCents: h.owedCents, reason: `${h.reason}: ${h.detail}`,
    metadata: { roomCents: h.roomCents },
  })
  logger.error('[OwedBack] HALTED — customer is owed money and no refund was made', { orderId: o.id, reason: h.reason, owedCents: h.owedCents, roomCents: h.roomCents })
}

/** A halt that was open while the refund later went through (or was found covered) closes itself. */
async function closeOpenHalt(orderId: string, note: string) {
  await db.owedBackHalt.updateMany({
    where: { orderId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedBy: 'reconciler', resolutionNote: note },
  })
}

// ─── The executor (MOVES MONEY: a refund to the CUSTOMER) ─────────────────────

export interface TipRefundResult {
  orderId: string
  /** Set on a dry run: what a live run would have done. Nothing was written and no refund made. */
  dryRun?: boolean
  detail?: string
  outcome:
    | 'refunded' | 'covered' | 'halted' | 'halt_resolved'
    | 'excluded_runner_earned' | 'already_refunded' | 'nothing_owed' | 'not_terminal'
  amountCents?: number
  refundId?: string
  haltReason?: OwedBackHaltReason
}

/**
 * Refund what is still owed back on one order. Throws only on a Stripe/DB failure (the sweep
 * records TIP_REFUND_FAILED and retries next sweep). Every "don't know" path halts, never guesses.
 */
export async function processTipRefund(orderId: string, opts?: { dryRun?: boolean }): Promise<TipRefundResult> {
  const dryRun = opts?.dryRun === true
  const plan = await planTipRefund(orderId)
  if (plan.outcome !== 'refund') return { orderId, outcome: plan.outcome }

  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true, eventId: true, fairSynqFee: true, serviceCharge: true, stripePaymentIntentId: true,
      organizerEarning: { select: { id: true } },
      owedBackHalt: { select: { resolvedAt: true } },
    },
  })
  // An admin closed this one. Resolving never refunds, and nothing re-opens it automatically.
  if (order.owedBackHalt?.resolvedAt) return { orderId, outcome: 'halt_resolved' }

  // POLICY GATE re-checked at execute: a runner could have earned it since the plan.
  const earned = await db.runnerEarning.findUnique({ where: { orderId }, select: { id: true } })
  if (earned) {
    logger.warn('[OwedBack] runner earned it between plan and execute — NOT refunding', { orderId })
    return { orderId, outcome: 'excluded_runner_earned' }
  }

  const halt = async (reason: OwedBackHaltReason, detail: string, owedCents: number, roomCents: number | null): Promise<TipRefundResult> => {
    if (dryRun) return { orderId, outcome: 'halted', haltReason: reason, amountCents: owedCents, detail, dryRun }
    await recordHalt(order, { reason, detail, owedCents, roomCents })
    return { orderId, outcome: 'halted', haltReason: reason }
  }

  // The fee is split runner + organizer in ONE write; an organizer share alone means our books
  // are in a state we don't understand. Refunding could pay the fee twice (organizer + customer).
  if (order.organizerEarning) {
    return halt('ORGANIZER_SHARE_WITHOUT_RUNNER', 'OrganizerEarning exists with no RunnerEarning — the fee may already be owed to the organizer.', plan.owedBackCents, null)
  }

  let chargeId = plan.chargeId
  if (!chargeId && order.stripePaymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ['latest_charge'] }, { timeout: STRIPE_READ_TIMEOUT_MS })
    const ch = pi.latest_charge
    if (ch && typeof ch === 'object' && 'id' in ch) chargeId = ch.id as string
  }
  if (!chargeId) return halt('NO_CHARGE', 'No Stripe charge could be resolved for this cancelled order.', plan.owedBackCents, null)

  const charge = await stripe.charges.retrieve(chargeId, {}, { timeout: STRIPE_READ_TIMEOUT_MS })
  if (charge.disputed) {
    return halt('CHARGE_DISPUTED', `Charge ${chargeId} is disputed; the dispute decides what the customer gets back.`, plan.owedBackCents, null)
  }
  const refunds = await readChargeRefunds(chargeId)

  const decision = decideOwedBack({
    orderId,
    owedCents: plan.owedBackCents,
    chargeAmountCents: charge.amount,
    keptCents: cents(order.fairSynqFee) + cents(order.serviceCharge),
    refunds,
  })

  if (decision.kind === 'halt') return halt('REFUND_ROOM_SHORT', decision.detail, decision.owedNetCents, decision.roomCents)

  if (dryRun) {
    if (decision.kind === 'covered') return { orderId, outcome: 'covered', amountCents: 0, refundId: decision.adoptRefundId, dryRun, detail: `earlier owed-back ${decision.priorOwedBackCents}¢` }
    return { orderId, outcome: 'refunded', amountCents: decision.amountCents, dryRun, detail: `tip ${plan.tipCents}¢ + fee ${plan.deliveryFeeCents}¢ − earlier ${decision.priorOwedBackCents}¢; room ${decision.roomCents}¢` }
  }

  if (decision.kind === 'covered') {
    const w = await db.order.updateMany({
      where: { id: orderId, tipRefundId: null },
      data: { tipRefundId: decision.adoptRefundId, tipRefundedAt: new Date(), deliveryFeeRefundCents: plan.deliveryFeeCents },
    })
    if (w.count === 1) {
      await writeMoneyAudit({ id: 'reconciler:owed-back', type: 'reconciler' }, order.eventId, {
        action: 'OWED_BACK_COVERED', payeeType: 'customer', payeeId: orderId, orderId,
        amountCents: decision.priorOwedBackCents,
        reason: `already refunded at Stripe (${decision.priorOwedBackCents}¢ owed-back on the charge) — recorded ${decision.adoptRefundId}, no new refund`,
        metadata: { adoptedRefundId: decision.adoptRefundId, owedCents: plan.owedBackCents },
      })
    }
    await closeOpenHalt(orderId, `already refunded at Stripe (${decision.adoptRefundId})`)
    logger.money('[OwedBack] already covered at Stripe — marker recorded, no refund', { orderId, refundId: decision.adoptRefundId })
    return { orderId, outcome: 'covered', amountCents: 0, refundId: decision.adoptRefundId }
  }

  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount: decision.amountCents,
      metadata: {
        orderId, kind: 'owed_back',
        tipCents: String(plan.tipCents), deliveryFeeCents: String(plan.deliveryFeeCents),
        priorOwedBackCents: String(decision.priorOwedBackCents),
      },
    },
    { idempotencyKey: owedBackIdempotencyKey(orderId) },
  )

  await db.order.updateMany({
    where: { id: orderId, tipRefundId: null },
    data: { tipRefundId: refund.id, tipRefundedAt: new Date(), deliveryFeeRefundCents: plan.deliveryFeeCents },
  })
  await closeOpenHalt(orderId, `refunded ${decision.amountCents}¢ on a later sweep (${refund.id})`)

  logger.money('[OwedBack] tip + fee refunded to customer', {
    orderId, amountCents: decision.amountCents, tipCents: plan.tipCents, deliveryFeeCents: plan.deliveryFeeCents,
    priorOwedBackCents: decision.priorOwedBackCents, refundId: refund.id,
  })
  return { orderId, outcome: 'refunded', amountCents: decision.amountCents, refundId: refund.id }
}

// ─── Reconciler: the trigger (Pattern R delegates here) ───────────────────────

/** The fee part an order owes back, honouring OWED_BACK_FEE_FROM. */
const owedCentsOf = (o: { tip: number | null; deliveryFee: number | null; cancelledAt: Date | null }) =>
  cents(o.tip) + (o.cancelledAt && o.cancelledAt >= OWED_BACK_FEE_FROM ? cents(o.deliveryFee) : 0)

export interface TipRefundReconcileSummary {
  /** Dry run only: one entry per scanned order, saying what a live sweep would do. */
  results?: TipRefundResult[]
  scanned: number
  refunded: number
  covered: number
  halted: number
  excluded: number
  alerts: string[]
}

export async function reconcileTipRefunds(opts?: { maxPerRun?: number; dryRun?: boolean }): Promise<TipRefundReconcileSummary> {
  const max = opts?.maxPerRun ?? 200
  const dryRun = opts?.dryRun === true
  const owed = await db.order.findMany({
    where: owedBackCandidateWhere(),
    select: { id: true, eventId: true, tip: true, deliveryFee: true, cancelledAt: true },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: max,
  })

  const summary: TipRefundReconcileSummary = { scanned: owed.length, refunded: 0, covered: 0, halted: 0, excluded: 0, alerts: [], ...(dryRun ? { results: [] } : {}) }
  for (const o of owed) {
    try {
      const r = await processTipRefund(o.id, { dryRun })
      summary.results?.push(r)
      if (r.outcome === 'refunded') summary.refunded++
      else if (r.outcome === 'covered') summary.covered++
      else if (r.outcome === 'excluded_runner_earned') summary.excluded++
      else if (r.outcome === 'halted') {
        summary.halted++
        summary.alerts.push(`owed-back refund HALTED for ${o.id} (${r.haltReason}) — customer owed ${owedCentsOf(o)}¢; see the admin money page`)
      }
    } catch (err) {
      summary.alerts.push(`owed-back refund failed for ${o.id}: ${err instanceof Error ? err.message : String(err)}`)
      if (dryRun) continue

      // DURABLE FAILURE MARKER. A failure (Stripe down, read timeout) is retried next sweep with
      // the same key; this row dates it. NEVER Order.tipRefundId: it is the SUCCESS record, and a
      // sentinel there would drop the order out of the scan — a failed refund would stop retrying.
      try {
        await writeMoneyAudit(
          { id: 'reconciler:tip-refund', type: 'reconciler' },
          o.eventId,
          {
            action: 'TIP_REFUND_FAILED',
            payeeType: 'customer',
            payeeId: o.id,
            orderId: o.id,
            amountCents: owedCentsOf(o),
            reason: `owed-back refund failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        )
      } catch (auditErr) {
        // Bookkeeping must never change the outcome or abandon the rest of the sweep.
        logger.error('[OwedBack] failure-marker write failed (refund outcome unaffected)', {
          orderId: o.id, error: String(auditErr),
        })
      }
    }
  }
  return summary
}

// ─── Admin: resolve a halt (NEVER refunds) ────────────────────────────────────

/**
 * Close an open halt with a required note. The order leaves the owed-back scan for good, so it is
 * neither re-alerted nor refunded. Fair-scoped: keyed by orderId AND eventId.
 */
export async function resolveOwedBackHalt(ctx: { adminClerkId: string; eventId: string }, orderId: string, note: string) {
  const trimmed = note.trim()
  if (trimmed.length < 3) throw new Error('NOTE_REQUIRED')
  const halt = await db.owedBackHalt.findFirst({
    where: { orderId, eventId: ctx.eventId },
    select: { id: true, resolvedAt: true, owedCents: true, reason: true },
  })
  if (!halt) return { ok: false as const, code: 'NOT_FOUND' as const }
  if (halt.resolvedAt) return { ok: false as const, code: 'ALREADY_RESOLVED' as const }

  // Interactive, so the audit is written only when THIS call closed the halt (a concurrent
  // resolve gets count 0 and writes nothing).
  const closed = await db.$transaction(async (tx) => {
    const w = await tx.owedBackHalt.updateMany({
      where: { id: halt.id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedBy: ctx.adminClerkId, resolutionNote: trimmed },
    })
    if (w.count !== 1) return false
    await writeMoneyAudit({ id: ctx.adminClerkId, type: 'admin' }, ctx.eventId, {
      action: 'OWED_BACK_HALT_RESOLVED', payeeType: 'customer', payeeId: orderId, orderId,
      amountCents: halt.owedCents, reason: trimmed,
      metadata: { haltReason: halt.reason, refundIssued: false },
    }, tx)
    return true
  })
  if (!closed) return { ok: false as const, code: 'ALREADY_RESOLVED' as const }
  logger.money('[OwedBack] halt resolved by admin (no refund issued)', { orderId, eventId: ctx.eventId, adminClerkId: ctx.adminClerkId })
  return { ok: true as const }
}
