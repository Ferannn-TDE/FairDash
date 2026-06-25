/**
 * Phase 3 — STAGING integration test: customer-cancel through the aggregator.
 *
 * Run:  npx tsx scripts/test-phase3-cancel.ts
 *
 * Headline proof: the latent W5 bug — an unguarded cancel that could regress an
 * already-COMPLETED order to CANCELLED — is FIXED by routing through the guard.
 * Also proves cancel-intent threading (all-refunded → CANCELLED via the caller's
 * intent, which pure derivation abstains on), cancel-only semantics (never
 * promotes mid-cancel), and that the aggregator issues no refunds itself (those
 * stay in W5).
 *
 * Isolation/safety as Phase 1/2: TEST_REDIS_PREFIX=test, Firebase via mock, all
 * seeded rows deleted in finally. No Stripe.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'
process.env.FIREBASE_ENABLED = 'true'

import { db } from '../lib/db'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'
import { getOrderQueue } from '../lib/queues'
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

async function setVendors(orderId: string, statuses: Record<string, string>) {
  for (const [vendorId, status] of Object.entries(statuses)) {
    await db.vendorOrderStatus.update({ where: { orderId_vendorId: { orderId, vendorId } }, data: { status, version: { increment: 1 } } })
  }
}

async function seedOrder(eventId: string, vendors: { vendorId: string; menuItemId: string }[], customerId: string, status = 'PLACED') {
  const order = await db.order.create({
    data: {
      eventId, customerId, vendorId: vendors[0].vendorId,
      status: status as never, fulfillmentType: 'BOOTH_PICKUP',
      subtotal: 10 * vendors.length, total: 10 * vendors.length, fairSynqFee: 0.7, vendorPayout: 9.3,
      stripePaymentIntentId: `pi_test_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
      customerName: 'Phase3 Test', customerPhone: '555-0300', placedAt: new Date(),
      orderItems: { create: vendors.map(v => ({ vendorId: v.vendorId, menuItemId: v.menuItemId, itemName: 'P3', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 })) },
      vendorOrderStatuses: { create: vendors.map(v => ({ vendorId: v.vendorId, status: 'PLACED' })) },
    },
    select: { id: true },
  })
  seededOrderIds.push(order.id)
  return order.id
}

const ostatus = async (id: string) => (await db.order.findUnique({ where: { id }, select: { status: true, cancelledBy: true, cancellationReason: true } }))!
async function noPayout(orderId: string) {
  const q = getOrderQueue(); if (!q) return true
  payoutJobIds.push(`payout-${orderId}`)
  return !(await q.getJob(`payout-${orderId}`))
}
const refundCount = (orderId: string) => db.refund.count({ where: { orderId } })

async function main() {
  console.log(`\n${CYN}Phase 3 staging integration — customer-cancel through the aggregator${RESET}\n`)

  const items = await db.menuItem.findMany({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } }, take: 500 })
  const byEvent = new Map<string, Map<string, string>>()
  for (const it of items) { const ev = it.vendor?.eventId; if (!ev) continue; if (!byEvent.has(ev)) byEvent.set(ev, new Map()); if (!byEvent.get(ev)!.has(it.vendorId)) byEvent.get(ev)!.set(it.vendorId, it.id) }
  const mv = [...byEvent.entries()].find(([, vs]) => vs.size >= 2)
  if (!mv) { console.error('No event with ≥2 vendors+menu items'); process.exit(1) }
  const [eventId, vendorMap] = mv
  const [vA, vB] = [...vendorMap.entries()].map(([vendorId, menuItemId]) => ({ vendorId, menuItemId }))
  const customer = await db.user.create({ data: { clerkId: `p3_${RUN}`, email: `p3_${RUN}@test.invalid`, name: 'P3' }, select: { id: true } })
  seededUserIds.push(customer.id)
  const CANCEL = { cancel: { by: 'customer', reason: 'customer requested' } }

  // ── C1: all-DECLINED + cancel intent → CANCELLED (the AGREE case) ──────────
  console.log(`${CYN}C1 — all-DECLINED customer cancel → CANCELLED${RESET}`)
  const o1 = await seedOrder(eventId, [vA, vB], customer.id)
  await setVendors(o1, { [vA.vendorId]: 'DECLINED', [vB.vendorId]: 'DECLINED' })
  fbWrites.length = 0
  const r1 = await reconcileMasterStatus(o1, CANCEL)
  const s1 = await ostatus(o1)
  check('wrote CANCELLED', r1.wrote && r1.to === 'CANCELLED', JSON.stringify(r1))
  check('cancelledBy=customer, reason set', s1.status === 'CANCELLED' && s1.cancelledBy === 'customer' && s1.cancellationReason === 'customer requested')
  check('Firebase pushed CANCELLED', fbWrites.some(w => w.path === `fairs/${eventId}/customerOrders/${customer.id}/${o1}` && w.data.status === 'CANCELLED'))
  check('NO payout enqueued on cancel', await noPayout(o1))
  check('aggregator created NO refund rows (refunds are W5\'s job)', (await refundCount(o1)) === 0)

  // ── C2: all-REFUNDED PLACED + cancel intent → CANCELLED via override ────────
  console.log(`\n${CYN}C2 — all-REFUNDED + cancel intent → CANCELLED (override; pure derivation abstains)${RESET}`)
  const o2 = await seedOrder(eventId, [vA, vB], customer.id)
  await setVendors(o2, { [vA.vendorId]: 'REFUNDED', [vB.vendorId]: 'REFUNDED' })
  const r2 = await reconcileMasterStatus(o2, CANCEL)
  const s2 = await ostatus(o2)
  check('wrote CANCELLED via caller intent', r2.wrote && r2.to === 'CANCELLED', JSON.stringify(r2))
  check('master CANCELLED, cancelledBy=customer', s2.status === 'CANCELLED' && s2.cancelledBy === 'customer')

  // ── C3: THE BUG FIX — cancel on a COMPLETED order → guard REFUSES ──────────
  console.log(`\n${CYN}C3 — BUG FIX: cancel on a COMPLETED order is REFUSED (no regression)${RESET}`)
  const o3 = await seedOrder(eventId, [vA, vB], customer.id, 'COMPLETED')
  await setVendors(o3, { [vA.vendorId]: 'REFUNDED', [vB.vendorId]: 'REFUNDED' }) // all-terminal-none-completed → W5 would cancel
  const r3 = await reconcileMasterStatus(o3, CANCEL)
  const s3 = await ostatus(o3)
  check('cancel REFUSED by the guard (wrote=false)', r3.wrote === false, JSON.stringify(r3))
  check('order STAYS COMPLETED (the regression W5 has today is prevented)', s3.status === 'COMPLETED', `got ${s3.status}`)

  // ── C4: cancel on an already-CANCELLED order → no-op ───────────────────────
  console.log(`\n${CYN}C4 — cancel on already-CANCELLED → no-op${RESET}`)
  const r4 = await reconcileMasterStatus(o1, CANCEL) // o1 already CANCELLED
  check('idempotent no-op', r4.wrote === false && (await ostatus(o1)).status === 'CANCELLED')

  // ── C5: cancel-ONLY — never promotes a still-active order ──────────────────
  console.log(`\n${CYN}C5 — cancel-only: a still-active order is NOT promoted${RESET}`)
  const o5 = await seedOrder(eventId, [vA, vB], customer.id)
  await setVendors(o5, { [vA.vendorId]: 'REFUNDED', [vB.vendorId]: 'READY' }) // one refunded, one still active(READY)
  const r5 = await reconcileMasterStatus(o5, CANCEL)
  const s5 = await ostatus(o5)
  check('cancel no-op (not all-terminal)', r5.wrote === false)
  check('master NOT promoted to READY by a cancel call (stays PLACED)', s5.status === 'PLACED', `got ${s5.status}`)

  // ── C6: regression — normal (no-opts) reconcile still does derived transitions
  console.log(`\n${CYN}C6 — no-opts reconcile still derives (Phase 1/2 intact)${RESET}`)
  const o6 = await seedOrder(eventId, [vA, vB], customer.id)
  await setVendors(o6, { [vA.vendorId]: 'COMPLETED', [vB.vendorId]: 'COMPLETED' })
  const r6 = await reconcileMasterStatus(o6) // no opts → derived path
  check('booth all-COMPLETED → COMPLETED via derivation (signature change didn\'t break it)', r6.wrote && r6.to === 'COMPLETED', JSON.stringify(r6))
  payoutJobIds.push(`payout-${o6}`) // clean up its payout job

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ Cancel routed through the guard: all-declined & all-refunded cancel correctly,`)
    console.log(`  a COMPLETED order CANNOT be regressed (the W5 bug, fixed), cancels never promote,`)
    console.log(`  refunds stay in W5, and derived transitions still work.${RESET}`)
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

main().catch(e => { console.error(e); fail++ }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
