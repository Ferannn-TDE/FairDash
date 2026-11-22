/**
 * Per-vendor payout for separate charges & transfers.
 *
 * Runs at FULFILLMENT (order COMPLETED/DELIVERED), enqueued from the status
 * route. This is the SINGLE place transfer/fee math lives — placePaidOrder does
 * order creation only.
 *
 * Money model (locked):
 *   - Customer paid subtotal + 10% service fee.
 *   - FairSynq keeps the 10% CLEAN (Stripe fee does NOT touch it).
 *   - Vendors absorb the Stripe fee: each vendor gets subtotalSlice − feeShare,
 *     feeShare = proportional share of the REAL settled Stripe fee.
 *   - FairSynq's cut is the platform-balance remainder; it is never transferred.
 *
 * Correctness guarantees:
 *   - Fee read from the SETTLED balance_transaction (retry if not ready).
 *   - Integer-cent split that reconciles to the cent (lib/payout-split).
 *   - One idempotent transfer per (order, vendor) — retries never double-pay.
 *   - Reconciliation assertion BEFORE any transfer; on failure, halt (no money
 *     moves) and surface for manual review.
 *   - Unconnected / zero-or-negative vendors are HELD (logged, not paid); their
 *     slice stays in the platform balance and is still counted in the split so
 *     FairSynq's 10% stays exact.
 *
 * C1 — ADMIN GATE. This executor is the ONE place a vendor transfer can happen, so
 * it is where admin control is enforced. Every path that can pay a vendor (the
 * delayed job, the inline fallback, reconciler patterns B and D) funnels through
 * here, which means no enqueue path can route around an admin hold. The gate reads
 * VendorEarning.status ('held'/'cancelled') and Vendor.payoutsFrozenAt and produces
 * outcome 'blocked' — distinct from 'hold', because a blocked slice must NOT get a
 * PayoutHold row (that table means "waiting to be paid once the vendor connects",
 * and reconciler Pattern D exists to DRAIN it — writing an admin hold there would
 * make the reconciler pay it out on the next sweep).
 */

import { db } from './db'
import { stripe } from './stripe'
import { splitStripeFee } from './payout-split'
import { ensureOrderFeeSplit } from './fee-split'
import { FEE_MODEL_EXHIBIT_A, type CardFeesPaidBy } from './fees/exhibit-a'
import { logger } from './logger'
import { classifyStripeError, type StripeFailureVerdict } from './stripe-error-class'

/** Why a slice was refused without a transfer. Never gets a PayoutHold row. The first three are
 *  the admin gate; `transfer_exists` is the second double-pay guard (see classifyVendorSlice). */
export type PayoutBlockReason = 'admin_hold' | 'admin_cancelled' | 'payouts_frozen' | 'transfer_exists'

export type VendorPayoutOutcome = 'pay' | 'hold' | 'skip' | 'blocked' | 'already_paid'

/**
 * The per-slice payout decision — pure, so it can be unit-tested without Stripe or a DB.
 * processOrderPayout builds the maps from the order and calls this for each vendor line;
 * extracting it mirrors runner-payout's planRunnerPayout and lets the double-pay guard
 * (`paid → already_paid`) be proven with a positive control. Check ORDER is load-bearing:
 *   declined  → skip        (customer's refund, owned by the decline/refund flow)
 *   PAID      → already_paid (durable double-pay guard — refuse re-transfer BEFORE Stripe)
 *   TRANSFER EXISTS → blocked/transfer_exists (second double-pay guard, below)
 *   cancelled → blocked      (C1 admin gate)
 *   held      → blocked      (C1 admin gate)
 *   frozen    → blocked      (vendor payouts frozen)
 *   !connected/non-positive → hold
 *   else      → pay
 *
 * TRANSFER EXISTS (payout-safety fix, 2026-11). A Payout row for this order + vendor means a
 * transfer was already created (pending, paid, or since reversed by a refund or dispute
 * clawback), even though the earning isn't marked paid. Re-paying would call transfers.create on
 * an expired idempotency key — money out — and then crash on uq_payout_order_vendor, leaving the
 * transfer unrecorded. Production had exactly this shape: a disputed order whose transfers were
 * reversed by the dispute while its earnings stayed 'accrued'. The code can't tell "owed again"
 * from "charged back", so it refuses and a human decides; reconciler Pattern Y alerts on it.
 * Blocked, not already_paid: a reversed transfer is money the vendor no longer has, so the
 * earning must NOT be marked paid. No hold either (Pattern D would drain it).
 */
