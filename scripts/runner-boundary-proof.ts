/**
 * RUNNER BOUNDARY PROOF — a real negative test, not a structural assertion.
 *
 * Seeds two fairs (A, B), three runners (A1, A2 on fair A; B on fair B), a plain
 * non-runner user, and delivery orders. Then it invokes the REAL route handlers
 * (app/api/orders/[id]/status, /api/runners/me/orders, /api/runners/me/earnings)
 * with each identity, mocking ONLY Clerk auth() (authentication), and asserts the
 * authorization outcomes at the HTTP-status level.
 *
 * Proves:
 *   A. "me" routes isolate      — runner B cannot read runner A's orders/earnings.
 *   B. shared claim/deliver     — the crux: a runner cannot claim/deliver an order
 *                                 outside their fair, or one owned by another runner.
 *   C. non-runner blocked       — a user with no Runner row cannot claim.
 *   D. within-fair PII scoping  — a runner cannot fetch another runner's active
 *                                 delivery detail by orderId.
 *   (+) positive controls       — the legit runner's own claim & deliver DO succeed.
 *
 * Run: npx tsx --import ./scripts/_clerk-register.mjs scripts/runner-boundary-proof.ts
 * Self-cleaning (prefix rbseed-). Touches only seeded rows.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''            // DELIVERED payout enqueues become inert no-ops
delete process.env.RATE_LIMIT_TEST    // never trigger the route's test-bypass stub

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)  // substitute Clerk before any handler import

import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const PFX = 'rbseed-'
const MAIL = '@rbseed.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * Assert a rejection happened FOR THE RIGHT REASON.
 *
 * THE BUG THIS PREVENTS. Asserting only `status === 403` cannot tell a boundary violation
 * apart from any other refusal. When the runner-approval gate shipped, every runner in this
 * proof was left PENDING — so "runner B cannot claim an order in fair A" passed with a 403
 * that said RUNNER_NOT_APPROVED. B never reached the cross-fair check at all. The assertion
 * was green and the property was untested.
 *
 * Checking the CODE makes that class of false-green structurally impossible: a 403 for the
 * wrong reason now FAILS the assertion instead of quietly satisfying it.
 */
function assertRejected(
  res: { status: number; json: any },
  expectStatus: number,
  expectCode: string,
  label: string,
) {
  const code = res.json?.error?.code ?? '(none)'
  const ok = res.status === expectStatus && code === expectCode
  assert(ok, `${label} → ${expectStatus} ${expectCode} (got ${res.status} ${code})`)
}

function login(clerkId: string | null) { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId } : undefined }

// ── Handlers (dynamic import AFTER the loader is registered) ───────────────────
type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let statusPATCH: Handler
let ordersGET: (req: NextRequest) => Promise<Response>
let earningsGET: () => Promise<Response>

async function loadHandlers() {
  statusPATCH  = (await import('../app/api/orders/[id]/status/route')).PATCH as unknown as Handler
  ordersGET    = (await import('../app/api/runners/me/orders/route')).GET as unknown as (req: NextRequest) => Promise<Response>
  earningsGET  = (await import('../app/api/runners/me/earnings/route')).GET as unknown as () => Promise<Response>
}

// ── Real-handler call wrappers ────────────────────────────────────────────────
async function patchStatus(clerkId: string, orderId: string, body: object) {
  login(clerkId)
  const req = new NextRequest('http://t/api/orders/x/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await statusPATCH(req, { params: Promise.resolve({ id: orderId }) })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
async function getOrders(clerkId: string, orderId?: string) {
  login(clerkId)
  const url = orderId ? `http://t/api/runners/me/orders?orderId=${orderId}` : 'http://t/api/runners/me/orders'
  const res = await ordersGET(new NextRequest(url))
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
async function getEarnings(clerkId: string) {
  login(clerkId)
  const res = await earningsGET()
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${PFX}clerk-${rand()}`, email: `${PFX}${role}-${rand()}${MAIL}`, name: `RB ${role}`, role } })
}
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `RB ${rand()}`, urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, curbsideEnabled: true, homeDeliveryFee: 10, curbsideFee: 4, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) {
  return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
}
/**
 * Runners default to approvalStatus PENDING. This proof is about the BOUNDARY (can runner A
 * reach runner B's data, or another fair's order), so its runners must be APPROVED —
 * otherwise every request 403s on the approval gate and the boundary is never exercised.
 * That is exactly what had happened: the gate shipped, this seed didn't follow, and the
 * cross-fair assertions were "passing" on the WRONG 403. See the assertCode() note below.
 */
async function mkRunner(eventId: string, approvalStatus: 'APPROVED' | 'PENDING' = 'APPROVED') {
  const u = await mkUser('runner')
  const r = await prisma.runner.create({
    data: { userId: u.id, eventId, status: 'ACTIVE', approvalStatus },
  })
  return { runner: r, user: u }
}
async function mkOrder(eventId: string, vendorId: string, status: 'READY' = 'READY') {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status, fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, total: 26.5, vendorPayout: 15,
      customerName: 'RB Customer', customerPhone: '+10000000000',
      deliveryStreet: '1 Test St', deliveryCity: 'Testville', deliveryZip: '00000',
      stripeChargeId: `ch_${PFX}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status } })
  return order
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const orders = await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const oids = orders.map(o => o.id)
    if (oids.length) {
      await prisma.runnerEarning.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.organizerEarning.deleteMany({ where: { orderId: { in: oids } } }).catch(() => {})
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
    }
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.runner.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const runnerIdOf = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { runnerId: true } }))?.runnerId ?? null
const statusOf   = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status

