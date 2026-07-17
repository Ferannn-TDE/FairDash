/**
 * RUNNER SELF-SERVE ONBOARDING PROOF — real negative tests, not structural assertions.
 *
 * Invokes the REAL route handlers (app/api/drivers POST, app/api/runners/me,
 * app/api/orders/[id]/status, app/api/admin/runners/[id]/approve|reject) with seeded
 * identities, mocking ONLY Clerk auth() / currentUser() (authentication). Every
 * authorization/gate check under test is the real, unmocked route code.
 *
 * Proves the Part-B self-serve flow (runner-less visitor applies → PENDING Runner minted
 * at submit → still gated until admin approval) preserves the Part-A approval gate AND
 * the consent trail, and that a returning APPROVED runner is never silently downgraded.
 *
 *   1. Onboarding + consent trail: auth'd user, no Runner/app → POST /api/drivers with
 *      fairSlug + consent → PENDING Runner minted AND consent-bearing RunnerApplication exists
 *   2. Self-created PENDING runner → go ACTIVE            → 403 RUNNER_NOT_APPROVED
 *   3. Self-created PENDING runner → claim (direct API)   → 403 RUNNER_NOT_APPROVED ← HEADLINE
 *   4. REJECTED runner blocked at BOTH endpoints          → 403
 *   5. APPROVED-but-OFFLINE runner claim                  → 403 RUNNER_NOT_ACTIVE
 *   6. Admin approve flips PENDING→APPROVED; runner then goes ACTIVE AND claims (positive)
 *   7. DELIVERED carve-out: claimed runner who went OFFLINE can STILL mark DELIVERED
 *   8. Grandfather: pre-migration Runner rows were promoted to APPROVED
 *   9. Returning-runner guard: existing APPROVED runner re-submits POST /api/drivers with a
 *      fairSlug → NOT reset (stays APPROVED, no second Runner row) ← create-if-absent guard
 *  10. Onboarding ENTRY guard: existing Runner of ANY status (PENDING/APPROVED/REJECTED) is
 *      bounced from /become-driver to their portal; no-row/anon see the form. Read-only.
 *
 * Run: npx tsx scripts/runner-onboarding-proof.ts   (self-cleaning, prefix ronb-)
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
process.env.REDIS_URL = ''            // DELIVERED payout enqueues become inert no-ops
delete process.env.RATE_LIMIT_TEST    // never trigger any route's test-bypass stub

import { register } from 'node:module'
register('./_clerk-loader.mjs', import.meta.url)  // substitute Clerk before any handler import

import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { resolveOnboardingRedirect } from '../lib/runner-onboarding-guard'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const PFX = 'ronb-'
const MAIL = '@ronb.local'
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
let driversPOST: (req: NextRequest) => Promise<Response>
let statusPATCH: IdHandler
let mePATCH: (req: NextRequest) => Promise<Response>
let adminApprovePATCH: IdHandler
let adminRejectPATCH: IdHandler

async function loadHandlers() {
  driversPOST       = (await import('../app/api/drivers/route')).POST as unknown as (req: NextRequest) => Promise<Response>
  statusPATCH       = (await import('../app/api/orders/[id]/status/route')).PATCH as unknown as IdHandler
  mePATCH           = (await import('../app/api/runners/me/route')).PATCH as unknown as (req: NextRequest) => Promise<Response>
  adminApprovePATCH = (await import('../app/api/admin/runners/[id]/approve/route')).PATCH as unknown as IdHandler
  adminRejectPATCH  = (await import('../app/api/admin/runners/[id]/reject/route')).PATCH as unknown as IdHandler
}

// ── Real-handler call wrappers ────────────────────────────────────────────────
function driverBody(email: string, fairSlug: string | null) {
  return {
    personal: { firstName: 'Ronb', lastName: 'Driver', email, phone: '+15550000000', dob: '1990-01-01', city: 'Testville' },
    vehicle: { type: 'Car', make: 'Toyota', model: 'Camry', year: '2020', color: 'Silver', plate: 'ABC 1234' },
    agreed: true, bgConsent: true, termsVersion: '2026-01-01',
    ...(fairSlug ? { fairSlug } : {}),
  }
}
async function postDrivers(clerkId: string | null, email: string, fairSlug: string | null) {
  login(clerkId)
  const req = new NextRequest('http://t/api/drivers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(driverBody(email, fairSlug)),
  })
  const res = await driversPOST(req)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
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

// ── Seed helpers ──────────────────────────────────────────────────────────────
async function mkUser(role: string) {
  return prisma.user.create({ data: { clerkId: `${PFX}clerk-${rand()}`, email: `${PFX}${role}-${rand()}${MAIL}`, name: `RO ${role}`, role } })
}
async function mkEvent() {
  const ev = await prisma.event.create({ data: { name: `RO ${rand()}`, urlSlug: `${PFX}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' } })
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
      customerName: 'RO Customer', customerPhone: '+10000000000',
      deliveryStreet: '1 Test St', deliveryCity: 'Testville', deliveryZip: '00000',
      stripeChargeId: `ch_${PFX}${rand()}`,
    },
  })
  await prisma.vendorOrderStatus.create({ data: { orderId: order.id, vendorId, status: 'READY' } })
  return order
}

async function cleanup() {
  await prisma.runnerApplication.deleteMany({ where: { email: { endsWith: MAIL } } })
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

const statusOf     = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } }))?.status
const runnerIdOf   = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { runnerId: true } }))?.runnerId ?? null
const approvalOf   = async (runnerId: string) => (await prisma.runner.findUnique({ where: { id: runnerId }, select: { approvalStatus: true } }))?.approvalStatus
const runnerByUser = async (userId: string) => prisma.runner.findUnique({ where: { userId }, select: { id: true, eventId: true, approvalStatus: true, status: true } })

async function main() {
  await loadHandlers()
  await cleanup()
  try {
    const ev = await mkEvent()
    const ven = await mkVendor(ev.id)
    const admin = await prisma.user.create({ data: { clerkId: `${PFX}admin-${rand()}`, email: `${PFX}admin${MAIL}`, name: 'RO Admin', role: 'admin' } })

    // ── 1. ONBOARDING + CONSENT TRAIL ──────────────────────────────────────────
    console.log('\n[1] Auth\'d user (no Runner/app) → POST /api/drivers with fairSlug + consent → PENDING Runner minted + consent-bearing RunnerApplication')
    const newbie = await mkUser('runner')
    const t1 = await postDrivers(newbie.clerkId!, newbie.email, ev.urlSlug)
    assert(t1.status === 201 && t1.json?.data?.runnerMinted === true, `POST /api/drivers → 201 runnerMinted=true (status ${t1.status}, minted ${t1.json?.data?.runnerMinted})`)
    const minted = await runnerByUser(newbie.id)
    assert(!!minted && minted.approvalStatus === 'PENDING' && minted.eventId === ev.id && minted.status === 'OFFLINE',
      `(a) PENDING Runner minted for user+event (approval ${minted?.approvalStatus}, event match ${minted?.eventId === ev.id}, status ${minted?.status})`)
    const consentApp = await prisma.runnerApplication.findFirst({
      where: { userId: newbie.id },
      select: { backgroundCheckConsent: true, termsAgreed: true, termsAcceptedAt: true },
    })
    assert(!!consentApp && consentApp.backgroundCheckConsent === true && consentApp.termsAgreed === true,
      `(b) consent-bearing RunnerApplication exists for user (bgConsent ${consentApp?.backgroundCheckConsent}, termsAgreed ${consentApp?.termsAgreed})`)
    const selfRunnerId = minted!.id

    // ── 2. Self-created PENDING runner cannot go ACTIVE ─────────────────────────
    console.log('\n[2] Self-created PENDING runner PATCH /api/runners/me {status:ACTIVE} → 403 RUNNER_NOT_APPROVED')
    const t2 = await patchMe(newbie.clerkId!, { status: 'ACTIVE' })
    assert(t2.status === 403 && t2.json?.error?.code === 'RUNNER_NOT_APPROVED', `go-online blocked (status ${t2.status}, code ${t2.json?.error?.code})`)

    // ── 3. Self-created PENDING runner cannot claim via direct API ─── HEADLINE ──
    console.log('\n[3] Self-created PENDING runner PATCH /api/orders/:id/status {RUNNER_COLLECTED} (direct API) → 403 RUNNER_NOT_APPROVED')
    const order1 = await mkOrder(ev.id, ven.id)
    const t3 = await patchStatus(newbie.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t3.status === 403 && t3.json?.error?.code === 'RUNNER_NOT_APPROVED', `claim blocked at server (status ${t3.status}, code ${t3.json?.error?.code})`)
    assert(await runnerIdOf(order1.id) === null && await statusOf(order1.id) === 'READY', 'order NOT claimed — still unclaimed READY')

    // ── 4. REJECTED runner blocked at BOTH endpoints ───────────────────────────
    console.log('\n[4] REJECTED runner blocked at BOTH endpoints → 403')
    const rej = await mkRunner(ev.id, 'REJECTED')
    const t4a = await patchMe(rej.user.clerkId!, { status: 'ACTIVE' })
    assert(t4a.status === 403 && t4a.json?.error?.code === 'RUNNER_NOT_APPROVED', `REJECTED go-online → 403 (status ${t4a.status})`)
    const t4b = await patchStatus(rej.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t4b.status === 403 && t4b.json?.error?.code === 'RUNNER_NOT_APPROVED', `REJECTED claim → 403 (status ${t4b.status})`)
    assert(await runnerIdOf(order1.id) === null, 'order STILL unclaimed after REJECTED tried')

    // ── 5. APPROVED but OFFLINE runner claim → 403 RUNNER_NOT_ACTIVE ────────────
    console.log('\n[5] APPROVED-but-OFFLINE runner claim → 403 RUNNER_NOT_ACTIVE (offline-claim hole closed)')
    const offApp = await mkRunner(ev.id, 'APPROVED', 'OFFLINE')
    const t5 = await patchStatus(offApp.user.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t5.status === 403 && t5.json?.error?.code === 'RUNNER_NOT_ACTIVE', `offline-approved claim → 403 RUNNER_NOT_ACTIVE (status ${t5.status}, code ${t5.json?.error?.code})`)
    assert(await runnerIdOf(order1.id) === null, 'order STILL unclaimed after offline-approved tried')

    // ── 6. Admin approve → self-created PENDING→APPROVED → ACTIVE + claim ───────
    console.log('\n[6] Admin approve flips self-created PENDING→APPROVED; runner then goes ACTIVE AND claims (positive path)')
    const t6approve = await adminApprove(admin.clerkId!, selfRunnerId)
    assert(t6approve.status === 200 && t6approve.json?.data?.runner?.approvalStatus === 'APPROVED', `admin approve → 200 APPROVED (status ${t6approve.status})`)
    assert(await approvalOf(selfRunnerId) === 'APPROVED', 'runner.approvalStatus persisted APPROVED')
    const t6online = await patchMe(newbie.clerkId!, { status: 'ACTIVE' })
    assert(t6online.status === 200, `approved runner CAN go ACTIVE (status ${t6online.status})`)
    const t6claim = await patchStatus(newbie.clerkId!, order1.id, { status: 'RUNNER_COLLECTED' })
    assert(t6claim.status === 200, `approved+ACTIVE runner CAN claim (status ${t6claim.status})`)
    assert(await runnerIdOf(order1.id) === selfRunnerId && await statusOf(order1.id) === 'RUNNER_COLLECTED', 'order now claimed + RUNNER_COLLECTED by the self-onboarded runner')

    // ── 7. DELIVERED carve-out — claimed runner who went OFFLINE can still DELIVER
    console.log('\n[7] DELIVERED carve-out: runner claimed then went OFFLINE can STILL mark DELIVERED (ACTIVE gate is claim-only)')
    await prisma.runner.update({ where: { id: selfRunnerId }, data: { status: 'OFFLINE' } })
    const t7 = await patchStatus(newbie.clerkId!, order1.id, { status: 'DELIVERED', proofPath: 'https://ronb.local/proof.jpg' })
    assert(t7.status === 200, `OFFLINE-but-assigned runner CAN mark DELIVERED (status ${t7.status}) — ACTIVE gate did NOT block completion`)
    assert(await statusOf(order1.id) === 'DELIVERED', 'order now DELIVERED (not stranded)')

    // ── 8. Grandfather: pre-migration rows were promoted to APPROVED ────────────
    console.log('\n[8] Grandfather: pre-migration Runner rows promoted to APPROVED (no lockout of existing runners)')
    const grandfathered = await prisma.runner.findMany({ where: { approvedBy: 'system-grandfather' }, select: { approvalStatus: true } })
    assert(grandfathered.length >= 1, `≥1 pre-existing runner was grandfathered (found ${grandfathered.length})`)
    assert(grandfathered.every(r => r.approvalStatus === 'APPROVED'), 'every grandfathered runner is APPROVED (none left PENDING)')

    // ── 9. RETURNING-RUNNER GUARD — existing APPROVED runner not downgraded ─────
    console.log('\n[9] Existing APPROVED runner re-submits POST /api/drivers with fairSlug → NOT reset (stays APPROVED, no 2nd Runner row)')
    const returning = await mkRunner(ev.id, 'APPROVED', 'OFFLINE')
    const beforeCount = await prisma.runner.count({ where: { userId: returning.user.id } })
    const t9 = await postDrivers(returning.user.clerkId!, returning.user.email, ev.urlSlug)
    assert(t9.status === 201 && t9.json?.data?.runnerMinted === false, `re-submit → 201 runnerMinted=false (guard did NOT create) (status ${t9.status}, minted ${t9.json?.data?.runnerMinted})`)
    assert(await approvalOf(returning.runner.id) === 'APPROVED', 'returning runner STILL APPROVED (not downgraded to PENDING)')
    const afterCount = await prisma.runner.count({ where: { userId: returning.user.id } })
    assert(beforeCount === 1 && afterCount === 1, `exactly one Runner row for the user before AND after (before ${beforeCount}, after ${afterCount})`)

    // ── 10. ONBOARDING ENTRY GUARD (Hole 1) — once a Runner row exists (ANY status),
    //        /become-driver bounces the user to their portal before the form renders.
    //        EXISTENCE is the gate, not approval. The layout redirect is a server
    //        component, so we test resolveOnboardingRedirect — the exact decision fn it
    //        calls — plus prove the check is READ-ONLY (never mutates/creates a row).
    console.log('\n[10] Onboarding entry guard: existing Runner (any status) → bounced to portal; no row / anon → form shown')
    const gPending  = await mkRunner(ev.id, 'PENDING')
    const gApproved = await mkRunner(ev.id, 'APPROVED')
    const gRejected = await mkRunner(ev.id, 'REJECTED')
    const gNoRow    = await mkUser('runner')
    const portal    = `/runner/${ev.urlSlug}/dashboard`
    assert(await resolveOnboardingRedirect(gApproved.user.clerkId!) === portal, 'APPROVED runner → bounced to portal (not re-onboarded)')
    assert(await resolveOnboardingRedirect(gPending.user.clerkId!) === portal, 'PENDING runner → bounced to portal (no re-onboard mid-wait)')
    assert(await resolveOnboardingRedirect(gRejected.user.clerkId!) === portal, 'REJECTED runner → bounced (cannot re-onboard away a rejection)')
    assert(await resolveOnboardingRedirect(gNoRow.clerkId!) === null, 'user with NO Runner row → form shown (null)')
    assert(await resolveOnboardingRedirect(null) === null, 'anonymous visitor → form shown (null)')
    assert(
      await approvalOf(gApproved.runner.id) === 'APPROVED' &&
      await approvalOf(gPending.runner.id) === 'PENDING' &&
      await approvalOf(gRejected.runner.id) === 'REJECTED',
      'entry guard is READ-ONLY — no runner status mutated',
    )
    assert(await prisma.runner.count({ where: { userId: gNoRow.id } }) === 0, 'entry guard created NO row for the no-row user')

    console.log(`\n── RESULT: ${pass} passed, ${fail} failed ──`)
  } finally {
    await cleanup()
    console.log('cleanup done (all ronb- rows removed)')
  }
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error('PROOF_ERR', e); cleanup().finally(() => process.exit(1)) })
