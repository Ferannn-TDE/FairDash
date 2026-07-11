/**
 * RUNNER APPROVAL GATE PROOF — real negative tests, not structural assertions.
 *
 * Invokes the REAL route handlers (app/api/runners/me, app/api/orders/[id]/status,
 * app/api/admin/runners/[id]/approve|reject) with seeded identities, mocking ONLY
 * Clerk auth() / currentUser() (authentication). Every authorization/gate check
 * under test is the real, unmocked route code. Proves the approval gate is
 * enforced SERVER-SIDE (a disabled button is not a gate).
 *
 * Proves:
 *   1. PENDING runner cannot go ACTIVE          → 403 RUNNER_NOT_APPROVED
 *   2. PENDING runner cannot claim (direct API) → 403 RUNNER_NOT_APPROVED  ← HEADLINE
 *   3. REJECTED runner blocked at BOTH endpoints → 403
 *   4. APPROVED-but-OFFLINE runner claim         → 403 RUNNER_NOT_ACTIVE
 *   5. Admin approve flips PENDING→APPROVED; runner then goes ACTIVE AND claims (positive)
 *   6. DELIVERED carve-out: a runner who claimed then went OFFLINE can STILL mark DELIVERED
 *   7. Grandfather: pre-migration Runner rows were promoted to APPROVED
 *
 * Run: npx tsx scripts/runner-approval-proof.ts   (self-cleaning, prefix raseed-)
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

const PFX = 'raseed-'
const MAIL = '@raseed.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string | null, publicMetadata?: object) {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata } : undefined
}

// ── Handlers (dynamic import AFTER the loader is registered) ───────────────────
type IdHandler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
let statusPATCH: IdHandler
let mePATCH: (req: NextRequest) => Promise<Response>
let adminApprovePATCH: IdHandler
let adminRejectPATCH: IdHandler

async function loadHandlers() {
  statusPATCH       = (await import('../app/api/orders/[id]/status/route')).PATCH as unknown as IdHandler
  mePATCH           = (await import('../app/api/runners/me/route')).PATCH as unknown as (req: NextRequest) => Promise<Response>
  adminApprovePATCH = (await import('../app/api/admin/runners/[id]/approve/route')).PATCH as unknown as IdHandler
  adminRejectPATCH  = (await import('../app/api/admin/runners/[id]/reject/route')).PATCH as unknown as IdHandler
}

// ── Real-handler call wrappers ────────────────────────────────────────────────
async function patchStatus(clerkId: string, orderId: string, body: object) {
  login(clerkId)
  const req = new NextRequest('http://t/api/orders/x/status', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await statusPATCH(req, { params: Promise.resolve({ id: orderId }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function patchMe(clerkId: string, body: object) {
  login(clerkId)
  const req = new NextRequest('http://t/api/runners/me', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await mePATCH(req)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function adminApprove(adminClerkId: string, runnerId: string) {
  login(adminClerkId, { roles: ['admin'] })
  const res = await adminApprovePATCH(new NextRequest('http://t/api/admin/runners/x/approve', { method: 'PATCH' }), { params: Promise.resolve({ id: runnerId }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function adminReject(adminClerkId: string, runnerId: string, reason: string) {
  login(adminClerkId, { roles: ['admin'] })
  const res = await adminRejectPATCH(new NextRequest('http://t/api/admin/runners/x/reject', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) }), { params: Promise.resolve({ id: runnerId }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${PFX}clerk-${rand()}`, email: `${PFX}${role}-${rand()}${MAIL}`, name: `RA ${role}`, role } })
}
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `RA ${rand()}`, urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
  await prisma.fulfillmentConfig.create({ data: { eventId: ev.id, homeDeliveryEnabled: true, curbsideEnabled: true, homeDeliveryFee: 10, curbsideFee: 4, runnerFeePercent: 50 } })
  return ev
}
async function mkVendor(eventId: string) {
  return prisma.vendor.create({ data: { eventId, name: `V ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
}
async function mkRunner(eventId: string, approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED', status: 'ACTIVE' | 'OFFLINE' = 'OFFLINE') {
  const u = await mkUser('runner')
  const r = await prisma.runner.create({ data: { userId: u.id, eventId, status, approvalStatus } })
  return { runner: r, user: u }
}
async function mkOrder(eventId: string, vendorId: string) {
  const customer = await mkUser('customer')
  const order = await prisma.order.create({
    data: {
      eventId, customerId: customer.id, vendorId, status: 'READY', fulfillmentType: 'HOME_DELIVERY',
      subtotal: 15, fairSynqFee: 1.5, deliveryFee: 10, total: 26.5, vendorPayout: 15,
      customerName: 'RA Customer', customerPhone: '+10000000000',
      deliveryStreet: '1 Test St', deliveryCity: 'Testville', deliveryZip: '00000',
      stripeChargeId: `ch_${PFX}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
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

const statusOf   = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status
const runnerIdOf = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { runnerId: true } }))?.runnerId ?? null
const approvalOf = async (runnerId: string) => (await prisma.runner.findUnique({ where: { id: runnerId }, select: { approvalStatus: true } }))?.approvalStatus

async function main() {
  await loadHandlers()
  await cleanup()
  try {
    const ev = await mkEvent()
    const ven = await mkVendor(ev.id)
    const admin = await prisma.user.create({ data: { clerkId: `${PFX}admin-${rand()}`, email: `${PFX}admin${MAIL}`, name: 'RA Admin', role: 'admin' } })

    // ── 1. PENDING runner cannot go ACTIVE ─────────────────────────────────────
    console.log('\n[1] PENDING runner PATCH /api/runners/me {status:ACTIVE} → 403 RUNNER_NOT_APPROVED')
    const pend = await mkRunner(ev.id, 'PENDING')
    const t1 = await patchMe(pend.user.clerkId!, { status: 'ACTIVE' })
    assert(t1.status === 403 && t1.json?.error?.code === 'RUNNER_NOT_APPROVED', `go-online blocked (status ${t1.status}, code ${t1.json?.error?.code})`)

    // ── 2. PENDING runner cannot claim via direct API ──────────── HEADLINE ────
    console.log('\n[2] PENDING runner PATCH /api/orders/:id/status {RUNNER_COLLECTED} (direct API) → 403 RUNNER_NOT_APPROVED')
    const order1 = await mkOrder(ev.id, ven.id)
    const t2 = await patchStatus(pend.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t2.status === 403 && t2.json?.error?.code === 'RUNNER_NOT_APPROVED', `claim blocked at server (status ${t2.status}, code ${t2.json?.error?.code})`)
    assert(await runnerIdOf(order1.id) === null && await statusOf(order1.id) === 'READY', 'order NOT claimed — still unclaimed READY')

    // ── 3. REJECTED runner blocked at BOTH endpoints ───────────────────────────
    console.log('\n[3] REJECTED runner blocked at BOTH endpoints → 403')
    const rej = await mkRunner(ev.id, 'REJECTED')
    const t3a = await patchMe(rej.user.clerkId!, { status: 'ACTIVE' })
    assert(t3a.status === 403 && t3a.json?.error?.code === 'RUNNER_NOT_APPROVED', `REJECTED go-online → 403 (status ${t3a.status})`)
    const t3b = await patchStatus(rej.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t3b.status === 403 && t3b.json?.error?.code === 'RUNNER_NOT_APPROVED', `REJECTED claim → 403 (status ${t3b.status})`)
    assert(await runnerIdOf(order1.id) === null, 'order STILL unclaimed after REJECTED tried')

    // ── 4. APPROVED but OFFLINE runner claim → 403 RUNNER_NOT_ACTIVE ────────────
    console.log('\n[4] APPROVED-but-OFFLINE runner claim → 403 RUNNER_NOT_ACTIVE (offline-claim hole closed)')
    const offApp = await mkRunner(ev.id, 'APPROVED', 'OFFLINE')
    const t4 = await patchStatus(offApp.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t4.status === 403 && t4.json?.error?.code === 'RUNNER_NOT_ACTIVE', `offline-approved claim → 403 RUNNER_NOT_ACTIVE (status ${t4.status}, code ${t4.json?.error?.code})`)
    assert(await runnerIdOf(order1.id) === null, 'order STILL unclaimed after offline-approved tried')

    // ── 5. Admin approve → PENDING→APPROVED → runner goes ACTIVE AND claims ─────
    console.log('\n[5] Admin approve flips PENDING→APPROVED; runner then goes ACTIVE AND claims (positive path)')
    const t5approve = await adminApprove(admin.clerkId!, pend.runner.id)
    assert(t5approve.status === 200 && t5approve.json?.data?.runner?.approvalStatus === 'APPROVED', `admin approve → 200 APPROVED (status ${t5approve.status})`)
    assert(await approvalOf(pend.runner.id) === 'APPROVED', 'runner.approvalStatus persisted APPROVED')
    // idempotency / guard: a second approve on a non-PENDING runner → 409
    const t5again = await adminApprove(admin.clerkId!, pend.runner.id)
    assert(t5again.status === 409, `re-approve non-PENDING runner → 409 (status ${t5again.status})`)
    const t5online = await patchMe(pend.user.clerkId!, { status: 'ACTIVE' })
    assert(t5online.status === 200, `approved runner CAN go ACTIVE (status ${t5online.status})`)
    const t5claim = await patchStatus(pend.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t5claim.status === 200, `approved+ACTIVE runner CAN claim (status ${t5claim.status})`)
    assert(await runnerIdOf(order1.id) === pend.runner.id && await statusOf(order1.id) === 'RUNNER_COLLECTED', 'order now claimed + RUNNER_COLLECTED by approved runner')

    // ── 6. DELIVERED carve-out — claimed runner who went OFFLINE can still DELIVER
    console.log('\n[6] DELIVERED carve-out: runner claimed then went OFFLINE can STILL mark DELIVERED (ACTIVE gate is claim-only)')
    // simulate "went offline mid-delivery" — flip the runner OFFLINE directly
    await prisma.runner.update({ where: { id: pend.runner.id }, data: { status: 'OFFLINE' } })
    const t6 = await patchStatus(pend.user.clerkId!, order1.id, { status: 'DELIVERED', photoUrl: 'https://raseed.local/proof.jpg' })
    assert(t6.status === 200, `OFFLINE-but-assigned runner CAN mark DELIVERED (status ${t6.status}) — ACTIVE gate did NOT block completion`)
    assert(await statusOf(order1.id) === 'DELIVERED', 'order now DELIVERED (not stranded)')

    // ── 7. Grandfather: pre-migration rows were promoted to APPROVED ────────────
    console.log('\n[7] Grandfather: pre-migration Runner rows promoted to APPROVED (no lockout of existing runners)')
    const grandfathered = await prisma.runner.findMany({ where: { approvedBy: 'system-grandfather' }, select: { approvalStatus: true } })
    assert(grandfathered.length >= 1, `≥1 pre-existing runner was grandfathered (found ${grandfathered.length})`)
    assert(grandfathered.every(r => r.approvalStatus === 'APPROVED'), 'every grandfathered runner is APPROVED (none left PENDING)')

    console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  } finally {
    await cleanup()
    console.log('cleanup done (all raseed- rows removed)')
  }
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('PROOF_ERR', e); cleanup().finally(() => process.exit(1)) })
