import { OrderStatus } from '@prisma/client'
import { db } from './db'
import { sumVendorEarnings } from './vendor-earnings'

/**
 * Fair financial report — computed SERVER-SIDE, ONCE, entirely from the ledgers. The page
 * renders these numbers verbatim; it does NO money arithmetic of its own. A dashboard that
 * does its own math eventually disagrees with the ledger — so all the math is here.
 *
 * WHOSE MONEY, AT WHAT STAGE — every figure is labelled by that in the type below:
 *   grossSalesCents   = what CUSTOMERS paid (GMV). The same figure the admin dashboard shows
 *                       (Σ order.total, voidedAt null, status != CANCELLED) — reports and
 *                       dashboard MUST agree, so this uses the identical filter.
 *   refundsCents      = money returned to customers (Σ COMPLETED Refund).
 *   netSalesCents     = grossSales − refunds (what actually netted after refunds).
 *   platformFeeCents  = FAIRSYNQ's revenue — the clean 10% (Σ order.fairSynqFee). Never
 *                       refunded, so not reduced by refunds.
 *   payee take-home   = what each PAYEE keeps, NOT the order gross. SETTLED (real transfer)
 *                       and ESTIMATED (accrued, not yet paid) are kept DISTINCT — an
 *                       estimate must never read as cash in hand.
 *
 * SOURCES (each figure traces to real rows):
 *   gross / fee / counts → Order rows (dashboard filters).
 *   refunds              → Refund rows (COMPLETED).
 *   vendor take-home     → sumVendorEarnings (the proven helper: Payout row = settled, else a
 *                          conservative fee-split estimate). Vendors absorb the Stripe fee,
 *                          so their take-home ≠ their gross slice — the whole gross-vs-take-
 *                          home point.
 *   runner/organizer     → their Earning tables. amountCents IS take-home (no per-order fee
 *                          split — the fee was already absorbed by vendors). paid = settled;
 *                          owed-not-yet-paid (tracked/accrued/held) = estimated; cancelled
 *                          excluded.
 */

const cents = (n: number) => Math.round(n * 100)
const COMPLETE = [OrderStatus.COMPLETED, OrderStatus.DELIVERED]

export interface PayeeTakeHome {
  settledCents: number    // actually transferred
  estimatedCents: number  // accrued / owed, not yet paid — NEVER blended with settled
}

export interface VendorReportRow {
  vendorId: string
  name: string
  orders: number
  grossSliceCents: number      // their share of what customers paid (their "sales")
  settledCents: number         // take-home already transferred
  estimatedCents: number       // take-home accrued, not yet paid
  refundedCents: number
  avgPrepMinutes: number | null
}

export interface FairReport {
  // ── Sales (customer money) ──
  grossSalesCents: number
  refundsCents: number
  netSalesCents: number
  platformFeeCents: number
  // ── Order counts ──
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  refundedOrders: number
  avgOrderValueCents: number
  // ── Payee take-home (settled vs estimated, per payee) ──
  vendorTakeHome: PayeeTakeHome
  runnerTakeHome: PayeeTakeHome
  organizerTakeHome: PayeeTakeHome
  // ── Per-vendor breakdown ──
  vendors: VendorReportRow[]
}