export function classifyVendorSlice(input: {
  declined: boolean
  earningStatus: string | null | undefined
  connected: boolean
  payoutsFrozen: boolean
  transferCents: number
  /** A Payout row (any status) exists for this order + vendor. */
  transferExists?: boolean
}): { outcome: VendorPayoutOutcome; heldReason: 'unconnected' | 'non_positive' | null; blockedReason: PayoutBlockReason | null } {
  const { declined, earningStatus, connected, payoutsFrozen, transferCents, transferExists } = input
  if (declined)                      return { outcome: 'skip',         heldReason: null,          blockedReason: null }
  if (earningStatus === 'paid')      return { outcome: 'already_paid', heldReason: null,          blockedReason: null }
  if (transferExists)                return { outcome: 'blocked',      heldReason: null,          blockedReason: 'transfer_exists' }
  if (earningStatus === 'cancelled') return { outcome: 'blocked',      heldReason: null,          blockedReason: 'admin_cancelled' }
  if (earningStatus === 'held')      return { outcome: 'blocked',      heldReason: null,          blockedReason: 'admin_hold' }
  if (payoutsFrozen)                 return { outcome: 'blocked',      heldReason: null,          blockedReason: 'payouts_frozen' }
  if (!connected)                    return { outcome: 'hold',         heldReason: 'unconnected',  blockedReason: null }
  if (transferCents <= 0)            return { outcome: 'hold',         heldReason: 'non_positive', blockedReason: null }
  return { outcome: 'pay', heldReason: null, blockedReason: null }
}

/** Thrown when the money identity doesn't hold — payout is halted, no transfers. */
export class PayoutReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutReconciliationError'
  }
}

/** Thrown when the charge/fee isn't settled yet — caller should RETRY. */
export class PayoutNotSettledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayoutNotSettledError'
  }
}

/**
 * Thrown when Stripe says this transfer can NEVER succeed as issued — a deleted destination,
 * a deauthorized connection, bad credentials. Distinct from PayoutReconciliationError, which
 * means OUR books disagree; this means STRIPE has refused permanently.
 *
 * Both halt, and both must halt, but conflating them would put a false statement in the audit
 * reason: "the money identity doesn't hold" is not what happened when an account was deleted.
 */
export class PayoutTerminalError extends Error {
  readonly verdict: StripeFailureVerdict
  constructor(message: string, verdict: StripeFailureVerdict) {
    super(message)
    this.name = 'PayoutTerminalError'
    this.verdict = verdict
  }
}

/**
 * HOW A TRANSFER IS LINKED TO ITS MONEY — one rule, because getting it wrong is invisible
 * until Stripe refuses, and it refused in production.
 *
 * ── THE BUG THIS ENCODES AGAINST ────────────────────────────────────────────────────────────
 * Every runner payout failed at Stripe with:
 *   "You cannot use `transfer_group` if the `source_transaction` already has one set."
 *
 * The charge ALWAYS carries a group: the PaymentIntent is created with
 * `transfer_group: order_grp_<uuid>` (app/api/orders/route.ts:436) and the charge inherits it.
 * Three legs then derived that value three different ways:
 *
 *   vendor    process-payout.ts:290   READS charge.transfer_group  → matches → accepted
 *   runner    runner-payout.ts:280    hardcoded `order_${orderId}` → DIFFERS → REJECTED
 *   organizer organizer-payout.ts:244 hardcoded `event_${eventId}` → no source_transaction,
 *                                      so no conflict — and it paid successfully in prod
 *
 * One value, three derivations, and the two that never ran in production were the wrong ones.
 * That is the through-line class arriving as a Stripe 400.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────
 * When `source_transaction` is set, DO NOT set `transfer_group`. The transfer inherits the
 * charge's group automatically, which is also the only way to be certain it MATCHES — a
 * locally-constructed group can only ever be a guess at a value Stripe already owns.
 * When there is no source_transaction (the organizer batch draws on the platform balance and
 * spans several charges), the transfer has no group to inherit, so it must carry its own.
 *
 * ── WHY THE VENDOR LEG IS NOT ROUTED THROUGH THIS (deliberate, named) ───────────────────────
 * It reads the charge's own value, so it passes a MATCHING group and Stripe accepts it —
 * proven in production on the very charge the runner leg fails on (order cmrv5vvly…, vendor
 * transfer tr_3Tvl9NHk… succeeded 2026-07-22; the runner transfer on that same charge is what
 * throws). Adopting the rule there would drop a redundant parameter for no behavioural gain,
 * on the ONLY money path proven end-to-end in production, nine days before the fair. Left
 * alone on purpose. Collapsing it is a post-fair follow-up, not a pre-fair edit.
 */