async function main() {
  await loadHandlers()
  await cleanup()
  try {
    // ── Seed: two fairs, three runners, one non-runner ─────────────────────────
    const evA = await mkEvent(), evB = await mkEvent()
    const venA = await mkVendor(evA.id), venB = await mkVendor(evB.id)
    // APPROVED — otherwise every request below 403s on the approval gate and the boundary
    // is never reached. (That is precisely what had happened; see assertRejected().)
    const A1 = await mkRunner(evA.id)   // fair A, will be the legit owner
    const A2 = await mkRunner(evA.id)   // fair A, a DIFFERENT runner
    const B  = await mkRunner(evB.id)   // fair B
    const pendingA = await mkRunner(evA.id, 'PENDING') // fair A, NOT yet approved
    const plain = await mkUser('customer') // authenticated, but NO Runner row
    const orderA = await mkOrder(evA.id, venA.id) // READY, unclaimed, fair A
    const orderB = await mkOrder(evB.id, venB.id) // READY, unclaimed, fair B (B's own)

    // ── G. APPROVAL GATE: an unapproved runner cannot act at all ────────────────
    // This property used to be tested only BY ACCIDENT — every runner in this proof was
    // PENDING, so the gate fired on requests that were meant to probe the fair boundary.
    // Now it is asserted deliberately, on its own runner, so the boundary tests can be
    // approved AND the gate keeps its coverage. The accident becomes real coverage.
    console.log('\n[G] a PENDING (unapproved) runner cannot claim — the approval gate')
    const g1 = await patchStatus(pendingA.user.clerkId!, orderA.id, { status: 'RUNNER_COLLECTED' })
    assertRejected(g1, 403, 'RUNNER_NOT_APPROVED', 'unapproved runner claim')
    assert(await runnerIdOf(orderA.id) === null, 'orderA still unclaimed after the unapproved runner tried')

    // ── C. non-runner cannot claim ─────────────────────────────────────────────
    console.log('\n[C] a signed-in user with NO Runner row cannot claim')
    const c1 = await patchStatus(plain.clerkId!, orderA.id, { status: 'RUNNER_COLLECTED' })
    assert(c1.status === 403, `non-runner claim → 403 (got ${c1.status})`)
    assert(await runnerIdOf(orderA.id) === null, 'orderA still unclaimed')
    const c2 = await getOrders(plain.clerkId!)
    assert(c2.status === 404, `non-runner GET /me/orders → 404 RUNNER_NOT_FOUND (got ${c2.status})`)

    // ── B (crux) 1: cross-fair claim blocked ───────────────────────────────────
    // B is APPROVED, and we assert the CODE — so this can only pass if B was stopped by the
    // FAIR BOUNDARY, not by the approval gate. That distinction is the whole point of the
    // test, and it is what the old status-only assertion could not make.
    console.log('\n[B1] runner B (fair B) CANNOT claim an order in fair A')
    const b1 = await patchStatus(B.user.clerkId!, orderA.id, { status: 'RUNNER_COLLECTED' })
    assert(b1.status === 403, `cross-fair claim → 403 (got ${b1.status})`)
    assert(b1.json?.error?.code !== 'RUNNER_NOT_APPROVED',
      `…and NOT because B was unapproved — the 403 is the FAIR BOUNDARY (code ${b1.json?.error?.code})`)
    assert(await runnerIdOf(orderA.id) === null, 'orderA STILL unclaimed after B tried')

    // ── positive control: the legit fair-A runner CAN claim ────────────────────
    console.log('\n[+] runner A1 (fair A) CAN claim orderA (positive control)')
    const p1 = await patchStatus(A1.user.clerkId!, orderA.id, { status: 'RUNNER_COLLECTED' })
    assert(p1.status === 200, `A1 claim → 200 (got ${p1.status})`)
    assert(await runnerIdOf(orderA.id) === A1.runner.id, 'orderA.runnerId == A1')
    assert(await statusOf(orderA.id) === 'RUNNER_COLLECTED', 'orderA now RUNNER_COLLECTED')

    // ── B2: same-fair OTHER runner cannot re-claim a taken order ───────────────
    console.log('\n[B2] runner A2 (same fair) CANNOT re-claim A1’s order')
    const b2 = await patchStatus(A2.user.clerkId!, orderA.id, { status: 'RUNNER_COLLECTED' })
    assert(b2.status === 409, `re-claim taken order → 409 (got ${b2.status})`)
    assert(await runnerIdOf(orderA.id) === A1.runner.id, 'orderA still owned by A1')

    // ── B3: same-fair OTHER runner cannot DELIVER A1's order ───────────────────
    console.log('\n[B3] runner A2 CANNOT mark A1’s order delivered')
    const b3 = await patchStatus(A2.user.clerkId!, orderA.id, { status: 'DELIVERED', proofPath: 'https://rbseed.local/p.jpg' })
    // The CODE matters: A2 must be refused for OWNERSHIP, not for approval.
    assertRejected(b3, 403, 'NOT_YOUR_DELIVERY', 'A2 deliver A1’s order')
    assert(await statusOf(orderA.id) === 'RUNNER_COLLECTED', 'orderA NOT delivered by A2')

    // ── B4: cross-fair runner cannot DELIVER either ────────────────────────────
    console.log('\n[B4] runner B (fair B) CANNOT deliver a fair-A order')
    const b4 = await patchStatus(B.user.clerkId!, orderA.id, { status: 'DELIVERED', proofPath: 'https://rbseed.local/p.jpg' })
    assert(b4.status === 403, `cross-fair deliver → 403 (got ${b4.status})`)
    assert(b4.json?.error?.code !== 'RUNNER_NOT_APPROVED',
      `…and NOT because B was unapproved — the 403 is the FAIR BOUNDARY (code ${b4.json?.error?.code})`)
    assert(await statusOf(orderA.id) === 'RUNNER_COLLECTED', 'orderA STILL not delivered')

    // ── positive control: A1 delivers its own order ────────────────────────────
    console.log('\n[+] runner A1 CAN deliver its own order (positive control)')
    const p2 = await patchStatus(A1.user.clerkId!, orderA.id, { status: 'DELIVERED', proofPath: 'https://rbseed.local/p.jpg' })
    assert(p2.status === 200, `A1 deliver → 200 (got ${p2.status}) ${JSON.stringify(p2.json).slice(0,120)}`)
    assert(await statusOf(orderA.id) === 'DELIVERED', 'orderA now DELIVERED')

    // ── A. "me" routes isolate reads ───────────────────────────────────────────
    console.log('\n[A] "me" read routes isolate by session, never leak another runner')
    const eaA1 = await getEarnings(A1.user.clerkId!)   // A1 just delivered → should have earnings
    const eaB  = await getEarnings(B.user.clerkId!)     // B delivered nothing → zero
    assert((eaA1.json?.data?.trackedTotal ?? 0) > 0 && (eaA1.json?.data?.deliveriesToday ?? 0) >= 1, `A1 sees own tracked earnings (trackedTotal=${eaA1.json?.data?.trackedTotal}, today=${eaA1.json?.data?.deliveriesToday})`)
    assert((eaB.json?.data?.trackedTotal ?? -1) === 0 && (eaB.json?.data?.totalDeliveries ?? -1) === 0, 'B sees ZERO — none of A1’s earnings leak')
    const ordB = await getOrders(B.user.clerkId!)
    const bSeesFairA = (ordB.json?.data?.orders ?? []).some((o: any) => o.eventId === evA.id || o.id === orderA.id)
    assert(!bSeesFairA, 'B’s order feed contains NO fair-A orders')

    // ── D. within-fair PII: A2 fetching A1's active-delivery detail by id ──────
    console.log('\n[D] runner A2 fetching A1’s order detail by ?orderId=')
    // reset orderA to an active (RUNNER_COLLECTED, owned by A1) state for this probe
    await prisma.order.update({ where: { id: orderA.id }, data: { status: 'RUNNER_COLLECTED' } })
    const d1 = await getOrders(A2.user.clerkId!, orderA.id)
    const leaked = d1.status === 200 && !!(d1.json?.data?.order)
    assert(!leaked, `A2 canNOT read A1’s order detail (status ${d1.status}) — no cross-runner PII`)
    // positive control: A1 CAN read its own
    const d2 = await getOrders(A1.user.clerkId!, orderA.id)
    assert(d2.status === 200 && !!d2.json?.data?.order, 'A1 CAN read its own order detail (flow intact)')

    // A FAILING RUN MUST NOT BE READABLE AS A PASSING ONE.
    //
    // The old summary was `RESULT: 10 passed, 11 failed` — honest, but it CONTAINS the
    // substring "10 passed", and a grep looking for "N passed" happily reported this suite
    // green while 11 assertions were on the floor. That is how a broken security proof went
    // unnoticed. So on failure we do not emit a "passed" count at all: the summary says
    // SUITE FAILED and nothing else can be mistaken for success.
    if (fail === 0) {
      console.log(`\n── RESULT: ${pass} passed, 0 failed ──`)
    } else {
      console.log(`\n── ❌ SUITE FAILED — ${fail} assertion(s) failed (of ${pass + fail}) ──`)
      console.log('── DO NOT read this run as green. Exit code 1. ──')
    }
  } finally {
    await cleanup()
    console.log('cleanup done (all rbseed- rows removed)')
  }
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('PROOF_ERR', e); cleanup().finally(() => process.exit(1)) })
