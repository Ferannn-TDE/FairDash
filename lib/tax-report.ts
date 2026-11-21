// B1.19 — the per-vendor tax report: one row per vendor per event, built ONLY from stored records
// (OrderVendorTax for what was collected, COMPLETED Refund rows for what was returned). Never recomputed from rates.
//
// ONE RULE for every column:
//   - a sale counts when its payment succeeded: the order is paid (PAID_ORDER_STATUSES, so not PENDING_PAYMENT)
//     and in model (not voided). Dated by the order's placedAt.
//   - a refund is subtracted when it completed: Refund.status = COMPLETED, dated by when it completed (updatedAt).
// Optional from / to are Central (America/Chicago) calendar dates, both inclusive.
// Who sees what: admins every vendor at an event (route behind requireAdminFairContext); a vendor only its own row
// (route behind requireVendorMembershipById); organizers nothing (no route).
import type { PrismaClient } from '@prisma/client'
import { PAID_ORDER_STATUSES } from './order-status'
import { IN_MODEL_ORDERS } from './order-scope'

export interface TaxReportRow {
  vendorId: string
  vendorName: string
  orderCount: number
  taxableFoodCents: number
  salesTaxCollectedCents: number
  localTaxCollectedCents: number
  salesTaxRefundedCents: number
  localTaxRefundedCents: number
  netSalesTaxCents: number
  netLocalTaxCents: number
}
export interface TaxReport { rows: TaxReportRow[]; totals: Omit<TaxReportRow, 'vendorId' | 'vendorName'> }

type Db = Pick<PrismaClient, 'orderVendorTax' | 'refund' | 'vendor'>

/** A Central calendar date "YYYY-MM-DD" → the UTC instant its day starts (or the next day starts, for `to`). */
export function centralDayStart(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`date must be YYYY-MM-DD (got ${date})`)
  // The UTC offset Chicago has at noon that day (DST-safe; independent of the machine's own time zone), then
  // local midnight = 00:00Z + that offset. Chicago changes clocks at 2am, so noon's offset is the day's.
  const noonUtc = new Date(`${date}T12:00:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(noonUtc).map(p => [p.type, p.value]))
  const chicagoAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  const offsetMs = noonUtc.getTime() - chicagoAsUtc // 5 or 6 hours
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + offsetMs)
}
const nextDay = (date: string) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

export async function computeTaxReport(
  db: Db,
  opts: { eventId: string; vendorId?: string; from?: string; to?: string },
): Promise<TaxReport> {
  const range = (field: string) => (opts.from || opts.to)
    ? { [field]: { ...(opts.from ? { gte: centralDayStart(opts.from) } : {}), ...(opts.to ? { lt: centralDayStart(nextDay(opts.to)) } : {}) } }
    : {}

  const sales = await db.orderVendorTax.findMany({
    where: {
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
      order: { eventId: opts.eventId, status: { in: [...PAID_ORDER_STATUSES] }, ...IN_MODEL_ORDERS, ...range('placedAt') },
    },
    select: { vendorId: true, orderId: true, foodCents: true, salesTaxCents: true, localTaxCents: true },
  })
  const refunds = await db.refund.findMany({
    where: {
      eventId: opts.eventId, status: 'COMPLETED',
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
      OR: [{ salesTaxCents: { gt: 0 } }, { localTaxCents: { gt: 0 } }],
      ...range('updatedAt'),
    },
    select: { vendorId: true, salesTaxCents: true, localTaxCents: true },
  })

  const ids = [...new Set([...sales.map(s => s.vendorId), ...refunds.map(r => r.vendorId)])]
  const names = new Map((await db.vendor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(v => [v.id, v.name]))
  const blank = (vendorId: string): TaxReportRow => ({
    vendorId, vendorName: names.get(vendorId) ?? 'Vendor', orderCount: 0, taxableFoodCents: 0,
    salesTaxCollectedCents: 0, localTaxCollectedCents: 0, salesTaxRefundedCents: 0, localTaxRefundedCents: 0, netSalesTaxCents: 0, netLocalTaxCents: 0,
  })
  const byVendor = new Map<string, TaxReportRow>()
  const row = (id: string) => byVendor.get(id) ?? (byVendor.set(id, blank(id)), byVendor.get(id)!)
  for (const s of sales) {
    const r = row(s.vendorId)
    r.orderCount++; r.taxableFoodCents += s.foodCents; r.salesTaxCollectedCents += s.salesTaxCents; r.localTaxCollectedCents += s.localTaxCents
  }
  for (const f of refunds) { const r = row(f.vendorId); r.salesTaxRefundedCents += f.salesTaxCents; r.localTaxRefundedCents += f.localTaxCents }
  const rows = [...byVendor.values()].map(r => ({ ...r, netSalesTaxCents: r.salesTaxCollectedCents - r.salesTaxRefundedCents, netLocalTaxCents: r.localTaxCollectedCents - r.localTaxRefundedCents }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId.localeCompare(b.vendorId))

  const sum = (k: keyof Omit<TaxReportRow, 'vendorId' | 'vendorName'>) => rows.reduce((s, r) => s + r[k], 0)
  return {
    rows,
    totals: {
      orderCount: sum('orderCount'), taxableFoodCents: sum('taxableFoodCents'),
      salesTaxCollectedCents: sum('salesTaxCollectedCents'), localTaxCollectedCents: sum('localTaxCollectedCents'),
      salesTaxRefundedCents: sum('salesTaxRefundedCents'), localTaxRefundedCents: sum('localTaxRefundedCents'),
      netSalesTaxCents: sum('netSalesTaxCents'), netLocalTaxCents: sum('netLocalTaxCents'),
    },
  }
}

const usd = (c: number) => (c / 100).toFixed(2)
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export function taxReportCsv(report: TaxReport, withTotals = true): string {
  const head = ['Vendor', 'Orders', 'Taxable food sold', 'Sales tax collected', 'Local tax collected', 'Sales tax refunded', 'Local tax refunded', 'Net sales tax', 'Net local tax']
  const line = (name: string, r: Omit<TaxReportRow, 'vendorId' | 'vendorName'>) => [csvCell(name), String(r.orderCount), usd(r.taxableFoodCents), usd(r.salesTaxCollectedCents), usd(r.localTaxCollectedCents), usd(r.salesTaxRefundedCents), usd(r.localTaxRefundedCents), usd(r.netSalesTaxCents), usd(r.netLocalTaxCents)].join(',')
  return [head.join(','), ...report.rows.map(r => line(r.vendorName, r)), ...(withTotals ? [line('TOTAL', report.totals)] : [])].join('\n') + '\n'
}