export function transferLinkage(opts: {
  /** The charge funding this transfer, when it is funded by one specific charge. */
  sourceTransaction?: string | null
  /** Group to use ONLY when there is no source transaction to inherit one from. */
  groupWhenUnsourced?: string
}): { source_transaction?: string; transfer_group?: string } {
  if (opts.sourceTransaction) return { source_transaction: opts.sourceTransaction }
  return opts.groupWhenUnsourced ? { transfer_group: opts.groupWhenUnsourced } : {}
}

/**
 * THE FAST-FAIL WRAPPER — the single consumer of the Stripe classifier, shared by all three
 * payout legs so the retry decision is made in ONE place.
 *
 * WHAT IT REPLACES: nothing inspected the error. All three legs called `stripe.transfers.create`
 * bare, the error propagated, and BullMQ's blanket `attempts: 3` retried blind. A dangling
 * account and a network blip were indistinguishable, so a destination that will NEVER resolve
 * cost 3 attempts plus exponential backoff before being marked.
 *
 * ⚠️ THE ONLY BEHAVIOUR CHANGE IS `terminal`. `transient` and `unknown` both rethrow the
 * ORIGINAL error object — same instance, same type identity, same message — so BullMQ's
 * handling and the finality gate at order-worker.ts:869 behave exactly as they do today. That
 * asymmetry is deliberate: misclassifying toward terminal abandons money that would have moved,
 * so anything not positively recognised as hopeless keeps every retry it has today.
 *
 * WHY IT THROWS A DOMAIN ERROR AND NOT UnrecoverableError: BullMQ is the worker's vocabulary,
 * not lib/'s. The worker already translates PayoutReconciliationError → UnrecoverableError at
 * the handler boundary; this rides that same seam rather than opening a second one, so the
 * durable marker and PAYOUT_FAILED audit come from the EXISTING finality gate.
 */
export async function transferOrTerminal<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const verdict = classifyStripeError(err)
    // transient | unknown → propagate UNCHANGED. Not `throw new Error(...)`: rethrowing the
    // original preserves instanceof checks upstream (PayoutNotSettledError et al).
    if (verdict.class !== 'terminal') throw err
    logger.money('[Payout] TERMINAL Stripe failure — fast-failing, no further retries', {
      context, reason: verdict.reason, code: verdict.code, param: verdict.param, statusCode: verdict.statusCode,
    })
    throw new PayoutTerminalError(`${context}: ${verdict.reason}`, verdict)
  }
}

export interface PayoutResult {
  orderId: string
  stripeFeeCents: number
  transfers: { vendorId: string; amountCents: number; transferId: string }[]
  held: { vendorId: string; sliceCents: number; reason: 'unconnected' | 'non_positive' }[]
  // Vendors who DECLINED — never paid, never held; their slice is the customer's
  // refund (handled by the decline/refund flow, not here).
  skippedDeclined: { vendorId: string; sliceCents: number }[]
  // C1 — slices the ADMIN GATE refused (held / cancelled / frozen). No transfer, no
  // PayoutHold row; the money stays in the platform balance under admin control.
  blocked: { vendorId: string; sliceCents: number; reason: PayoutBlockReason }[]
}

/**
 * C1 — accrue the vendor's HELD CLAIM on an order (the hold anchor).
 *
 * Runners and organizers accrue an earnings row the moment they earn; vendors did
 * not, so there was no row for an admin to hold between checkout and payout. This
 * creates it. Idempotent (upsert on orderId+vendorId), so it is safe to call from
 * the completion side-effect AND defensively from the executor (self-heals orders
 * that predate this table, and any accrual that got dropped).
 *
 * subtotalCents is the vendor's claim BEFORE the Stripe fee share, which is not
 * knowable until settlement. It is deliberately NOT what gets paid — the executor
 * still computes the authoritative net from the real settled fee and stamps it back.
 * Never overwrites a paid/held/cancelled row's status.
 */
/**
 * The ONE definition of "which vendors on this order are owed an earning row".
 * A DECLINED / REFUNDED / CANCELLED portion is NOT payable — the executor already
 * skips them at pay time (see the declined/refunded gate below); accruing them
 * anyway wrote PHANTOM 'accrued' rows that inflated the admin panel's payableCents
 * with money nobody is owed (8 such rows, $200.00, written 2026-07-17 by the
 * executor's self-heal and Pattern S before this fix). Used by BOTH this accrual
 * and reconciler Pattern S's detection, so the two can't drift.
 */
