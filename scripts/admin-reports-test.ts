/**
 * Admin fair reports — the money model, proven from real ledger rows.
 *
 * Seeds a fair with every case that trips up a report and asserts the computed figures:
 *   • a VOIDED order (must be excluded entirely — the dashboard filter)
 *   • a CANCELLED order (excluded from revenue, counted in cancelledOrders)
 *   • a COMPLETED order with a real Payout → vendor SETTLED take-home
 *   • a COMPLETED order with no payout → vendor ESTIMATED take-home (slice − est. fee)
 *   • a COMPLETED order with a refund → refunds / net
 *   • runner + organizer earnings in paid / owed / cancelled states
 *
 * The five rules the report must honour (from the build spec):
 *   1. every figure traces to a ledger row (asserted against hand-computed sums)
 *   2. settled and estimated are DISTINCT, never summed
 *   3. take-home ≠ gross (a vendor's take-home is their slice minus the Stripe fee)
 *   4. gross AGREES with the dashboard (same voidedAt/CANCELLED filter — computed both ways)
 *   5. voided/cancelled handled exactly as the dashboard does
 *
 * Run:  npx tsx scripts/admin-reports-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { PrismaClient, OrderStatus } from '@prisma/client'
import { computeFairReport } from '../lib/admin-fair-reports'
import { estimateStripeFeeCents } from '../lib/vendor-earnings'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const PFX = 'reptest-'
const MAIL = '@reptest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.payout.deleteMany(w)
    await prisma.refund.deleteMany(w)
    await prisma.runnerEarning.deleteMany(w)
    await prisma.organizerEarning.deleteMany(w)
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.runner.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const mkUser = (role: string) =>
  prisma.user.create({ data: { clerkId: `${PFX}${rand()}`, email: `${PFX}${role}-${rand()}${MAIL}`, name: role, role } })

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({
      data: { name: 'Report Fair', urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' },
    })
    const mkVendor = async (name: string) => {
      const v = await prisma.vendor.create({ data: { eventId: ev.id, name, slug: `${PFX}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
      const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price: 10, category: 'T' } })
      return { v, mi }
    }
    const { v: vA, mi: miA } = await mkVendor('Vendor A')
    const { v: vB, mi: miB } = await mkVendor('Vendor B')

    // helper to make one single-vendor order
    const mkOrder = async (vendor: string, mi: string, opts: { status: OrderStatus; total: number; fee: number; subtotal: number; voided?: boolean; accepted?: Date; ready?: Date }) => {
      const cust = await mkUser('customer')
      const o = await prisma.order.create({
        data: {
          eventId: ev.id, customerId: cust.id, vendorId: vendor,
          status: opts.status, fulfillmentType: 'BOOTH_PICKUP',
          subtotal: opts.subtotal, fairSynqFee: opts.fee, total: opts.total, vendorPayout: opts.subtotal,
          customerName: 'C', customerPhone: '+10000000000',
          ...(opts.voided ? { voidedAt: new Date() } : {}),
          orderItems: { create: [{ vendorId: vendor, menuItemId: mi, itemName: 'Item', quantity: 1, unitPrice: opts.subtotal, totalPrice: opts.subtotal, subtotal: opts.subtotal }] },
          vendorOrderStatuses: { create: [{ vendorId: vendor, status: opts.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED', acceptedAt: opts.accepted ?? null, readyAt: opts.ready ?? null }] },
        },
      })
      return o
    }

    // O1: completed, vendorA, SETTLED (real payout). subtotal 10, total 11, fee(FairSynq) 1.
    const base = new Date()
    const o1 = await mkOrder(vA.id, miA.id, { status: 'COMPLETED', total: 11, fee: 1, subtotal: 10, accepted: new Date(base.getTime() - 12 * 60000), ready: base })
    await prisma.payout.create({ data: { eventId: ev.id, orderId: o1.id, vendorId: vA.id, grossAmount: 10, fairSynqFee: 0.25, netAmount: 9.75, stripeTransferId: `tr_${rand()}`, stripeStatus: 'paid', processedAt: new Date() } })

    // O2: completed, vendorB, ESTIMATED (no payout). subtotal 10, total 11, fee 1.
    await mkOrder(vB.id, miB.id, { status: 'COMPLETED', total: 11, fee: 1, subtotal: 10 })

    // O3: CANCELLED, vendorA — excluded from revenue, counted cancelled.
    await mkOrder(vA.id, miA.id, { status: 'CANCELLED', total: 11, fee: 1, subtotal: 10 })

    // O4: completed, vendorA, with a COMPLETED refund of $5.
    const o4 = await mkOrder(vA.id, miA.id, { status: 'COMPLETED', total: 11, fee: 1, subtotal: 10 })
    await prisma.refund.create({ data: { eventId: ev.id, orderId: o4.id, vendorId: vA.id, amountCents: 500, status: 'COMPLETED' } })

    // O5: VOIDED — must be excluded entirely (huge total to make a leak obvious).
    await mkOrder(vA.id, miA.id, { status: 'COMPLETED', total: 99, fee: 9, subtotal: 90, voided: true })

    // Runner earnings: paid 300, tracked 200 (owed), cancelled 999 (excluded).
    const run = await prisma.runner.create({ data: { userId: (await mkUser('runner')).id, eventId: ev.id, status: 'ACTIVE' } })
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: o1.id, runnerId: run.id, amountCents: 300, status: 'paid' } })
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: o4.id, runnerId: run.id, amountCents: 200, status: 'tracked' } })
    const o3b = await mkOrder(vB.id, miB.id, { status: 'COMPLETED', total: 11, fee: 1, subtotal: 10 })
    await prisma.runnerEarning.create({ data: { eventId: ev.id, orderId: o3b.id, runnerId: run.id, amountCents: 999, status: 'cancelled' } })

    // Organizer earnings: paid 150, accrued 100 (owed), cancelled 999 (excluded).
    await prisma.organizerEarning.create({ data: { eventId: ev.id, orderId: o1.id, amountCents: 150, source: 'delivery_fee_share', status: 'paid' } })
    await prisma.organizerEarning.create({ data: { eventId: ev.id, orderId: o4.id, amountCents: 100, source: 'delivery_fee_share', status: 'accrued' } })
    await prisma.organizerEarning.create({ data: { eventId: ev.id, orderId: o3b.id, amountCents: 999, source: 'delivery_fee_share', status: 'cancelled' } })

    // ── COMPUTE ────────────────────────────────────────────────────────────────
    const r = await computeFairReport(ev.id)

    // Non-cancelled non-void orders contributing to gross: O1, O2, O4, O3b = 4 orders × $11 = $44.
    console.log('\n[1] gross/net/fee/counts trace to the order rows (voided excluded, cancelled out of revenue)')
    assert(r.grossSalesCents === 4400, `gross = $44.00 (O1+O2+O4+O3b; got ${r.grossSalesCents})`)
    assert(r.platformFeeCents === 400, `platform fee = $4.00 (4 × $1; got ${r.platformFeeCents})`)
    assert(r.refundsCents === 500, `refunds = $5.00 (got ${r.refundsCents})`)
    assert(r.netSalesCents === 3900, `net = gross − refunds = $39.00 (got ${r.netSalesCents})`)
    assert(r.cancelledOrders === 1, `1 cancelled order counted (got ${r.cancelledOrders})`)
    assert(r.totalOrders === 5, `5 non-void orders (O5 voided excluded; got ${r.totalOrders})`)
    assert(r.refundedOrders === 1, `1 refunded order (got ${r.refundedOrders})`)

    console.log('\n[5] ⛔ the VOIDED order ($99) leaked into NOTHING')
    assert(r.grossSalesCents < 9900, 'the $99 voided order is not in gross')
    assert(!r.vendors.some(v => v.grossSliceCents >= 9000), 'no vendor row carries the voided $90 slice')

    // ── [4] ⛔ AGREES WITH THE DASHBOARD ───────────────────────────────────────
    console.log('\n[4] ⛔ gross AGREES with the dashboard formula (same filter, computed independently)')
    const dash = await prisma.order.aggregate({
      where: { eventId: ev.id, voidedAt: null, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true, fairSynqFee: true },
    })
    const dashGrossCents = Math.round((dash._sum.total ?? 0) * 100)
    const dashFeeCents = Math.round((dash._sum.fairSynqFee ?? 0) * 100)
    assert(r.grossSalesCents === dashGrossCents, `report gross (${r.grossSalesCents}) === dashboard gross (${dashGrossCents})`)
    assert(r.platformFeeCents === dashFeeCents, `report fee (${r.platformFeeCents}) === dashboard fee (${dashFeeCents})`)

    // ── [2]/[3] take-home: settled ≠ estimated, and neither is the gross slice ──
    console.log('\n[2]/[3] take-home: settled vs estimated distinct, and take-home ≠ gross')
    assert(r.vendorTakeHome.settledCents === 975, `vendor SETTLED = $9.75 (O1 payout; got ${r.vendorTakeHome.settledCents})`)
    // vendorB has TWO estimated orders (O2 + O3b), each slice 1000 − est fee on the $11 total.
    const oneEst = 1000 - estimateStripeFeeCents(1100)
    const expEst = 2 * oneEst
    assert(r.vendorTakeHome.estimatedCents === expEst, `vendor ESTIMATED = 2 × (slice − est fee) = ${expEst} (got ${r.vendorTakeHome.estimatedCents})`)
    assert(r.vendorTakeHome.settledCents !== r.vendorTakeHome.estimatedCents, 'settled and estimated are DISTINCT numbers')
    assert(oneEst < 1000, '⛔ per-order estimated take-home ($' + (oneEst/100).toFixed(2) + ') is LESS than the gross slice ($10.00) — take-home ≠ gross')

    console.log('\n[2b] runner / organizer take-home: paid=settled, owed=estimated, cancelled excluded')
    assert(r.runnerTakeHome.settledCents === 300 && r.runnerTakeHome.estimatedCents === 200, `runner settled 300 / est 200 (got ${r.runnerTakeHome.settledCents}/${r.runnerTakeHome.estimatedCents})`)
    assert(r.organizerTakeHome.settledCents === 150 && r.organizerTakeHome.estimatedCents === 100, `organizer settled 150 / est 100 (got ${r.organizerTakeHome.settledCents}/${r.organizerTakeHome.estimatedCents})`)
    assert(r.runnerTakeHome.settledCents + r.runnerTakeHome.estimatedCents === 500, 'the cancelled 999 is in NEITHER runner bucket')

    console.log('\n[6] the PAGE renders verbatim — no mock, no blending, only ÷100 math')
    const page = readFileSync('app/admin/[eventSlug]/reports/page.tsx', 'utf8')
    const noComments = page.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!/mock\/admin|mockAdmin/.test(noComments), 'no mock import')
    assert(!/settledCents\s*\+\s*\w*[eE]stimated|estimatedCents\s*\+\s*\w*[sS]ettled/.test(noComments),
      '⛔ the page never SUMS settled + estimated (they stay distinct on screen)')
    const centsMath = noComments.match(/Cents\s*[+\-*]\s*\w|\w+\s*[+\-*]\s*\w*Cents/g) ?? []
    assert(centsMath.length === 0, `no arithmetic on *Cents in the page (found ${centsMath.length}) — figures are rendered verbatim`)
    assert(/\/ 100\)/.test(page), 'the only money math is the ÷100 display formatter')

    console.log(`\n${'─'.repeat(64)}`)
    if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
    else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
