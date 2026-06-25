/**
 * Phase 1 — STAGING integration test: the delivery handoff, fired end to end.
 *
 * Run:  npx tsx scripts/test-phase1-handoff.ts
 *
 * The matrix/decision harnesses prove the LOGIC. This proves the PLUMBING — the
 * "wired vs working" gap: when a vendor marks the last portion READY, does the
 * promotion ACTUALLY arm a real BullMQ timeout job, push to the real Firebase
 * node, and make the order genuinely claimable through the real runner-feed
 * query? None of that has ever executed (live had 0 eligible orders).
 *
 * It drives W4's REAL promotion codepath: the real VendorOrderStatus write + the
 * real reconcileMasterStatus() with its real side-effects. (The only part it
 * can't run from a script is W4's HTTP/Clerk shell — auth needs a request
 * context — which is not the part in doubt.)
 *
 * Isolation / safety:
 *   • TEST_REDIS_PREFIX=test  → BullMQ jobs land in a test-prefixed keyspace,
 *     never the prod 'bull' queue. Jobs are removed in cleanup.
 *   • Firebase writes are captured via __setRtdbForTest — the REAL prod Firebase
 *     is never touched; we assert the exact node paths the code would write.
 *   • All seeded rows (orders, statuses, users, runner) are deleted in finally.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.TEST_REDIS_PREFIX = 'test'   // isolate BullMQ from prod
process.env.FIREBASE_ENABLED = 'true'    // let the push fire into the mock RTDB

import { db } from '../lib/db'
import { reconcileMasterStatus } from '../lib/reconcile-order-status'
import { getOrderQueue, JOB_UNDELIVERABLE, JOB_UNCOLLECTED } from '../lib/queues'
import { CURBSIDE_WAIT_TIMEOUT_MS } from '../lib/constants'
import { __setRtdbForTest } from '../lib/firebase-sync'

const RUN = Date.now()
const RED = '\x1b[31m', GRN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m', CYN = '\x1b[36m'

let pass = 0, fail = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ${GRN}✓${RESET} ${label}`) }
  else { fail++; console.log(`  ${RED}✗ ${label}${RESET} ${DIM}${detail}${RESET}`) }
}

// ── Firebase capture (no real Firebase touched) ──────────────────────────────
const fbWrites: { path: string; data: Record<string, unknown> }[] = []
__setRtdbForTest({
  ref: (path: string) => ({
    update: async (d: object) => { fbWrites.push({ path, data: d as Record<string, unknown> }) },
    set:    async (d: object) => { fbWrites.push({ path, data: d as Record<string, unknown> }) },
  }),
})

// ── Tracked rows for cleanup ─────────────────────────────────────────────────
const seededOrderIds: string[] = []
const seededUserIds: string[] = []
let seededRunnerUserId = ''
const enqueuedJobIds: string[] = []

// ── The REAL runner-feed query, copied verbatim from
//    app/api/runners/me/orders/route.ts (the endpoint reads Postgres). ─────────
async function runnerFeed(runnerId: string, eventId: string) {
  return db.order.findMany({
    where: {
      eventId,
      fulfillmentType: { in: ['HOME_DELIVERY', 'CURBSIDE'] as never },
      OR: [
        { status: 'READY' as never, OR: [{ runnerId: null }, { runnerId }] },
        { status: 'RUNNER_COLLECTED' as never, runnerId },
      ],
    },
    select: { id: true, fulfillmentType: true, status: true },
  })
}

// ── W4's REAL READY codepath (minus the auth shell): write the vendor portion,
//    then call the real Phase-1 promotion. ─────────────────────────────────────
async function markVendorReadyViaW4(orderId: string, vendorId: string) {
  await db.vendorOrderStatus.update({
    where: { orderId_vendorId: { orderId, vendorId } },
    data: { status: 'READY', version: { increment: 1 }, readyAt: new Date() },
  })
  return reconcileMasterStatus(orderId)
}

async function seedOrder(
  eventId: string,
  vendors: { vendorId: string; menuItemId: string }[],
  fulfillmentType: 'HOME_DELIVERY' | 'CURBSIDE' | 'BOOTH_PICKUP',
  customerId: string,
) {
  const order = await db.order.create({
    data: {
      eventId, customerId, vendorId: vendors[0].vendorId,
      status: 'PLACED', fulfillmentType: fulfillmentType as never,
      subtotal: 10 * vendors.length, total: 10 * vendors.length,
      fairSynqFee: 0.7, vendorPayout: 9.3, deliveryFee: 5,
      customerName: 'Phase1 Test', customerPhone: '555-0100', placedAt: new Date(),
      orderItems: { create: vendors.map(v => ({
        vendorId: v.vendorId, menuItemId: v.menuItemId, itemName: 'P1 Item',
        quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10,
      })) },
      vendorOrderStatuses: { create: vendors.map(v => ({ vendorId: v.vendorId, status: 'PLACED' })) },
    },
    select: { id: true },
  })
  seededOrderIds.push(order.id)
  return order.id
}

async function getStatus(orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { status: true, readyAt: true, runnerId: true } })
  return o!
}

async function timeoutJob(orderId: string, jobName: string) {
  const q = getOrderQueue()
  if (!q) return null
  const id = `${jobName}-${orderId}`
  enqueuedJobIds.push(id)
  return q.getJob(id)
}

async function main() {
  console.log(`\n${CYN}Phase 1 staging integration — the handoff, fired for real${RESET}\n`)

  // ── Discover fixtures: an event with ≥2 vendors that have menu items ────────
  const items = await db.menuItem.findMany({
    select: { id: true, vendorId: true, vendor: { select: { eventId: true } } },
    take: 500,
  })
  const byEvent = new Map<string, Map<string, string>>() // eventId → (vendorId → menuItemId)
  for (const it of items) {
    const ev = it.vendor?.eventId; if (!ev) continue
    if (!byEvent.has(ev)) byEvent.set(ev, new Map())
    const m = byEvent.get(ev)!
    if (!m.has(it.vendorId)) m.set(it.vendorId, it.id)
  }
  const multiVendorEvent = [...byEvent.entries()].find(([, vs]) => vs.size >= 2)
  if (!multiVendorEvent) { console.error('No event with ≥2 vendors+menu items found — cannot run multi-vendor cases.'); process.exit(1) }
  const [eventId, vendorMap] = multiVendorEvent
  const [vA, vB] = [...vendorMap.entries()].map(([vendorId, menuItemId]) => ({ vendorId, menuItemId }))
  console.log(`${DIM}fixtures: event=${eventId} vendorA=${vA.vendorId} vendorB=${vB.vendorId}${RESET}\n`)

  // ── Test users + runner ────────────────────────────────────────────────────
  const customer = await db.user.create({ data: { clerkId: `p1_cust_${RUN}`, email: `p1cust_${RUN}@test.invalid`, name: 'P1 Customer' }, select: { id: true } })
  seededUserIds.push(customer.id)
  const runnerUser = await db.user.create({ data: { clerkId: `p1_run_${RUN}`, email: `p1run_${RUN}@test.invalid`, name: 'P1 Runner' }, select: { id: true } })
  seededUserIds.push(runnerUser.id); seededRunnerUserId = runnerUser.id
  const runner = await db.runner.create({ data: { userId: runnerUser.id, eventId, status: 'ACTIVE' }, select: { id: true } })

  // ════════════════════════════════════════════════════════════════════════
  // S1 — Single-vendor HOME_DELIVERY: promote → timeout armed → Firebase → feed
  // ════════════════════════════════════════════════════════════════════════
  console.log(`${CYN}S1 — single-vendor HOME_DELIVERY handoff${RESET}`)
  const o1 = await seedOrder(eventId, [vA], 'HOME_DELIVERY', customer.id)
  fbWrites.length = 0
  const r1 = await markVendorReadyViaW4(o1, vA.vendorId)
  const s1 = await getStatus(o1)
  check('reconcileMasterStatus wrote READY (to===READY)', r1.wrote && r1.to === 'READY', JSON.stringify(r1))
  check('master Order.status === READY', s1.status === 'READY', `got ${s1.status}`)
  check('readyAt was set', s1.readyAt != null)

  const job1 = await timeoutJob(o1, JOB_UNDELIVERABLE)
  check('REAL BullMQ UNDELIVERABLE job armed (the dormant timeout, now firing)', !!job1, 'job not found in queue')
  check('timeout job has correct delay', !!job1 && job1.opts.delay === CURBSIDE_WAIT_TIMEOUT_MS, `delay=${job1?.opts.delay} want ${CURBSIDE_WAIT_TIMEOUT_MS}`)

  const custNode = `fairs/${eventId}/customerOrders/${customer.id}/${o1}`
  const vendNode = `fairs/${eventId}/orders/${vA.vendorId}/${o1}`
  check('Firebase pushed to customer node with status READY', fbWrites.some(w => w.path === custNode && w.data.status === 'READY'), JSON.stringify(fbWrites.map(w => w.path)))
  check('Firebase pushed to vendor node with status READY', fbWrites.some(w => w.path === vendNode && w.data.status === 'READY'))

  const feed1 = await runnerFeed(runner.id, eventId)
  check('order is CLAIMABLE through the real runner-feed query', feed1.some(o => o.id === o1), `feed ids: ${feed1.map(o => o.id).join(',')}`)

  // ════════════════════════════════════════════════════════════════════════
  // S2 — claim (atomic) → RUNNER_COLLECTED → monotonic guard blocks regression
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${CYN}S2 — claim + monotonic guard (no regression)${RESET}`)
  const claim = await db.order.updateMany({ where: { id: o1, runnerId: null }, data: { runnerId: runner.id, dispatchedAt: new Date() } })
  check('atomic claim won exactly one row', claim.count === 1)
  await db.order.update({ where: { id: o1 }, data: { status: 'RUNNER_COLLECTED' } })

  // A LATE vendor write fires the promotion again — it must NOT regress.
  const r1late = await reconcileMasterStatus(o1)
  const s1late = await getStatus(o1)
  check('promotion REFUSED on RUNNER_COLLECTED (guard, no regress)', r1late.wrote === false, JSON.stringify(r1late))
  check('status still RUNNER_COLLECTED (never pulled back to READY)', s1late.status === 'RUNNER_COLLECTED', `got ${s1late.status}`)
  console.log(`  ${DIM}(DELIVERED→earnings accrual is W3's existing, separately-covered path — out of Phase 1 scope)${RESET}`)

  // ════════════════════════════════════════════════════════════════════════
  // S3 — Multi-vendor all-ready gate: claimable only when the LAST vendor ready
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${CYN}S3 — multi-vendor all-ready gate (one runner, one trip)${RESET}`)
  const o3 = await seedOrder(eventId, [vA, vB], 'HOME_DELIVERY', customer.id)
  const r3a = await markVendorReadyViaW4(o3, vA.vendorId)
  const s3a = await getStatus(o3)
  check('vendor A ready → NOT promoted (only 1 of 2)', r3a.wrote === false && s3a.status === 'PLACED', `promoted=${r3a.wrote} status=${s3a.status}`)
  const feed3a = await runnerFeed(runner.id, eventId)
  check('order NOT claimable yet (one vendor still preparing)', !feed3a.some(o => o.id === o3))

  const r3b = await markVendorReadyViaW4(o3, vB.vendorId)
  const s3b = await getStatus(o3)
  check('vendor B ready → NOW promoted (all ready)', r3b.wrote === true && s3b.status === 'READY', `promoted=${r3b.wrote} status=${s3b.status}`)
  const feed3b = await runnerFeed(runner.id, eventId)
  check('order claimable only after the LAST vendor ready', feed3b.some(o => o.id === o3))

  // ════════════════════════════════════════════════════════════════════════
  // S4 — Booth control: promotes READY (honesty) but NOT in the runner feed
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${CYN}S4 — booth-pickup control${RESET}`)
  const o4 = await seedOrder(eventId, [vA], 'BOOTH_PICKUP', customer.id)
  const r4 = await markVendorReadyViaW4(o4, vA.vendorId)
  const s4 = await getStatus(o4)
  check('booth promotes master → READY (booth-honesty win)', r4.wrote === true && s4.status === 'READY', `promoted=${r4.wrote} status=${s4.status}`)
  const job4 = await timeoutJob(o4, JOB_UNCOLLECTED)
  check('booth arms the UNCOLLECTED timeout (not UNDELIVERABLE)', !!job4)
  const feed4 = await runnerFeed(runner.id, eventId)
  check('booth order is NOT in the runner feed (fulfillment filter excludes it)', !feed4.some(o => o.id === o4))

  // ════════════════════════════════════════════════════════════════════════
  // S5 — Mixed event: booth + delivery both ready, only delivery is claimable
  // ════════════════════════════════════════════════════════════════════════
  console.log(`\n${CYN}S5 — mixed event: only delivery is claimable${RESET}`)
  const oDel = await seedOrder(eventId, [vB], 'HOME_DELIVERY', customer.id)
  const oBooth = await seedOrder(eventId, [vB], 'BOOTH_PICKUP', customer.id)
  await markVendorReadyViaW4(oDel, vB.vendorId)
  await markVendorReadyViaW4(oBooth, vB.vendorId)
  const feed5 = await runnerFeed(runner.id, eventId)
  check('delivery order present in feed', feed5.some(o => o.id === oDel))
  check('booth order absent from feed (coexisting, correctly filtered)', !feed5.some(o => o.id === oBooth))

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${pass + fail} checks — ${GRN}${pass} passed${RESET}${fail ? `, ${RED}${fail} failed${RESET}` : ''}`)
  if (fail === 0) {
    console.log(`${GRN}✓ The handoff fires end to end: vendor-all-ready → master READY → real timeout armed →`)
    console.log(`  Firebase pushed → order claimable in the real feed. Wired AND working.${RESET}`)
  } else {
    console.log(`${RED}✗ Something is wired but not working — see failures above.${RESET}`)
  }
}

async function cleanup() {
  const q = getOrderQueue()
  if (q) for (const id of enqueuedJobIds) { await q.getJob(id).then(j => j?.remove()).catch(() => {}) }
  if (seededOrderIds.length) await db.order.deleteMany({ where: { id: { in: seededOrderIds } } }).catch(() => {})
  if (seededRunnerUserId) await db.runner.deleteMany({ where: { userId: seededRunnerUserId } }).catch(() => {})
  if (seededUserIds.length) await db.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {})
  __setRtdbForTest(null)
  await db.$disconnect()
  try { await q?.close() } catch { /* ignore */ }
}

main()
  .catch(e => { console.error(e); fail++ })
  .finally(async () => { await cleanup(); process.exit(fail === 0 ? 0 : 1) })