export const NON_PAYABLE_VENDOR_STATUSES = new Set(['DECLINED', 'REFUNDED', 'CANCELLED'])

/** Order states where a WORKED portion closed CANCELLED is still owed its earning (payout gap fix, 2026-11-22). */
export const WORKED_PORTION_PAYABLE_ORDER_STATUSES = new Set(['UNDELIVERABLE', 'UNCOLLECTED'])

/**
 * THE ONE payable rule for a vendor portion (BATCH-1 §19, payout gap Q1). Used by the accrual gate, reconciler
 * Pattern S, the accrual reverser, Pattern T and the executor, so they can't drift.
 *   DECLINED / REFUNDED            → never payable.
 *   CANCELLED                      → payable ONLY when ALL hold: the order is UNDELIVERABLE or UNCOLLECTED (the order
 *                                    died after the food was made), that vendor has no completed refund, and the
 *                                    portion has acceptedAt (proof the vendor worked it). Otherwise not payable —
 *                                    which keeps the July phantom-earning case (refunded/cancelled orders) blocked and
 *                                    leaves operator-cancelled orders exactly as before.
 *   anything else                  → payable.
 */
export function isPortionPayable(
  portion: { status: string; acceptedAt?: Date | null },
  ctx: { orderStatus: string; vendorRefunded: boolean },
): boolean {
  if (portion.status === 'DECLINED' || portion.status === 'REFUNDED') return false
  if (portion.status === 'CANCELLED') {
    return WORKED_PORTION_PAYABLE_ORDER_STATUSES.has(ctx.orderStatus) && !ctx.vendorRefunded && !!portion.acceptedAt
  }
  return true
}

/** Vendors with a COMPLETED refund on the order (the "vendor refunded" input to isPortionPayable). */
export const refundedVendorIds = (refunds: { vendorId: string; status: string }[]) =>
  new Set(refunds.filter(r => r.status === 'COMPLETED').map(r => r.vendorId))

export function payableVendorIds(
  orderItems: { vendorId: string }[],
  vendorStatuses: { vendorId: string; status: string; acceptedAt?: Date | null }[],
  ctx: { orderStatus: string; refunds: { vendorId: string; status: string }[] },
): Set<string> {
  const refunded = refundedVendorIds(ctx.refunds)
  const excluded = new Set(
    vendorStatuses.filter(v => !isPortionPayable(v, { orderStatus: ctx.orderStatus, vendorRefunded: refunded.has(v.vendorId) })).map(v => v.vendorId),
  )
  return new Set(orderItems.map(i => i.vendorId).filter(v => !excluded.has(v)))
}

export async function accrueVendorEarnings(orderId: string): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, eventId: true, status: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true, acceptedAt: true } },
      refunds: { select: { vendorId: true, status: true } },
    },
  })
  if (!order) return 0

  const payable = payableVendorIds(order.orderItems, order.vendorOrderStatuses, { orderStatus: order.status, refunds: order.refunds })
  const subtotals: Record<string, number> = {}
  for (const item of order.orderItems) {
    if (!payable.has(item.vendorId)) continue // refunded/declined/cancelled portion — no earning owed
    subtotals[item.vendorId] = (subtotals[item.vendorId] ?? 0) + Math.round(item.subtotal * 100)
  }

  // Which portions already have a row — so we log only GENUINELY-NEW accruals, not idempotent
  // re-accruals. A new accrual raises the admin's payable, and this path (executor / Pattern S)
  // was SILENT — it moved $80 during a watch window with no log line (Q5). Now it emits a
  // prod-visible ledger-delta so money moving outside the sweep is never invisible.
  const existing = new Set(
    (await db.vendorEarning.findMany({ where: { orderId }, select: { vendorId: true } })).map(e => e.vendorId),
  )
  const newlyAccrued: { vendorId: string; cents: number }[] = []

  let accrued = 0
  for (const [vendorId, subtotalCents] of Object.entries(subtotals)) {
    await db.vendorEarning.upsert({
      where: { orderId_vendorId: { orderId, vendorId } },
      create: { eventId: order.eventId, orderId, vendorId, subtotalCents, status: 'accrued' },
      // Refresh the claim amount only. status is NOT touched — an admin hold, a
      // cancel, or a completed payout must survive re-accrual.
      update: { subtotalCents },
    })
    if (!existing.has(vendorId)) newlyAccrued.push({ vendorId, cents: subtotalCents })
    accrued++
  }

  if (newlyAccrued.length) {
    const total = newlyAccrued.reduce((s, n) => s + n.cents, 0)
    logger.warn(
      `[Ledger] accrued ${newlyAccrued.length} vendor portion(s) on order ${orderId} (event ${order.eventId}): ` +
      `+$${(total / 100).toFixed(2)} [${newlyAccrued.map(n => `${n.vendorId.slice(-6)}+${n.cents}¢`).join(' ')}]`,
    )
  }
  return accrued
}

