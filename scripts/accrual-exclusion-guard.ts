/**
 * Accrual payable-set exclusion — no phantom earnings for refunded portions.
 *
 * THE BUG: accrueVendorEarnings accrued EVERY item-vendor, including DECLINED/REFUNDED/
 * CANCELLED portions — and reconciler Pattern S used its own copy of the same naive set.
 * Result: phantom 'accrued' VendorEarning rows for money nobody is owed (8 rows, $200.00,
 * written to the live ledger on 2026-07-17 by the executor's self-heal + a Pattern S sweep).
 * No wrong transfer — the executor skips refunded at PAY time — but the admin panel's
 * payableCents inflated with phantom obligations.
 *
 * THE FIX: ONE payable definition (payableVendorIds in lib/process-payout), used by BOTH
 * the accrual and Pattern S's detection. This guard: truth table, a real DB round-trip with
 * a refunded-portion NEGATIVE control and a real-gap POSITIVE control (so the negative can't
 * pass vacuously), the worker gate, and the both-sites-share-it assertion.
 *
 * Run:  npx tsx scripts/accrual-exclusion-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, OrderStatus } from '@prisma/client'
import { payableVendorIds, accrueVendorEarnings, NON_PAYABLE_VENDOR_STATUSES } from '../lib/process-payout'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'accx-', MAIL = '@accx.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.vendorEarning.deleteMany(w)
    await prisma.vendorOrderStatus.deleteMany({ where: { order: { eventId: { in: ids } } } })
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  try {
    // ── [0] the pure truth table ────────────────────────────────────────────────
    console.log('\n[0] payableVendorIds truth table')
    const items = [{ vendorId: 'A' }, { vendorId: 'B' }, { vendorId: 'C' }]
    const vos = [
      { vendorId: 'A', status: 'COMPLETED' },
      { vendorId: 'B', status: 'REFUNDED' },
      { vendorId: 'C', status: 'DECLINED' },
    ]
    const payable = payableVendorIds(items, vos)
    assert(payable.has('A'), 'COMPLETED portion → payable')
    assert(!payable.has('B'), '⛔ REFUNDED portion → NOT payable')
    assert(!payable.has('C'), '⛔ DECLINED portion → NOT payable')
    assert(payableVendorIds(items, []).size === 3, 'no VOS rows → all payable (legacy orders keep accruing)')
    assert(NON_PAYABLE_VENDOR_STATUSES.has('CANCELLED'), 'CANCELLED is in the exclusion set')

    // ── seed: one order, vendor P portion COMPLETED (real gap), vendor R portion REFUNDED ─
    const ev = await prisma.event.create({ data: { name: `ACCX ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkV = async () => prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const vP = await mkV(), vR = await mkV()
    const miP = await prisma.menuItem.create({ data: { vendorId: vP.id, name: 'P', price: 10, category: 'T' } })
    const miR = await prisma.menuItem.create({ data: { vendorId: vR.id, name: 'R', price: 20, category: 'T' } })
    const cu = await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c${MAIL}`, name: 'C', role: 'customer' } })
    const o = await prisma.order.create({ data: {
      eventId: ev.id, customerId: cu.id, vendorId: vP.id, status: OrderStatus.COMPLETED, fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
      placedAt: new Date(), completedAt: new Date(),
      orderItems: { create: [
        { vendorId: vP.id, menuItemId: miP.id, itemName: 'P', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 },
        { vendorId: vR.id, menuItemId: miR.id, itemName: 'R', quantity: 1, unitPrice: 20, totalPrice: 20, subtotal: 20 },
      ] },
      vendorOrderStatuses: { create: [
        { vendorId: vP.id, status: 'COMPLETED' },
        { vendorId: vR.id, status: 'REFUNDED' },
      ] },
    } })

    // ── [1] the accrual: positive AND negative control on ONE order ─────────────
    console.log('\n[1] accrueVendorEarnings on a half-refunded order')
    const n = await accrueVendorEarnings(o.id)
    const rows = await prisma.vendorEarning.findMany({ where: { orderId: o.id }, select: { vendorId: true, subtotalCents: true, status: true } })
    assert(n === 1, `returns 1 accrual (got ${n}) — only the payable portion`)
    assert(rows.some(r => r.vendorId === vP.id && r.subtotalCents === 1000 && r.status === 'accrued'),
      'POSITIVE control: the COMPLETED portion accrued (1000¢) — the probe can produce a row')
    assert(!rows.some(r => r.vendorId === vR.id),
      '⛔ NEGATIVE control: the REFUNDED portion produced NO row — no phantom payable')

    // ── [2] idempotent + doesn't resurrect: re-run adds nothing new ─────────────
    console.log('\n[2] re-accrual is idempotent and never creates the excluded row')
    await accrueVendorEarnings(o.id)
    const rows2 = await prisma.vendorEarning.count({ where: { orderId: o.id } })
    assert(rows2 === 1, `still exactly 1 earning row after re-accrual (got ${rows2})`)

    // ── [3] Pattern S shares the definition; worker is gated ────────────────────
    console.log('\n[3] structural: S imports the shared payable set; the worker refuses without WORKER_ENABLED')
    const { readFileSync } = await import('node:fs')
    const rec = readFileSync('lib/reconciler.ts', 'utf8')
    assert(rec.includes('payableVendorIds'), 'reconciler Pattern S uses payableVendorIds (not a hand-rolled copy)')
    assert(readFileSync('workers/index.ts', 'utf8').includes("WORKER_ENABLED !== 'true'"),
      'workers/index.ts gates startup on WORKER_ENABLED=true')
    // dryRun counter consistency (S counts like A–C)
    assert(/if \(o\.dryRun\) \{ sum\.repaired\.S \+= 1; continue \}/.test(rec),
      'Pattern S increments repaired.S in dryRun (counter consistent with A–C)')

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
