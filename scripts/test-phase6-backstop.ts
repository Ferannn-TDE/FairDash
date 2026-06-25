/**
 * Phase 6 — STAGING integration: the reconciler finish.
 *   • Pattern N — drift backstop: detects a status that diverged from per-vendor
 *     truth (ALERT-first), and heals it through the aggregator.
 *   • Pattern O — stranded READY delivery with no runner → alert.
 *   • Pattern L — now actually audits DELIVERED earnings (the completedAt→updatedAt
 *     fix): catches a delivered order with missing earnings, passes a correct one.
 *
 * Runs the REAL sweep in dryRun (alert-only everywhere — safe) to prove detection,
 * then calls reconcileMasterStatus directly to prove Pattern N's heal. Isolated,
 * self-cleaning.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'

import { db } from '../lib/db'
import { runReconciliationSweep } from '../lib/reconciler'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

const seededOrderIds: string[] = []
const seededUserIds: string[] = []

async function main() {
  console.log(`\n${CYN}Phase 6 staging — reconciler backstop + strand alert + Pattern L fix${RESET}\n`)

  const it = await db.menuItem.findFirst({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } } })
  if (!it?.vendor?.eventId) { console.error('no fixture'); process.exit(1) }
  const eventId = it.vendor.eventId, vendorId = it.vendorId, menuItemId = it.id
  const cfg = await db.fulfillmentConfig.findUnique({ where: { eventId }, select: { runnerFeePercent: true } }).catch(() => null)
  const pct = cfg?.runnerFeePercent ?? 0
  const customer = await db.user.create({ data: { clerkId: `p6c_${RUN}`, email: `p6c_${RUN}@test.invalid`, name: 'P6C' }, select: { id: true } })
  seededUserIds.push(customer.id)
  const runnerUser = await db.user.create({ data: { clerkId: `p6r_${RUN}`, email: `p6r_${RUN}@test.invalid`, name: 'P6R' }, select: { id: true } })
  seededUserIds.push(runnerUser.id)
  const runner = await db.runner.create({ data: { userId: runnerUser.id, eventId, status: 'ACTIVE' }, select: { id: true } })

  const base = (extra: Record<string, unknown>) => ({
    eventId, customerId: customer.id, vendorId, fulfillmentType: 'HOME_DELIVERY' as never,
    subtotal: 10, total: 10, fairSynqFee: 0.7, vendorPayout: 9.3, customerName: 'P6', customerPhone: '5', placedAt: new Date(),
    orderItems: { create: [{ vendorId, menuItemId, itemName: 'P6', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
    ...extra,
  })
  const track = async (p: Promise<{ id: string }>) => { const o = await p; seededOrderIds.push(o.id); return o.id }

  // DRIFT order: master PLACED but both vendor portions READY (written directly,
  // bypassing the aggregator) → derived READY ≠ stored PLACED.
  const drift = await track(db.order.create({ data: base({ status: 'PLACED', vendorOrderStatuses: { create: [{ vendorId, status: 'READY' }] } }), select: { id: true } }))

  // STRAND order: consistent master READY (no drift), delivery, no runner, readyAt
  // 20min ago (> 10min timeout) → Pattern O.
  const strand = await track(db.order.create({ data: base({ status: 'READY', readyAt: new Date(Date.now() - 20 * 60000), vendorOrderStatuses: { create: [{ vendorId, status: 'READY' }] } }), select: { id: true } }))

  // DELIVERED with MISSING earnings (recent updatedAt, fee/tip) → Pattern L alert.
  const delBad = await track(db.order.create({ data: base({ status: 'DELIVERED', runnerId: runner.id, deliveryFee: 5, tip: 3, curbsidePhotoUrl: 'p.jpg', vendorOrderStatuses: { create: [{ vendorId, status: 'READY' }] } }), select: { id: true } }))

  // DELIVERED with CORRECT earnings → Pattern L should NOT alert.
  const delGood = await track(db.order.create({ data: base({ status: 'DELIVERED', runnerId: runner.id, deliveryFee: 5, tip: 3, curbsidePhotoUrl: 'p.jpg', vendorOrderStatuses: { create: [{ vendorId, status: 'READY' }] } }), select: { id: true } }))
  const { splitRunnerFee } = await import('../lib/payout-split')
  const { runnerShareCents, organizerShareCents } = splitRunnerFee(500, pct)
  await db.runnerEarning.create({ data: { eventId, orderId: delGood, runnerId: runner.id, amountCents: runnerShareCents + 300, status: 'tracked' } })
  if (organizerShareCents > 0) await db.organizerEarning.create({ data: { eventId, orderId: delGood, organizerId: null, amountCents: organizerShareCents, source: 'delivery_fee_share', status: 'accrued' } })

  // ── Run the real sweep in dryRun (alert-only everywhere — safe) ────────────
  console.log(`${DIM}running reconciler sweep (dryRun, alert-only)…${RESET}`)
  const sum = await runReconciliationSweep({ dryRun: true, stripeWindowHours: 0.001 })

  console.log(`\n${CYN}Pattern N — drift backstop (ALERT-first)${RESET}`)
  check('backstop is ALERT-only by default (not auto-healing)', sum.backstopEnabled === false)
  check('N detected the drift order (PLACED but derives READY)', sum.details.N.includes(drift), `N=[${sum.details.N.join(',')}]`)
  check('N did NOT heal in alert mode (repaired.N === 0)', sum.repaired.N === 0)

  console.log(`\n${CYN}Pattern N — heal through the aggregator (what ACT mode does)${RESET}`)
  const rec = await reconcileMasterStatus(drift)
  check('reconcileMasterStatus heals drift → READY', rec.wrote && rec.to === 'READY', JSON.stringify(rec))
  check('drift order now READY', (await db.order.findUnique({ where: { id: drift }, select: { status: true } }))!.status === 'READY')

  console.log(`\n${CYN}Pattern O — stranded READY delivery, no runner${RESET}`)
  check('O alerted the stranded order', sum.details.O.includes(strand), `O=[${sum.details.O.join(',')}]`)

  console.log(`\n${CYN}Pattern L — now audits DELIVERED earnings (completedAt→updatedAt fix)${RESET}`)
  check('L caught the delivered order with MISSING earnings', sum.details.L.includes(delBad), `L=[${sum.details.L.join(',')}]`)
  check('L did NOT flag the correctly-accrued delivered order', !sum.details.L.includes(delGood))

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ Backstop detects drift (alert-first) + heals via the aggregator; strands surfaced;`)
    console.log(`  delivered-order earnings are finally audited. The convergence has its safety net.${RESET}`)
  } else {
    console.log(`${RED}✗ See failures.${RESET}`)
  }
}

async function cleanup() {
  if (seededOrderIds.length) {
    await db.runnerEarning.deleteMany({ where: { orderId: { in: seededOrderIds } } }).catch(() => {})
    await db.organizerEarning.deleteMany({ where: { orderId: { in: seededOrderIds } } }).catch(() => {})
    await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  }
  if (seededUserIds.length) {
    await db.runner.deleteMany({ where: { userId: { in: seededUserIds } } }).catch(() => {})
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); fail++ }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
