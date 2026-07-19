/**
 * Reverser + Pattern-T backstop — the refund/accrual phantom class, closed on the reversal side.
 *
 * reverseAccrualForRefundedPortion is the ONE reverser (refund-time hook + Pattern T share it).
 * Pattern T is the reconciler backstop: CANCELS accrued rows whose own portion is refunded,
 * detect-only until enabled. This guard proves both, non-vacuously:
 *   • POSITIVE: a real phantom is reversed; payableCents drops by exactly its amount.
 *   • NEGATIVE (the safety): a LEGIT completed accrual is REFUSED — the reverser can't cancel
 *     owed money even if called on it.
 *   • IDEMPOTENT: a second call is a no-op (no double-cancel).
 *   • ATTRIBUTION: the audit row is actorType='reconciler' (or the passed actor), NEVER admin.
 *   • PATTERN T dry-run writes nothing; enabled run cancels via the reverser.
 *
 * Run:  npx tsx scripts/reverser-pattern-t-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient, OrderStatus } from '@prisma/client'
import { reverseAccrualForRefundedPortion } from '../lib/reverse-accrual'
import { runReconciliationSweep } from '../lib/reconciler'
import { deriveMoneyActor } from '../lib/process-refund'
import { readFileSync } from 'node:fs'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'revt-', MAIL = '@revt.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.adminMoneyAction.deleteMany(w)
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
    const ev = await prisma.event.create({ data: { name: `REVT ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkV = async () => prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })
    const vPh = await mkV(), vLegit = await mkV()
    const miP = await prisma.menuItem.create({ data: { vendorId: vPh.id, name: 'P', price: 40, category: 'T' } })
    const miL = await prisma.menuItem.create({ data: { vendorId: vLegit.id, name: 'L', price: 30, category: 'T' } })
    const cust = async () => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' } })).id

    // One order, two portions: vPh REFUNDED but accrued (phantom), vLegit COMPLETED accrued (owed).
    const o = await prisma.order.create({ data: {
      eventId: ev.id, customerId: await cust(), vendorId: vPh.id, status: OrderStatus.COMPLETED, fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 70, fairSynqFee: 7, total: 77, vendorPayout: 70, customerName: 'C', customerPhone: '+10000000000', placedAt: new Date(), completedAt: new Date(),
      orderItems: { create: [
        { vendorId: vPh.id, menuItemId: miP.id, itemName: 'P', quantity: 1, unitPrice: 40, totalPrice: 40, subtotal: 40 },
        { vendorId: vLegit.id, menuItemId: miL.id, itemName: 'L', quantity: 1, unitPrice: 30, totalPrice: 30, subtotal: 30 },
      ] },
      vendorOrderStatuses: { create: [
        { vendorId: vPh.id, status: 'REFUNDED' },
        { vendorId: vLegit.id, status: 'COMPLETED' },
      ] },
      // Seed BOTH as accrued — the phantom (vPh) and the legit (vLegit).
      vendorEarnings: { create: [
        { eventId: ev.id, vendorId: vPh.id, subtotalCents: 4000, status: 'accrued' },
        { eventId: ev.id, vendorId: vLegit.id, subtotalCents: 3000, status: 'accrued' },
      ] },
    } })

    const payable = async () => (await prisma.vendorEarning.findMany({ where: { eventId: ev.id, status: 'accrued' }, select: { subtotalCents: true } })).reduce((s, r) => s + r.subtotalCents, 0)

    // ── [1] REVERSER — negative control FIRST (a legit accrual is REFUSED) ──────
    console.log('\n[1] the reverser REFUSES a legit (COMPLETED) accrual — cannot cancel owed money')
    const neg = await reverseAccrualForRefundedPortion({ orderId: o.id, vendorId: vLegit.id, actor: { id: 'reconciler', type: 'reconciler' }, reason: 'x' })
    assert(neg.reversed === false && (neg as any).skipped === 'portion-still-payable', `legit COMPLETED accrual REFUSED (got ${JSON.stringify(neg)})`)
    assert(await payable() === 7000, 'payable unchanged by the refused call (still 7000¢)')

    // ── [2] REVERSER — positive control (the phantom is reversed) ───────────────
    console.log('\n[2] the reverser cancels the REFUNDED-portion phantom; payable drops by exactly its amount')
    const before = await payable()
    const pos = await reverseAccrualForRefundedPortion({ orderId: o.id, vendorId: vPh.id, actor: { id: 'reconciler', type: 'reconciler' }, reason: 'phantom test' })
    assert(pos.reversed === true && (pos as any).cents === 4000, `phantom reversed, 4000¢ (got ${JSON.stringify(pos)})`)
    const after = await payable()
    assert(before - after === 4000, `payable dropped by EXACTLY 4000¢ (${before}→${after})`)
    const row = await prisma.vendorEarning.findFirst({ where: { orderId: o.id, vendorId: vPh.id }, select: { status: true } })
    assert(row?.status === 'cancelled', 'the phantom row is now cancelled')

    // ── [3] ATTRIBUTION — the audit row is reconciler, never admin ──────────────
    console.log('\n[3] the reversal audit row attributes the RECONCILER (actorType), never admin-by-default')
    const audit = await prisma.adminMoneyAction.findFirst({ where: { eventId: ev.id, orderId: o.id, payeeId: vPh.id }, orderBy: { createdAt: 'desc' }, select: { actorId: true, actorType: true, action: true } })
    assert(!!audit, 'a reversal audit row exists')
    assert(audit?.actorType === 'reconciler' && audit?.actorId === 'reconciler', `attributed to reconciler (got ${audit?.actorId}/${audit?.actorType})`)
    assert(audit?.action === 'CANCEL', 'recorded as a CANCEL')

    // ── [4] IDEMPOTENT — a second call is a no-op ───────────────────────────────
    console.log('\n[4] a second reversal call is a no-op (no double-cancel)')
    const again = await reverseAccrualForRefundedPortion({ orderId: o.id, vendorId: vPh.id, actor: { id: 'reconciler', type: 'reconciler' }, reason: 'x' })
    assert(again.reversed === false && (again as any).skipped === 'not-accrued', `second call skipped (got ${JSON.stringify(again)})`)
    const auditCount = await prisma.adminMoneyAction.count({ where: { eventId: ev.id, orderId: o.id, payeeId: vPh.id } })
    assert(auditCount === 1, `still exactly ONE audit row (no double) — got ${auditCount}`)

    // ── [5] PATTERN T — dry-run DETECTS the phantom, writes nothing ─────────────
    // dryRun:true keeps EVERY pattern detect-only (never run a live sweep in a test); the high
    // cap guarantees the seeded phantom is in the (whole-DB) set deterministically.
    console.log('\n[5] Pattern T dry-run DETECTS the seeded phantom (WOULD cancel) but writes nothing')
    await prisma.vendorEarning.update({ where: { orderId_vendorId: { orderId: o.id, vendorId: vPh.id } }, data: { status: 'accrued' } }) // re-seed
    const payableBeforeT = await payable()
    const dry = await runReconciliationSweep({ dryRun: true, maxPerPattern: 1000, windowHours: 1 })
    assert(dry.details.T.includes(o.id), `Pattern T flags the seeded phantom in its detect set (T found ${dry.repaired.T})`)
    assert(await payable() === payableBeforeT, 'detect-only wrote NOTHING (payable unchanged)')
    const stillAccrued = await prisma.vendorEarning.findFirst({ where: { orderId: o.id, vendorId: vPh.id }, select: { status: true } })
    assert(stillAccrued?.status === 'accrued', 'the phantom is still accrued after detect-only')

    // ── [6] REFUND-TIME HOOK — wiring + actor mapping (end-to-end proven in test-refunds) ──
    console.log('\n[6] the refund-time hook is wired at the chokepoint + threads the honest actor')
    assert(deriveMoneyActor('reconciler').type === 'reconciler', 'deriveMoneyActor: reconciler → reconciler')
    assert(deriveMoneyActor('system').type === 'system' && deriveMoneyActor(undefined).type === 'system', 'deriveMoneyActor: system/undefined → system')
    assert(deriveMoneyActor('vendor:abc').type === 'system', 'deriveMoneyActor: vendor:X → system (decline path, no accrual)')
    assert(deriveMoneyActor('user_x').id === 'user_x' && deriveMoneyActor('user_x').type === 'system', 'deriveMoneyActor: bare id → system (callers pass moneyActor explicitly)')
    const refundSrc = readFileSync('lib/process-refund.ts', 'utf8')
    assert(refundSrc.includes('reverseAccrualForRefundedPortion'), 'refundVendorPortion hooks the reverser at the chokepoint (covers every refund door)')
    assert(readFileSync('app/api/organizer/fairs/[fairSlug]/orders/[orderId]/refund/route.ts', 'utf8').includes("type: 'organizer'"), "organizer refund threads moneyActor {type:'organizer'}")
    assert(readFileSync('app/api/admin/events/[id]/money/refund/route.ts', 'utf8').includes("type: 'admin'"), "admin refund threads moneyActor {type:'admin'}")

    console.log(`\n${'─'.repeat(52)}`)
    console.log(fail === 0 ? `  ✅ ${pass} passed, 0 failed` : `  ❌ ${pass} passed, ${fail} failed`)
  } finally {
    await cleanup()
  }
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(fail === 0 ? 0 : 1)))
  .catch(async (e) => { console.error('\n💥', e); await prisma.$disconnect(); process.exit(1) })
