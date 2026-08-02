/**
 * Phase 4 — STAGING integration: runner transitions + worker timeouts through the
 * aggregator. The two headliners: earnings accrue on the aggregator-owned
 * DELIVERED (money proof), and a claim after UNDELIVERABLE is refused (race fix).
 *
 * Run:  npx tsx scripts/test-phase4-runner-timeouts.ts
 *
 * Isolation/safety as prior phases: TEST_REDIS_PREFIX=test, Firebase via mock,
 * all seeded rows deleted in finally. No Stripe (payout enqueued delayed).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'
process.env.FIREBASE_ENABLED = 'true'

import { db } from '../lib/db'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'
import { splitRunnerFee } from '../lib/payout-split'
import { getOrderQueue } from '../lib/queues'
import { VENDOR_DID_NOT_ACCEPT_REASON } from '../lib/constants'
import { __setRtdbForTest } from '../lib/firebase-sync'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'
let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

__setRtdbForTest({ ref: () => ({ update: async () => {}, set: async () => {} }) })

const seededOrderIds: string[] = []
const seededUserIds: string[] = []
const payoutJobIds: string[] = []

// W3's REAL atomic claim (status-aware), copied from status/route.ts.
async function atomicClaim(orderId: string, runnerId: string) {
  const r = await db.order.updateMany({
    where: { id: orderId, runnerId: null, status: 'READY' as never },
    data: { runnerId, dispatchedAt: new Date() },
  })
  return r.count
}

async function seedReadyDelivery(eventId: string, vendor: { vendorId: string; menuItemId: string }, customerId: string, opts: { deliveryFee?: number; tip?: number } = {}) {
  const order = await db.order.create({
    data: {
      eventId, customerId, vendorId: vendor.vendorId,
      status: 'PLACED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 10, total: 10, fairSynqFee: 0.7, vendorPayout: 9.3,
      deliveryFee: opts.deliveryFee ?? 0, tip: opts.tip ?? 0,
      stripePaymentIntentId: `pi_test_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
      customerName: 'Phase4', customerPhone: '555-0400', placedAt: new Date(),
      orderItems: { create: [{ vendorId: vendor.vendorId, menuItemId: vendor.menuItemId, itemName: 'P4', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
      vendorOrderStatuses: { create: [{ vendorId: vendor.vendorId, status: 'READY' }] }, // already prepared
    },
    select: { id: true },
  })
  seededOrderIds.push(order.id)
  await reconcileMasterStatus(order.id) // derive master READY from all-ready vendor
  return order.id
}

const ostatus = async (id: string) => (await db.order.findUnique({ where: { id }, select: { status: true, runnerId: true, uncollectedAt: true, cancelledBy: true } }))!
async function hasPayout(orderId: string) { const q = getOrderQueue(); if (!q) return false; payoutJobIds.push(`payout-${orderId}`); return !!(await q.getJob(`payout-${orderId}`)) }

async function main() {
  console.log(`\n${CYN}Phase 4 staging integration — runner + timeouts through the aggregator${RESET}\n`)

  const items = await db.menuItem.findMany({ select: { id: true, vendorId: true, vendor: { select: { eventId: true } } }, take: 500 })
  const byEvent = new Map<string, { vendorId: string; menuItemId: string }>()
  for (const it of items) { const ev = it.vendor?.eventId; if (ev && !byEvent.has(ev)) byEvent.set(ev, { vendorId: it.vendorId, menuItemId: it.id }) }
  const [eventId, vendor] = [...byEvent.entries()][0]
  const cfg = await db.fulfillmentConfig.findUnique({ where: { eventId }, select: { runnerFeePercent: true } }).catch(() => null)
  const runnerPct = cfg?.runnerFeePercent ?? 0
  console.log(`${DIM}event=${eventId} runnerFeePercent=${runnerPct}${RESET}\n`)

  const customer = await db.user.create({ data: { clerkId: `p4c_${RUN}`, email: `p4c_${RUN}@test.invalid`, name: 'P4C' }, select: { id: true } })
  seededUserIds.push(customer.id)
  const runnerUser = await db.user.create({ data: { clerkId: `p4r_${RUN}`, email: `p4r_${RUN}@test.invalid`, name: 'P4R' }, select: { id: true } })
  seededUserIds.push(runnerUser.id)
  const runner = await db.runner.create({ data: { userId: runnerUser.id, eventId, status: 'ACTIVE' }, select: { id: true } })

  // ── R1 — claim → collect → deliver: status derives at each step ────────────
  console.log(`${CYN}R1 — runner claim → RUNNER_COLLECTED → DELIVERED (derived from columns)${RESET}`)
  const o1 = await seedReadyDelivery(eventId, vendor, customer.id, { deliveryFee: 5, tip: 3 })
  check('seeded order at master READY', (await ostatus(o1)).status === 'READY')
  const claim1 = await atomicClaim(o1, runner.id)
  const rcoll = await reconcileMasterStatus(o1)
  check('claim won + master derives RUNNER_COLLECTED', claim1 === 1 && rcoll.to === 'RUNNER_COLLECTED' && (await ostatus(o1)).status === 'RUNNER_COLLECTED', JSON.stringify(rcoll))
  await db.order.update({ where: { id: o1 }, data: { deliveryProofPath: 'proof.jpg', runnerConfirmedLat: 1, runnerConfirmedLng: 2 } })
  const rdel = await reconcileMasterStatus(o1)
  check('deliver: master derives DELIVERED from photo', rdel.to === 'DELIVERED' && (await ostatus(o1)).status === 'DELIVERED', JSON.stringify(rdel))

  // ── R2 — THE MONEY PROOF: earnings accrue on aggregator-owned DELIVERED ─────
  console.log(`\n${CYN}R2 — MONEY: RunnerEarning + OrganizerEarning accrue + payout enqueued${RESET}`)
  const { runnerShareCents, organizerShareCents } = splitRunnerFee(500, runnerPct)
  const expectedRunner = runnerShareCents + 300 // fee share + $3 tip
  const re = await db.runnerEarning.findUnique({ where: { orderId: o1 }, select: { amountCents: true, runnerId: true } })
  const oe = await db.organizerEarning.findUnique({ where: { orderId: o1 }, select: { amountCents: true } })
  check(`RunnerEarning accrued = runnerShare(${runnerShareCents}) + tip(300) = ${expectedRunner}`, re?.amountCents === expectedRunner, `got ${re?.amountCents}`)
  check('RunnerEarning is the assigned runner', re?.runnerId === runner.id)
  check(`OrganizerEarning accrued = organizerShare(${organizerShareCents})`, organizerShareCents === 0 ? oe == null : oe?.amountCents === organizerShareCents, `got ${oe?.amountCents}`)
  check('delayed payout enqueued on DELIVERED', await hasPayout(o1))

  // ── R3 — THE RACE FIX: claim after UNDELIVERABLE is refused ─────────────────
  console.log(`\n${CYN}R3 — RACE FIX: claim landing after UNDELIVERABLE is refused${RESET}`)
  const o3 = await seedReadyDelivery(eventId, vendor, customer.id)
  await reconcileMasterStatus(o3, { timeout: { status: 'UNDELIVERABLE' } }) // timeout fires first
  check('order is UNDELIVERABLE', (await ostatus(o3)).status === 'UNDELIVERABLE')
  const lateClaim = await atomicClaim(o3, runner.id) // runner's claim lands late
  const s3 = await ostatus(o3)
  check('late claim wins ZERO rows (status-aware claim refuses)', lateClaim === 0)
  check('order STAYS UNDELIVERABLE, no stray runnerId (resurrection prevented)', s3.status === 'UNDELIVERABLE' && s3.runnerId === null, `status=${s3.status} runner=${s3.runnerId}`)

  // ── R4 — W7 timeouts apply behind the guard + refuse re-fire ───────────────
  console.log(`\n${CYN}R4 — timeouts apply + refuse re-fire (TOCTOU closed)${RESET}`)
  const o4 = await seedReadyDelivery(eventId, vendor, customer.id)
  const t1 = await reconcileMasterStatus(o4, { timeout: { status: 'UNDELIVERABLE' } })
  const t2 = await reconcileMasterStatus(o4, { timeout: { status: 'UNDELIVERABLE' } }) // re-fire
  check('first timeout writes UNDELIVERABLE', t1.wrote === true)
  check('re-fire is a no-op (guard refuses, TOCTOU closed)', t2.wrote === false && (await ostatus(o4)).status === 'UNDELIVERABLE')
  const o4b = await seedReadyDelivery(eventId, vendor, customer.id)
  const tu = await reconcileMasterStatus(o4b, { timeout: { status: 'UNCOLLECTED' } })
  check('UNCOLLECTED applies + sets uncollectedAt', tu.to === 'UNCOLLECTED' && (await ostatus(o4b)).uncollectedAt != null)

  // ── R5 — atomic claim wins exactly one under concurrency (7/7) ─────────────
  console.log(`\n${CYN}R5 — atomic claim: exactly one winner under concurrency${RESET}`)
  const o5 = await seedReadyDelivery(eventId, vendor, customer.id)
  const N = 7
  const claimers = await Promise.all([...Array(N)].map(() => atomicClaim(o5, runner.id)))
  const winners = claimers.filter(c => c === 1).length
  check(`exactly 1 of ${N} concurrent claims won (assignment guard intact)`, winners === 1, `winners=${winners}`)

  // ── R6 — accept-timeout CANCELLED via opts.timeout ─────────────────────────
  console.log(`\n${CYN}R6 — accept-timeout → CANCELLED (asserted), cancelledBy=system${RESET}`)
  const o6 = await db.order.create({
    data: {
      eventId, customerId: customer.id, vendorId: vendor.vendorId, status: 'PLACED', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 10, total: 10, fairSynqFee: 0.7, vendorPayout: 9.3, customerName: 'P4', customerPhone: '5', placedAt: new Date(),
      orderItems: { create: [{ vendorId: vendor.vendorId, menuItemId: vendor.menuItemId, itemName: 'P4', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
      vendorOrderStatuses: { create: [{ vendorId: vendor.vendorId, status: 'PLACED' }] },
    }, select: { id: true },
  })
  seededOrderIds.push(o6.id)
  const r6 = await reconcileMasterStatus(o6.id, { timeout: { status: 'CANCELLED', by: 'system', reason: VENDOR_DID_NOT_ACCEPT_REASON } })
  const s6 = await ostatus(o6.id)
  check('accept-timeout writes CANCELLED, cancelledBy=system', r6.to === 'CANCELLED' && s6.status === 'CANCELLED' && s6.cancelledBy === 'system')

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ Runner transitions derive correctly; earnings accrue on the aggregator-owned`)
    console.log(`  DELIVERED (money proof); the resurrection race is refused; timeouts apply once;`)
    console.log(`  the atomic claim still wins exactly one. One owner for every master write.${RESET}`)
  } else {
    console.log(`${RED}✗ See failures above.${RESET}`)
  }
}

async function cleanup() {
  const q = getOrderQueue()
  if (q) for (const id of payoutJobIds) { await q.getJob(id).then(j => j?.remove()).catch(() => {}) }
  // earnings cascade-delete with the order? RunnerEarning/OrganizerEarning FK orderId — delete explicitly to be safe.
  if (seededOrderIds.length) {
    await db.runnerEarning.deleteMany({ where: { orderId: { in: seededOrderIds } } }).catch(() => {})
    await db.organizerEarning.deleteMany({ where: { orderId: { in: seededOrderIds } } }).catch(() => {})
    await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  }
  if (seededUserIds.length) {
    await db.runner.deleteMany({ where: { userId: { in: seededUserIds } } }).catch(() => {})
    await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  }
  __setRtdbForTest(null)
  await db.$disconnect()
  try { await q?.close() } catch { /* ignore */ }
}

main().catch(e => { console.error(e); fail++ }).finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
