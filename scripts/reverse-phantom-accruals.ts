/**
 * ONE-TIME REMEDIATION (already run 2026-07-17) — cancel the 8 phantom VendorEarning accruals.
 *
 * ⚠️ THIS ALREADY RAN against the production DB. It is committed as the RECEIPT for a real
 * ledger change, not as pending work. Re-running is safe: the 8 rows are now 'cancelled', so
 * the pre-flight skips them and the script reports "already remediated". The broader residual
 * (148 more of the same class) is deliberately NOT handled here — the reconciler Pattern-T
 * backstop cleans those as the reconciler (honest actor), superseding this one-off approach.
 *
 * WHAT HAPPENED: before the payableVendorIds fix (f3c4092), accrueVendorEarnings + reconciler
 * Pattern S accrued REFUNDED portions, writing 8 phantom 'accrued' rows ($200.00) into Italian
 * Fest 2026's ledger during the ungated Railway-worker + executor-self-heal window. No wrong
 * transfer (the executor skips refunded at pay time); this corrected the ledger VIEW.
 *
 * EVIDENCE (from the run): payableCents 408000¢ → 388000¢ (−20000¢ exact),
 * cancelledCents 0 → 20000¢, sum-of-cancels 20000¢ — all three positive controls green.
 * Each cancel wrote an AdminMoneyAction (admin actor = the operator's clerkId, reason below).
 *
 * MECHANISM: the ledger's own CANCEL (lib/admin-money.setOrderPayoutState) — accrued →
 * 'cancelled' + an audited row. NOT a raw delete. The cancellation is the admin's deliberate
 * act ("this isn't the payee's money"); the bug is the reason, recorded verbatim.
 *
 * Run:  npx tsx scripts/reverse-phantom-accruals.ts   (now a no-op — kept as the receipt)
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { setOrderPayoutState } from '../lib/admin-money'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const EVENT_ID = 'cmni6x63n000011znjwlln5k2' // Italian Fest 2026
const ADMIN_CLERK_ID = 'user_39m7spARw5zY75ifTyKeO7WfdVT' // feranmidyro@gmail.com — the acting admin
const REASON = 'phantom accrual for refunded portion — pre-payableVendorIds fix, see f3c4092'

const TARGETS: { orderSuffix: string; vendorSuffix: string; cents: number }[] = [
  { orderSuffix: 'i3m6c2kq', vendorSuffix: 'pw0076', cents: 4000 },
  { orderSuffix: 'wrcat9nn', vendorSuffix: '5c5hhp', cents: 2000 },
  { orderSuffix: 'eymzsbtp', vendorSuffix: 'pw0076', cents: 1500 },
  { orderSuffix: 'eymzsbtp', vendorSuffix: '5c5hhp', cents: 2500 },
  { orderSuffix: 'x03uqeaq', vendorSuffix: 'pw0076', cents: 4000 },
  { orderSuffix: 'uzjln868', vendorSuffix: '5c5hhp', cents: 2000 },
  { orderSuffix: 'etcj29it', vendorSuffix: 'pw0076', cents: 1500 },
  { orderSuffix: 'etcj29it', vendorSuffix: '5c5hhp', cents: 2500 },
]
const EXPECTED_TOTAL = 20000

async function eventTotals() {
  const rows = await prisma.vendorEarning.findMany({ where: { eventId: EVENT_ID }, select: { subtotalCents: true, status: true } })
  const sum = (st: string) => rows.filter(r => r.status === st).reduce((s, r) => s + r.subtotalCents, 0)
  return { payableCents: sum('accrued'), cancelledCents: sum('cancelled') }
}

async function main() {
  type Resolved = { orderId: string; vendorId: string; cents: number; skip: boolean }
  const resolved: Resolved[] = []
  const problems: string[] = []
  for (const t of TARGETS) {
    const order = await prisma.order.findFirst({ where: { id: { endsWith: t.orderSuffix }, eventId: EVENT_ID }, select: { id: true, vendorOrderStatuses: { select: { vendorId: true, status: true } } } })
    if (!order) { problems.push(`#${t.orderSuffix} not found`); continue }
    const vendorId = order.vendorOrderStatuses.find(v => v.vendorId.endsWith(t.vendorSuffix))?.vendorId
    if (!vendorId) { problems.push(`#${t.orderSuffix}: vendor …${t.vendorSuffix} not on order`); continue }
    const vos = order.vendorOrderStatuses.find(v => v.vendorId === vendorId)?.status
    const earning = await prisma.vendorEarning.findFirst({ where: { orderId: order.id, vendorId, eventId: EVENT_ID }, select: { status: true, subtotalCents: true } })
    if (!earning) { problems.push(`#${t.orderSuffix}/${t.vendorSuffix}: no VendorEarning`); continue }
    if (earning.status === 'cancelled') { resolved.push({ orderId: order.id, vendorId, cents: earning.subtotalCents, skip: true }); continue }
    if (earning.status !== 'accrued') problems.push(`#${t.orderSuffix}/${t.vendorSuffix}: status '${earning.status}' ≠ 'accrued' — REFUSING`)
    if (vos !== 'REFUNDED') problems.push(`#${t.orderSuffix}/${t.vendorSuffix}: VOS '${vos}' ≠ 'REFUNDED' — REFUSING`)
    if (earning.subtotalCents !== t.cents) problems.push(`#${t.orderSuffix}/${t.vendorSuffix}: ${earning.subtotalCents}¢ ≠ ${t.cents}¢ — REFUSING`)
    resolved.push({ orderId: order.id, vendorId, cents: earning.subtotalCents, skip: false })
  }

  if (problems.length) { console.error('\n🛑 PRE-FLIGHT FAILED — nothing touched:'); for (const p of problems) console.error('   • ' + p); process.exit(1) }

  const toCancel = resolved.filter(r => !r.skip)
  console.log(`Pre-flight OK. ${toCancel.length} to cancel, ${resolved.length - toCancel.length} already cancelled.`)
  if (toCancel.length === 0) { console.log('✅ Already remediated — no-op (this is the expected state post-run).'); return }

  const before = await eventTotals()
  console.log(`\nBEFORE: payableCents=${before.payableCents}¢  cancelledCents=${before.cancelledCents}¢`)
  const ctx = { adminClerkId: ADMIN_CLERK_ID, eventId: EVENT_ID }
  let cancelledSum = 0
  for (const r of toCancel) {
    const res = await setOrderPayoutState(ctx, { payeeType: 'vendor', orderId: r.orderId, vendorId: r.vendorId, action: 'CANCEL', reason: REASON })
    cancelledSum += res.amountCents ?? 0
    console.log(`   CANCEL #${r.orderId.slice(-8).toUpperCase()} v=${r.vendorId.slice(-6)} ${res.amountCents}¢  ${res.previousStatus}→${res.newStatus}`)
  }
  const after = await eventTotals()
  const payableDrop = before.payableCents - after.payableCents
  const cancelledRise = after.cancelledCents - before.cancelledCents
  console.log(`\nAFTER:  payableCents=${after.payableCents}¢  cancelledCents=${after.cancelledCents}¢`)
  const ok = payableDrop === EXPECTED_TOTAL && cancelledRise === EXPECTED_TOTAL && cancelledSum === EXPECTED_TOTAL
  console.log(`POSITIVE CONTROL: payable −${payableDrop}¢ / cancelled +${cancelledRise}¢ / sum ${cancelledSum}¢ (expect ${EXPECTED_TOTAL}) ${ok ? '✅' : '❌'}`)
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) }).finally(() => prisma.$disconnect())