export async function processOrderPayout(orderId: string): Promise<PayoutResult> {
  // C1 — make sure the hold anchor exists before we decide anything. Self-healing:
  // legacy orders (pre-VendorEarning) get their rows here, so the admin gate below
  // is never silently skipped for want of a row.
  await accrueVendorEarnings(orderId)

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      eventId: true,
      subtotal: true,
      fairSynqFee: true,
      deliveryFee: true,
      serviceCharge: true,
      tip: true,
      taxCents: true, // B1.19
      status: true, // payout gap Q4: an UNDELIVERABLE order's partner earns nothing
      total: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      orderItems: { select: { vendorId: true, subtotal: true } },
      vendorTaxes: { select: { vendorId: true, salesTaxCents: true, localTaxCents: true } }, // B1.19
      // Item 10 stage 4: the fee model decides the split (null = today's legacy split, unchanged).
      feeModel: true,
      cardFeesPaidBy: true,
    },
  })
  if (!order) throw new Error(`processOrderPayout: order ${orderId} not found`)

  // ── Resolve the charge id (needed for source_transaction + fee read) ──────
  let chargeId = order.stripeChargeId ?? null
  if (!chargeId && order.stripePaymentIntentId) {
    const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = pi.latest_charge
    if (charge && typeof charge === 'object' && 'id' in charge) {
      chargeId = charge.id as string
      await db.order.update({ where: { id: orderId }, data: { stripeChargeId: chargeId } }).catch(() => {})
    }
  }
  if (!chargeId) throw new PayoutNotSettledError(`order ${orderId}: no charge yet`)

  // ── Read the REAL settled Stripe fee from the balance transaction ─────────
  const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
  const bt = charge.balance_transaction
  if (!bt || typeof bt !== 'object' || bt.fee == null) {
    // Balance transaction lags after payment_intent.succeeded — retry, never guess.
    throw new PayoutNotSettledError(`order ${orderId}: balance transaction not settled yet`)
  }
  const stripeFeeCents = bt.fee
  const transferGroup = charge.transfer_group ?? `order_${orderId}`

  // ── Per-vendor subtotals (integer cents, from the DB — authoritative) ─────
  const vendorSubtotalsCents: Record<string, number> = {}
  for (const item of order.orderItems) {
    vendorSubtotalsCents[item.vendorId] =
      (vendorSubtotalsCents[item.vendorId] ?? 0) + Math.round(item.subtotal * 100)
  }
  const totalSubtotalCents = Object.values(vendorSubtotalsCents).reduce((s, c) => s + c, 0)

  const totalCents = Math.round(order.total * 100)
  const serviceFeeCents = Math.round(order.fairSynqFee * 100)
  const deliveryCents = Math.round((order.deliveryFee ?? 0) * 100)
  const serviceChargeCents = Math.round((order.serviceCharge ?? 0) * 100)
  // Tip: platform-held but OWED to the runner (a liability, NOT FairSynq revenue).
  // Part of the charge, so it MUST appear in both identity sides.
  const tipCents = Math.round((order.tip ?? 0) * 100)
  // B1.19: the order's tax (Σ its OrderVendorTax parts; 0 on legacy and untaxed orders). Paid out to the vendors.
  const taxCents = order.taxCents

  // ── Reconciliation 1: customer side (no money moved yet) ──────────────────
  const customerSide = totalSubtotalCents + serviceFeeCents + deliveryCents + serviceChargeCents + tipCents + taxCents
  if (customerSide !== totalCents) {
    throw new PayoutReconciliationError(
      `order ${orderId}: customer-side mismatch — charge ${totalCents}¢ ≠ subtotal ${totalSubtotalCents} + serviceFee ${serviceFeeCents} + delivery ${deliveryCents} + serviceCharge ${serviceChargeCents} + tip ${tipCents} + tax ${taxCents}`,
    )
  }

  // ── Proportional fee split (Σ feeShare === stripeFee exactly) ─────────────
  // feeModel null (legacy): today's split, unchanged — vendors carry the whole fee by food share.
  // feeModel 2 (Exhibit A, item 10 stage 4): each party carries its own processing; the split is
  // computed ONCE at the first run and stored (lib/fee-split.ts), and every run pays from it.
  const exhibitA = order.feeModel === FEE_MODEL_EXHIBIT_A
    ? await ensureOrderFeeSplit({
        orderId, eventId: order.eventId, vendorFoodCents: vendorSubtotalsCents,
        serviceFeeCents, runnerFeeCents: deliveryCents, tipCents,
        cardFeesPaidBy: (order.cardFeesPaidBy ?? 'VENDOR') as CardFeesPaidBy, realStripeFeeCents: stripeFeeCents,
        vendorTaxCents: Object.fromEntries(order.vendorTaxes.map(t => [t.vendorId, t.salesTaxCents + t.localTaxCents])),
        partnerEarns: order.status !== 'UNDELIVERABLE',
      })
    : null
  // B1.19: tax exists only on feeModel 2 orders (the order route is the only writer). A legacy order carrying tax
  // has no rule to pay it out: halt, never guess.
  if (!exhibitA && taxCents > 0) {
    throw new PayoutReconciliationError(`order ${orderId}: legacy (feeModel null) order carries ${taxCents}¢ tax; no payout rule for it. Halted.`)
  }
  const lines = exhibitA ? exhibitA.lines : splitStripeFee(vendorSubtotalsCents, stripeFeeCents)

  const vendorIds = lines.map(l => l.vendorId)
  const [vendors, statuses, earnings, existingPayouts] = await Promise.all([
    db.vendor.findMany({
      where: { id: { in: vendorIds } },
      // C1: payoutsFrozenAt — the vendor-wide admin kill-switch.
      select: { id: true, stripeAccountId: true, stripeVerified: true, payoutsFrozenAt: true },
    }),
    db.vendorOrderStatus.findMany({
      where: { orderId },
      select: { vendorId: true, status: true, acceptedAt: true },
    }),
    // C1: the hold anchor — accrued above, so a row exists for every payable vendor.
    db.vendorEarning.findMany({
      where: { orderId },
      select: { id: true, vendorId: true, status: true },
    }),
    // transfer_exists guard: any Payout row (pending / paid / reversed) = a transfer was made.
    db.payout.findMany({
      where: { orderId },
      select: { vendorId: true },
    }),
  ])
  const vendorMap = new Map(vendors.map(v => [v.id, v]))
  const statusMap = new Map(statuses.map(s => [s.vendorId, s.status]))
  const portionMap = new Map(statuses.map(s => [s.vendorId, s]))
  // The shared payable rule needs the order's state and which vendors were refunded.
  const payCtx = await db.order.findUnique({ where: { id: orderId }, select: { status: true, refunds: { select: { vendorId: true, status: true } } } })
  const refundedForPay = refundedVendorIds(payCtx?.refunds ?? [])
  const earningMap = new Map(earnings.map(e => [e.vendorId, e]))
  const transferVendorIds = new Set(existingPayouts.map(p => p.vendorId))

  // Decide outcome per vendor BEFORE moving any money.
  //   pay     — connected, completed, positive slice → transfer
  //   hold    — completed but unconnected / non-positive → persist a PayoutHold
  //             (a WAITING ROOM: reconciler Pattern D drains it when they connect)
  //   skip    — DECLINED/REFUNDED → never paid, never held; their slice is the
  //             customer's refund, owned by the decline/refund flow (not here)
  //   blocked — C1 ADMIN GATE: held / cancelled / frozen. No transfer AND no
  //             PayoutHold row — a blocked slice must never land in the waiting
  //             room, or Pattern D would pay it out on the next sweep.
  const plan = lines.map(line => {
    const v = vendorMap.get(line.vendorId)
    const connected = !!(v?.stripeAccountId && v.stripeVerified)
    // DECLINED or REFUNDED → never pay. Their slice is the customer's refund,
    // owned by the decline/refund flow (lib/process-refund.ts), not here. This is
    // the defense-in-depth for a CASE 1 refund: a vendor refunded within the
    // window is marked REFUNDED, so when this DELAYED payout finally fires it
    // skips them and still pays every other vendor on the cart.
    const status = statusMap.get(line.vendorId)
    // Payout gap fix: the ONE payable rule decides (a worked CANCELLED portion on an UNDELIVERABLE / UNCOLLECTED order is
    // payable; any other CANCELLED portion is skipped like DECLINED / REFUNDED). A vendor with no portion row stays payable.
    const portion = portionMap.get(line.vendorId)
    const declined = !!portion && !isPortionPayable(portion, { orderStatus: payCtx?.status ?? '', vendorRefunded: refundedForPay.has(line.vendorId) })
    const earning = earningMap.get(line.vendorId)

    // The decision is a pure function (classifyVendorSlice) so it can be proven with a
    // positive control without Stripe or a DB. The DURABLE DOUBLE-PAY GUARD lives there:
    // a row already 'paid' → 'already_paid', refused BEFORE Stripe. The idempotency key
    // (`payout_<order>_<vendor>`) only protects the FAST retry — it expires at Stripe
    // after 24h, so a failed-set job re-run by hand a day later would double-pay on an
    // expired key. Reading the durable ledger is the slow-path guard the key can't be.
    const { outcome, heldReason, blockedReason } = classifyVendorSlice({
      declined,
      earningStatus: earning?.status,
      connected,
      payoutsFrozen: !!v?.payoutsFrozenAt,
      transferCents: line.transferCents,
      transferExists: transferVendorIds.has(line.vendorId),
    })

    return {
      ...line,
      stripeAccountId: v?.stripeAccountId ?? null,
      earningId: earning?.id ?? null,
      outcome,
      heldReason,
      blockedReason,
    }
  })

  const sentCents        = plan.filter(p => p.outcome === 'pay').reduce((s, p) => s + p.transferCents, 0)
  const heldCents        = plan.filter(p => p.outcome === 'hold').reduce((s, p) => s + p.transferCents, 0)
  const skippedCents     = plan.filter(p => p.outcome === 'skip').reduce((s, p) => s + p.transferCents, 0)
  const blockedCents     = plan.filter(p => p.outcome === 'blocked').reduce((s, p) => s + p.transferCents, 0)
  // Already-paid slices were sent on a PRIOR run — they sit on the sent side of the
  // payout-side identity (money already left the platform to the vendor), never the
  // refundable-skip side. On a re-run their cents move from `sent` to `alreadyPaid`;
  // both count identically toward Σ === charge, so the invariant holds across re-runs.
  const alreadyPaidCents = plan.filter(p => p.outcome === 'already_paid').reduce((s, p) => s + p.transferCents, 0)

  // ── Reconciliation 2: payout side ─────────────────────────────────────────
  //   Σ(sent) + Σ(held) + Σ(blocked) + Σ(skipped/declined→refundable) + serviceFee
  //     + delivery + serviceCharge + tip + stripeFee === charge
  //   tip is platform-held-owed-to-runner (like delivery/serviceCharge: retained,
  //   not transferred in this phase). Runner/organizer payouts are Part B.
  //   blocked is retained in the platform balance under admin control — it MUST be
  //   in the identity, or an admin hold would look like money that vanished.
  // feeModel 2: FairSynq keeps its NET (service fee − its processing share), the partner's curbside
  // fee + tip sit HELD net of its share (PartnerEarning), and the stored split's fee is the real fee.
  // Payout gap Q4: on a feeModel 2 UNDELIVERABLE order the curbside fee + tip are OWED BACK to the customer (owed-back
  // refunds them, before or after this payout), not held for the partner — so they sit on this side as owed back.
  const owedBackCents = exhibitA && order.status === 'UNDELIVERABLE' ? deliveryCents + tipCents : 0
  const payoutSide = sentCents + alreadyPaidCents + heldCents + blockedCents + skippedCents + serviceChargeCents
    + (exhibitA
      ? exhibitA.fairsynqNetCents + exhibitA.partnerNetCents + exhibitA.realStripeFeeCents + owedBackCents
      : serviceFeeCents + deliveryCents + tipCents + stripeFeeCents)
  if (payoutSide !== totalCents) {
    throw new PayoutReconciliationError(
      `order ${orderId}: payout-side mismatch — ${payoutSide}¢ ≠ charge ${totalCents}¢ (sent ${sentCents}, alreadyPaid ${alreadyPaidCents}, held ${heldCents}, blocked ${blockedCents}, skipped ${skippedCents}, serviceFee ${serviceFeeCents}, delivery ${deliveryCents}, serviceCharge ${serviceChargeCents}, tip ${tipCents}, stripeFee ${stripeFeeCents})`,
    )
  }

  // ── Apply (idempotent per order+vendor) ───────────────────────────────────
  const result: PayoutResult = { orderId, stripeFeeCents, transfers: [], held: [], skippedDeclined: [], blocked: [] }

  for (const p of plan) {
    if (p.outcome === 'blocked') {
      // NO transfer, NO PayoutHold row. The VendorEarning row (status held/cancelled)
      // or the vendor's freeze flag IS the hold; the money stays in the platform
      // balance where the admin can release or cancel it. transfer_exists: a transfer for
      // this slice was already made; nothing changes until a human decides (Pattern Y).
      logger.warn(p.blockedReason === 'transfer_exists'
        ? '[Payout] vendor slice BLOCKED — a transfer for this order and vendor already exists; not re-paying (Pattern Y alerts)'
        : '[Payout] vendor slice BLOCKED by admin gate — no transfer', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.blockedReason,
      })
      result.blocked.push({ vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.blockedReason! })
      continue
    }

    if (p.outcome === 'skip') {
      logger.warn('[Payout] vendor slice SKIPPED — declined (refund owned by decline flow)', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents,
      })
      result.skippedDeclined.push({ vendorId: p.vendorId, sliceCents: p.transferCents })
      continue
    }

    if (p.outcome === 'hold') {
      // Persist the hold so the reconciler can pay it once the vendor connects.
      await db.payoutHold.upsert({
        where: { orderId_vendorId: { orderId, vendorId: p.vendorId } },
        create: {
          eventId: order.eventId, orderId, vendorId: p.vendorId,
          amountCents: p.transferCents, reason: p.heldReason!, resolved: false,
        },
        update: { amountCents: p.transferCents, reason: p.heldReason! },
      })
      logger.warn('[Payout] vendor slice HELD (persisted, not transferred)', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.heldReason,
      })
      result.held.push({ vendorId: p.vendorId, sliceCents: p.transferCents, reason: p.heldReason! })
      continue
    }

    if (p.outcome === 'already_paid') {
      // Durable double-pay guard fired: this slice already has a confirmed transfer.
      // Skip Stripe entirely. WARN (not info) so a prevented double-pay is visible —
      // the interesting event on a manual re-run is precisely the transfer we DIDN'T send.
      logger.warn('[Payout] vendor slice ALREADY PAID — skipping transfer (durable double-pay guard)', {
        orderId, vendorId: p.vendorId, sliceCents: p.transferCents,
      })
      continue
    }

    const transfer = await transferOrTerminal(`vendor payout order ${orderId} vendor ${p.vendorId}`, () =>
      stripe.transfers.create(
        {
          amount: p.transferCents,
          currency: 'usd',
          destination: p.stripeAccountId!,
          source_transaction: chargeId,
          transfer_group: transferGroup,
          metadata: { orderId, vendorId: p.vendorId },
        },
        { idempotencyKey: `payout_${orderId}_${p.vendorId}` },
      ),
    )

    // Record/refresh the payout row, keyed by the (idempotent) transfer id.
    await db.payout.upsert({
      where: { stripeTransferId: transfer.id },
      create: {
        eventId: order.eventId,
        orderId,                              // ← reconciliation link
        vendorId: p.vendorId,
        grossAmount: p.subtotalCents / 100,   // vendor's subtotal slice
        fairSynqFee: p.feeShareCents / 100,   // Stripe fee share withheld from this transfer
        netAmount: p.transferCents / 100,     // amount actually transferred
        taxAmount: (p.taxCents ?? 0) / 100,   // B1.19: tax inside netAmount (gross + tax − fee = net)
        stripeTransferId: transfer.id,
        stripeStatus: 'pending',
        processedAt: new Date(),
      },
      update: {},
    })

    // If this vendor had a prior hold (paid now after connecting), resolve it.
    await db.payoutHold.updateMany({
      where: { orderId, vendorId: p.vendorId, resolved: false },
      data: { resolved: true, resolvedAt: new Date() },
    })

    // C1 — close out the ledger row with the AUTHORITATIVE numbers (the accrual only
    // ever held the provisional subtotal; the real fee share is known only now).
    // Conditional on not-already-paid, mirroring the runner executor's concurrency
    // guard. Invariant this establishes: status='paid' ⟺ stripeTransferId set.
    await db.vendorEarning.updateMany({
      where: { orderId, vendorId: p.vendorId, status: { not: 'paid' } },
      data: {
        status: 'paid',
        feeShareCents: p.feeShareCents,
        netCents: p.transferCents,
        taxCents: p.taxCents ?? 0, // B1.19
        stripeTransferId: transfer.id,
        paidAt: new Date(),
      },
    })

    result.transfers.push({ vendorId: p.vendorId, amountCents: p.transferCents, transferId: transfer.id })
  }

  logger.money('[Payout] order paid out', {
    orderId,
    stripeFeeCents,
    transfers: result.transfers.length,
    held: result.held.length,
    blocked: result.blocked.length,
    skippedDeclined: result.skippedDeclined.length,
  })
  return result
}
