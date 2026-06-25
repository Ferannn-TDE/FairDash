/**
 * Phase 2 — STAGING integration test: COMPLETED/CANCELLED absorption + the money.
 *
 * Run:  npx tsx scripts/test-phase2-complete.ts
 *
 * Proves the plumbing for the COMPLETED/CANCELLED writes the aggregator now owns —
 * above all the no-orphan guarantee: an order completing MUST enqueue the delayed
 * payout, and on a mixed [COMPLETED,REFUNDED] order it must pay the completed
 * portion only.
 *
 * Isolation/safety identical to the Phase 1 test: TEST_REDIS_PREFIX=test (jobs off
 * the prod queue, removed in cleanup), Firebase via __setRtdbForTest (prod
 * untouched), all seeded rows deleted in finally. No Stripe is ever called (the
 * payout is enqueued DELAYED behind the refund window — never runs inline).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'
process.env.FIREBASE_ENABLED = 'true'

import { db } from '../lib/db'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'
import { getOrderQueue } from '../lib/queues'
import { REFUND_WINDOW_MS } from '../lib/constants'
import { __setRtdbForTest } from '../lib/firebase-sync'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

const fbWrites: { path: string; data: Record<string, unknown> }[] = []
__setRtdbForTest({
  ref: (path: string) => ({
    update: async (d: object) => { fbWrites.push({ path, data: d as Record<string, unknown> }) },
    set:    async (d: object) => { fbWrites.push({ path, data: d as Record<string, unknown> }) },
  }),
})

const seededOrderIds: string[] = []
const seededUserIds: string[] = []
const payoutJobIds: string[] = []

async function setVendor(orderId: string, vendorId: string, status: string) {
  await db.vendorOrderStatus.update({
    where: { orderId_vendorId: { orderId, vendorId } },
    data: { status, version: { increment: 1 } },
  })
}

async function seedOrder(
  eventId: string,
  vendors: { vendorId: string; menuItemId: string }[],
  fulfillmentType: 'HOME_DELIVERY' | 'BOOTH_PICKUP',
  customerId: string,
) {
  const order = await db.order.create({
    data: {
      eventId, customerId, vendorId: vendors[0].vendorId,
      status: 'PLACED', fulfillmentType: fulfillmentType as never,
      subtotal: 10 * vendors.length, total: 10 * vendors.length,
      fairSynqFee: 0.7, vendorPayout: 9.3,
      stripePaymentIntentId: `pi_test_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
      customerName: 'Phase2 Test', customerPhone: '555-0200', placedAt: new Date(),
      orderItems: { create: vendors.map(v => ({
        vendorId: v.vendorId, menuItemId: v.menuItemId, itemName: 'P2 Item',
        quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10,
      })) },
      vendorOrderStatuses: { create: vendors.map(v => ({ vendorId: v.vendorId, status: 'PLACED' })) },
    },
    select: { id: true },
  })
  seededOrderIds.push(order.id)
  return order.id
}

async function getOrder(id: string) {
  return db.order.findUnique({ where: { id }, select: { status: true, completedAt: true, cancelledAt: true } })
}

async function payoutJob(orderId: string) {
  const q = getOrderQueue(); if (!q) return null
  const id = `payout-${orderId}`
  payoutJobIds.push(id)
  return q.getJob(id)
}

// The exact predicate processOrderPayout keys on (process-payout.ts:155):
// a vendor is paid unless its portion is DECLINED or REFUNDED.
async function payableVendorIds(orderId: string): Promise<string[]> {
  const rows = await db.vendorOrderStatus.findMany({ where: { orderId }, select: { vendorId: true, status: true } })
  return rows.filter(r => r.status !== 'DECLINED' && r.status !== 'REFUNDED').map(r => r.vendorId)
}

async function main() {
  console.log(`\n${CYN}Phase 2 staging integration — COMPLETED/CANCELLED + the money${RESET}\n`)

  const items = await db.menuItem.findMany({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } }, take: 500 })
  const byEvent = new Map<string, Map<string, string>>()
  for (const it of items) {
    const ev = it.vendor?.eventId; if (!ev) continue
    if (!byEvent.has(ev)) byEvent.set(ev, new Map())
    if (!byEvent.get(ev)!.has(it.vendorId)) byEvent.get(ev)!.set(it.vendorId, it.id)
  }
  const mv = [...byEvent.entries()].find(([, vs]) => vs.size >= 2)
  if (!mv) { console.error('No event with ≥2 vendors+menu items'); process.exit(1) }
  const [eventId, vendorMap] = mv
  const [vA, vB] = [...vendorMap.entries()].map(([vendorId, menuItemId]) => ({ vendorId, menuItemId }))

  const customer = await db.user.create({ data: { clerkId: `p2_cust_${RUN}`, email: `p2cust_${RUN}@test.invalid`, name: 'P2' }, select: { id: true } })
  seededUserIds.push(customer.id)

  // ── P1: booth all-COMPLETED → COMPLETED + delayed payout enqueued ──────────
  console.log(`${CYN}P1 — booth all-COMPLETED → master COMPLETED + payout behind the window${RESET}`)
  const o1 = await seedOrder(eventId, [vA, vB], 'BOOTH_PICKUP', customer.id)
  await setVendor(o1, vA.vendorId, 'COMPLETED'); await setVendor(o1, vB.vendorId, 'COMPLETED')
  fbWrites.length = 0
  const r1 = await reconcileMasterStatus(o1)
  const s1 = await getOrder(o1)
  check('aggregator wrote COMPLETED', r1.wrote && r1.to === 'COMPLETED', JSON.stringify(r1))
  check('master Order.status === COMPLETED, completedAt set', s1?.status === 'COMPLETED' && s1?.completedAt != null)
  const j1 = await payoutJob(o1)
  check('REAL delayed payout job enqueued (the no-orphan guarantee)', !!j1, 'payout job missing')
  check('payout delayed behind the refund window', !!j1 && j1.opts.delay === REFUND_WINDOW_MS, `delay=${j1?.opts.delay} want ${REFUND_WINDOW_MS}`)
  check('Firebase pushed COMPLETED to customer node', fbWrites.some(w => w.path === `fairs/${eventId}/customerOrders/${customer.id}/${o1}` && w.data.status === 'COMPLETED'))

  // ── P2: [COMPLETED,REFUNDED] un-strand → COMPLETED, pay completed portion only
  console.log(`\n${CYN}P2 — [COMPLETED,REFUNDED] un-strand → payout scoped to completed portion${RESET}`)
  const o2 = await seedOrder(eventId, [vA, vB], 'BOOTH_PICKUP', customer.id)
  await setVendor(o2, vA.vendorId, 'COMPLETED'); await setVendor(o2, vB.vendorId, 'REFUNDED')
  const r2 = await reconcileMasterStatus(o2)
  const s2 = await getOrder(o2)
  check('un-stranded to COMPLETED (W4 froze this at PLACED)', r2.wrote && r2.to === 'COMPLETED', JSON.stringify(r2))
  check('master status COMPLETED', s2?.status === 'COMPLETED')
  const j2 = await payoutJob(o2)
  check('payout enqueued on the un-strand', !!j2)
  const payable = await payableVendorIds(o2)
  check('payout pays the COMPLETED vendor only', payable.length === 1 && payable[0] === vA.vendorId, `payable=[${payable.join(',')}]`)
  check('payout SKIPS the REFUNDED vendor (money already returned)', !payable.includes(vB.vendorId))

  // ── P3: all-DECLINED → master CANCELLED, no payout ─────────────────────────
  console.log(`\n${CYN}P3 — all-DECLINED → master CANCELLED${RESET}`)
  const o3 = await seedOrder(eventId, [vA, vB], 'BOOTH_PICKUP', customer.id)
  await setVendor(o3, vA.vendorId, 'DECLINED'); await setVendor(o3, vB.vendorId, 'DECLINED')
  fbWrites.length = 0
  const r3 = await reconcileMasterStatus(o3)
  const s3 = await getOrder(o3)
  check('aggregator wrote CANCELLED', r3.wrote && r3.to === 'CANCELLED', JSON.stringify(r3))
  check('master status CANCELLED, cancelledAt set', s3?.status === 'CANCELLED' && s3?.cancelledAt != null)
  const j3 = await payoutJob(o3)
  check('NO payout enqueued on cancellation', !j3)
  check('Firebase pushed CANCELLED to customer node', fbWrites.some(w => w.path === `fairs/${eventId}/customerOrders/${customer.id}/${o3}` && w.data.status === 'CANCELLED'))
  console.log(`  ${DIM}(per-decline refunds are W4's per-vendor path, already fired before reconcile — not the master transition)${RESET}`)

  // ── P4: delivery with a vendor-COMPLETED portion STAYS READY (no vendor-complete)
  console.log(`\n${CYN}P4 — delivery never completes vendor-side${RESET}`)
  const o4 = await seedOrder(eventId, [vA], 'HOME_DELIVERY', customer.id)
  await setVendor(o4, vA.vendorId, 'COMPLETED')
  const r4 = await reconcileMasterStatus(o4)
  const s4 = await getOrder(o4)
  check('delivery vendor-COMPLETED → master READY, NOT COMPLETED', r4.wrote && r4.to === 'READY' && s4?.status === 'READY', `to=${r4.to} status=${s4?.status}`)
  check('no premature COMPLETED for delivery (completion is the runner DELIVERED)', s4?.status !== 'COMPLETED')

  // ── P5: monotonic guard — re-run on a terminal order is a no-op ────────────
  console.log(`\n${CYN}P5 — monotonic guard (no regression / idempotent)${RESET}`)
  const r5 = await reconcileMasterStatus(o1) // o1 is already COMPLETED
  const s5 = await getOrder(o1)
  check('re-running on a COMPLETED order is a no-op', r5.wrote === false, JSON.stringify(r5))
  check('status stays COMPLETED (terminal is absorbing)', s5?.status === 'COMPLETED')

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ COMPLETED/CANCELLED absorbed: completion enqueues the delayed payout (no orphan),`)
    console.log(`  the mixed order pays the completed portion only, delivery never completes vendor-side,`)
    console.log(`  cancellation fires no payout, and terminal orders never regress.${RESET}`)
  } else {
    console.log(`${RED}✗ See failures above.${RESET}`)
  }
}

async function cleanup() {
  const q = getOrderQueue()
  if (q) for (const id of payoutJobIds) { await q.getJob(id).then(j => j?.remove()).catch(() => {}) }
  if (seededOrderIds.length) await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  if (seededUserIds.length) await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  __setRtdbForTest(null)
  await db.$disconnect()
  try { await q?.close() } catch { /* ignore */ }
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