export async function computeFairReport(eventId: string): Promise<FairReport> {
  const [orders, vendors, runnerEarnings, organizerEarnings, refundRows] = await Promise.all([
    // voidedAt: null on EVERY aggregate — voided test-junk must not inflate the numbers, and
    // this mirrors the dashboard/reconciler/payout filters so the screens can't disagree.
    db.order.findMany({
      where: { eventId, voidedAt: null },
      select: {
        id: true, total: true, fairSynqFee: true, status: true,
        orderItems: { select: { vendorId: true, subtotal: true } },
        payouts: { select: { vendorId: true, netAmount: true, reversedAt: true } },
        refunds: { select: { vendorId: true, status: true, amountCents: true } },
        vendorOrderStatuses: { select: { vendorId: true, status: true, acceptedAt: true, readyAt: true } },
      },
    }),
    db.vendor.findMany({ where: { eventId }, select: { id: true, name: true } }),
    db.runnerEarning.findMany({ where: { eventId }, select: { amountCents: true, status: true } }),
    db.organizerEarning.findMany({ where: { eventId }, select: { amountCents: true, status: true } }),
    db.refund.findMany({ where: { eventId, status: 'COMPLETED' }, select: { orderId: true, amountCents: true } }),
  ])

  // ── Sales & counts (Order rows; revenue excludes CANCELLED, matching the dashboard) ──
  let grossSalesCents = 0, platformFeeCents = 0
  let totalOrders = 0, completedOrders = 0, cancelledOrders = 0
  for (const o of orders) {
    totalOrders++
    if (o.status === OrderStatus.CANCELLED) { cancelledOrders++; continue }
    grossSalesCents += cents(o.total)
    platformFeeCents += cents(o.fairSynqFee)
    if ((COMPLETE as string[]).includes(o.status)) completedOrders++
  }
  const refundsCents = refundRows.reduce((s, r) => s + r.amountCents, 0)
  const refundedOrders = new Set(refundRows.map(r => r.orderId)).size
  const netSalesCents = grossSalesCents - refundsCents
  const avgOrderValueCents = totalOrders > 0 ? Math.round(grossSalesCents / totalOrders) : 0

  // ── Vendor take-home — the proven helper, per vendor. Settled ≠ estimated, and both ≠
  //    the vendor's gross slice (they absorb the Stripe fee).
  //    CANCELLED orders are excluded here just as they are from revenue: a cancelled order
  //    has no take-home for anyone. (computeVendorOrderEarnings only zeroes DECLINED, not
  //    CANCELLED, so a cancelled order left in this set would wrongly count as estimated.) ──
  const revenueOrders = orders.filter(o => o.status !== OrderStatus.CANCELLED)
  const ordersForEarnings = revenueOrders.map(o => ({
    total: o.total,
    orderItems: o.orderItems,
    payouts: o.payouts,
    refunds: o.refunds,
    vendorOrderStatuses: o.vendorOrderStatuses.map(v => ({ vendorId: v.vendorId, status: v.status })),
  }))

  const vendorRows: VendorReportRow[] = vendors.map(v => {
    const sum = sumVendorEarnings(ordersForEarnings, v.id)
    // gross slice + order count + prep time from the non-cancelled order rows (so a vendor's
    // "sales" line up with the fair-level gross, which also excludes cancelled).
    let grossSliceCents = 0, orderCount = 0
    const preps: number[] = []
    for (const o of revenueOrders) {
      const mine = o.orderItems.filter(i => i.vendorId === v.id)
      if (mine.length === 0) continue
      orderCount++
      grossSliceCents += mine.reduce((s, i) => s + cents(i.subtotal), 0)
      const vos = o.vendorOrderStatuses.find(s => s.vendorId === v.id)
      if (vos?.acceptedAt && vos?.readyAt) {
        const mins = (vos.readyAt.getTime() - vos.acceptedAt.getTime()) / 60000
        if (mins >= 0) preps.push(mins)
      }
    }
    return {
      vendorId: v.id, name: v.name, orders: orderCount, grossSliceCents,
      settledCents: sum.settledCents, estimatedCents: sum.estimatedCents,
      refundedCents: sum.refundedCents,
      avgPrepMinutes: preps.length ? Math.round(preps.reduce((a, b) => a + b, 0) / preps.length) : null,
    }
  })

  const vendorTakeHome: PayeeTakeHome = {
    settledCents: vendorRows.reduce((s, r) => s + r.settledCents, 0),
    estimatedCents: vendorRows.reduce((s, r) => s + r.estimatedCents, 0),
  }

  // ── Runner / organizer take-home — amountCents IS take-home; paid=settled, owed=estimated,
  //    cancelled excluded. ──
  const payeeSum = (rows: { amountCents: number; status: string }[], settledStatus: string, estimatedStatuses: string[]): PayeeTakeHome => ({
    settledCents: rows.filter(r => r.status === settledStatus).reduce((s, r) => s + r.amountCents, 0),
    estimatedCents: rows.filter(r => estimatedStatuses.includes(r.status)).reduce((s, r) => s + r.amountCents, 0),
  })
  const runnerTakeHome = payeeSum(runnerEarnings, 'paid', ['tracked', 'held'])
  const organizerTakeHome = payeeSum(organizerEarnings, 'paid', ['accrued', 'held'])

  return {
    grossSalesCents, refundsCents, netSalesCents, platformFeeCents,
    totalOrders, completedOrders, cancelledOrders, refundedOrders, avgOrderValueCents,
    vendorTakeHome, runnerTakeHome, organizerTakeHome,
    vendors: vendorRows.sort((a, b) => b.grossSliceCents - a.grossSliceCents),
  }
}
