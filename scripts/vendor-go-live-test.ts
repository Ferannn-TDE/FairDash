/**
 * VENDOR GO-LIVE CHECK — audit M1, H5 Fix B (decided Nov 12).
 *
 * The organizer status route checked approval and documents only on PENDING → ACTIVE, so
 * PENDING → PAUSED → ACTIVE (or REJECTED → ACTIVE) put a booth that was never approved live. Now
 * EVERY organizer or admin move into ACTIVE needs the booth approved for its event AND the go-live
 * checklist complete: documents, a sellable menu item, payouts, a booth number
 * (lib/vendor-go-live.ts). One approval: REQUIRE_PLATFORM_ACCOUNT_APPROVAL is false.
 *
 *   [1] the bypass: an organizer moves a PENDING booth to PAUSED, then tries ACTIVE → 409, missing
 *       "Application approved"; status unchanged
 *   [2] an approved PAUSED booth missing ONE checklist item at a time → 409 naming exactly that
 *       item; with everything done → 200 ACTIVE
 *   [3] approval recognised from either record: a FairSynq ApprovalAction, or an organizer-logged
 *       PENDING → ACTIVE change; SUSPENDED → ACTIVE when approved and complete → 200.
 *       REJECTED → ACTIVE is a re-approval since Nov 16 (full approval path, Stripe asked fresh)
 *   [4] a booth number sent in the same PATCH counts toward the checklist
 *   [5] REQUIRE_PLATFORM_ACCOUNT_APPROVAL: false today; with it on, an organizer-logged approval
 *       alone is not enough and a FairSynq record is
 *   [6] a VENDOR's own pause and resume (busy, offline) still work on a booth that fails the
 *       checklist, and Vendor.status never changes
 *   [7] moving a booth OUT of ACTIVE (pause, suspend) is never gated
 *
 * FairSynq's approve (decideVendor) runs the same check; scripts/approvals-test.ts covers it.
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/vendor-go-live-test.ts
 * Self-cleaning, prefix vgl-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.SLACK_WEBHOOK_URL

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'vgl-'
const MAIL = '@vgl.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
}
function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
type Body = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: { missing?: string[] } } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const DOCS = { foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf' }

async function main() {
  console.log('\n══ VENDOR GO-LIVE CHECK (M1, H5 Fix B) ══')
  await cleanup()

  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' } })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'Organizer' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const event = await prisma.event.create({
    data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: org.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) },
  })

  /** A booth with the checklist complete unless an item is turned off. */
  const mkVendor = async (status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'REJECTED',
    opts: { docs?: boolean; menu?: boolean; payouts?: boolean; booth?: boolean } = {}) => {
    const user = await prisma.user.create({ data: { clerkId: `${PFX}v-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Operator', role: 'vendor' } })
    const vendor = await prisma.vendor.create({
      data: {
        eventId: event.id, name: `${PFX}booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status,
        ...(opts.docs !== false && DOCS),
        stripeVerified: opts.payouts !== false,
        ...(opts.booth !== false && { boothNumber: 'A1' }),
        vendorMembers: { create: { userId: user.id, role: 'owner', approvalStatus: 'APPROVED' } },
        ...(opts.menu !== false && { menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } } }),
      },
    })
    return { vendor, user }
  }
  const approveByFairSynq = (vendorId: string) => prisma.approvalAction.create({
    data: { action: 'APPROVE', applicationType: 'vendor', applicationId: vendorId, actorId: `${PFX}admin`, actorType: 'admin' },
  })
  const approveByOrganizerLog = (vendorId: string) => prisma.vendorAuditLog.create({
    data: { vendorId, userId: orgUser.id, action: 'VENDOR_STATUS_CHANGED', metadata: { previousStatus: 'PENDING', newStatus: 'ACTIVE', reason: null } },
  })
  const statusOf = async (id: string) => (await prisma.vendor.findUnique({ where: { id }, select: { status: true } }))!.status

  const orgPATCH = (await import('../app/api/organizer/vendors/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>
  const setStatus = async (id: string, body: Record<string, unknown>) => {
    login(orgUser.clerkId)
    const res = await orgPATCH(jsonReq(`/api/organizer/vendors/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) })
    return { status: res.status, body: await bodyOf(res) }
  }

  // ── [1] the bypass ──────────────────────────────────────────────────────────────────────────
  console.log('\n[1] PENDING → PAUSED → ACTIVE no longer puts an unapproved booth live')
  {
    const { vendor } = await mkVendor('PENDING')
    const paused = await setStatus(vendor.id, { status: 'PAUSED' })
    assert(paused.status === 200 && await statusOf(vendor.id) === 'PAUSED', `[0] setup: the organizer can move a PENDING booth to PAUSED (got ${paused.status})`)
    const live = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(live.status === 409 && live.body.error?.code === 'VENDOR_NOT_READY_TO_GO_LIVE'
      && JSON.stringify(live.body.error?.details?.missing) === JSON.stringify(['Application approved']),
    `PAUSED → ACTIVE with no approval record → 409, missing only "Application approved" (got ${live.status} ${JSON.stringify(live.body.error?.details?.missing)})`)
    assert(await statusOf(vendor.id) === 'PAUSED', 'and the booth stays PAUSED')
  }

  // ── [2] each checklist item ─────────────────────────────────────────────────────────────────
  console.log('\n[2] an approved booth missing one checklist item at a time')
  const cases: Array<[string, Parameters<typeof mkVendor>[1], string]> = [
    ['documents', { docs: false }, 'Upload documents'],
    ['menu', { menu: false }, 'Add your menu'],
    ['payouts', { payouts: false }, 'Connect payouts'],
    ['booth number', { booth: false }, 'Set booth number'],
  ]
  for (const [what, opts, label] of cases) {
    const { vendor } = await mkVendor('PAUSED', opts)
    await approveByFairSynq(vendor.id)
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(r.status === 409 && JSON.stringify(r.body.error?.details?.missing) === JSON.stringify([label]) && await statusOf(vendor.id) === 'PAUSED',
      `no ${what} → 409 naming only "${label}", still PAUSED (got ${r.status} ${JSON.stringify(r.body.error?.details?.missing)})`)
  }
  {
    // A sold-out or removed item is not a sellable menu.
    const { vendor } = await mkVendor('PAUSED', { menu: false })
    await approveByFairSynq(vendor.id)
    await prisma.menuItem.create({ data: { vendorId: vendor.id, name: 'Gone', price: 5, category: 'Mains', removedAt: new Date() } })
    await prisma.menuItem.create({ data: { vendorId: vendor.id, name: 'Sold out', price: 5, category: 'Mains', isAvailable: false } })
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(r.status === 409 && JSON.stringify(r.body.error?.details?.missing) === JSON.stringify(['Add your menu']),
      'only removed and sold-out items → still "Add your menu"')
  }
  {
    const { vendor } = await mkVendor('PAUSED')
    await approveByFairSynq(vendor.id)
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(r.status === 200 && await statusOf(vendor.id) === 'ACTIVE', `[0] approved and complete: lifting the pause → 200 ACTIVE (got ${r.status} ${r.body.error?.message ?? ''})`)
  }

  // ── [3] approval records ────────────────────────────────────────────────────────────────────
  console.log('\n[3] approval is recognised from either record; neither means re-approval')
  {
    const { vendor } = await mkVendor('SUSPENDED')
    await approveByOrganizerLog(vendor.id)
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(r.status === 200 && await statusOf(vendor.id) === 'ACTIVE',
      `an organizer-logged PENDING → ACTIVE counts: lifting a suspension → 200 (got ${r.status})`)
  }
  {
    // Since Jordan's Nov 16 decision REJECTED → ACTIVE is a re-approval: the full approval path
    // (lib/approvals.ts reconsiderVendor), so it does not ask for an earlier approval record; it asks
    // Stripe fresh. This booth has no Stripe account linked → refused, still REJECTED, no record.
    // scripts/vendor-approver-test.ts covers the re-approval itself.
    const { vendor } = await mkVendor('REJECTED')
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    const records = await prisma.approvalAction.count({ where: { applicationId: vendor.id } })
    assert(r.status === 409 && r.body.error?.code === 'VENDOR_STRIPE_NOT_LINKED' && await statusOf(vendor.id) === 'REJECTED' && records === 0,
      `REJECTED → ACTIVE (re-approve) with no Stripe account → 409 VENDOR_STRIPE_NOT_LINKED, still REJECTED, no record (got ${r.status} ${r.body.error?.code})`)
  }
  {
    // An unrelated status change in the log (PAUSED → ACTIVE) is not an approval.
    const { vendor } = await mkVendor('PAUSED')
    await prisma.vendorAuditLog.create({
      data: { vendorId: vendor.id, userId: orgUser.id, action: 'VENDOR_STATUS_CHANGED', metadata: { previousStatus: 'PAUSED', newStatus: 'ACTIVE' } },
    })
    const r = await setStatus(vendor.id, { status: 'ACTIVE' })
    assert(r.status === 409, `a logged PAUSED → ACTIVE is not an approval record → 409 (got ${r.status})`)
  }

  // ── [4] booth number in the same PATCH ──────────────────────────────────────────────────────
  console.log('\n[4] a booth number sent with the status counts')
  {
    const { vendor } = await mkVendor('PAUSED', { booth: false })
    await approveByFairSynq(vendor.id)
    const r = await setStatus(vendor.id, { status: 'ACTIVE', boothNumber: 'B9' })
    const after = await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { status: true, boothNumber: true } })
    assert(r.status === 200 && after?.status === 'ACTIVE' && after.boothNumber === 'B9', `ACTIVE + boothNumber "B9" in one PATCH → 200 (got ${r.status})`)
  }

  // ── [5] the switch ──────────────────────────────────────────────────────────────────────────
  console.log('\n[5] REQUIRE_PLATFORM_ACCOUNT_APPROVAL, both settings')
  {
    const { REQUIRE_PLATFORM_ACCOUNT_APPROVAL, vendorGoLiveRefusal } = await import('../lib/vendor-go-live')
    assert(REQUIRE_PLATFORM_ACCOUNT_APPROVAL === false, 'decided Nov 12: one approval, the switch is false')
    const { vendor } = await mkVendor('PAUSED')
    await approveByOrganizerLog(vendor.id)
    const v = await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } })
    const off = await vendorGoLiveRefusal(prisma, v, { requirePlatformAccountApproval: false })
    const on = await vendorGoLiveRefusal(prisma, v, { requirePlatformAccountApproval: true })
    assert(off === null, 'switch off: the organizer\'s approval is enough')
    assert(on !== null && JSON.stringify(on.missing) === JSON.stringify(['approval']), 'switch on: an organizer-logged approval alone is NOT enough')
    await approveByFairSynq(vendor.id)
    assert(await vendorGoLiveRefusal(prisma, v, { requirePlatformAccountApproval: true }) === null,
      'switch on: with a FairSynq approval record it is enough')
  }

  // ── [6] the vendor's own pause ──────────────────────────────────────────────────────────────
  console.log('\n[6] a vendor\'s own pause and resume are never blocked by the check')
  {
    // ACTIVE booth that FAILS the checklist (no menu, no payouts) and has no approval record.
    const { vendor, user } = await mkVendor('ACTIVE', { menu: false, payouts: false })
    const vendorPATCH = (await import('../app/api/vendors/[id]/route')).PATCH as unknown as
      (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>
    const own = async (body: Record<string, unknown>) => {
      login(user.clerkId)
      return (await vendorPATCH(jsonReq(`/api/vendors/${vendor.id}`, 'PATCH', body), { params: Promise.resolve({ id: vendor.id }) })).status
    }
    const busy = await own({ isBusy: true })
    const busyRow = await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { isBusy: true, busyUntil: true, status: true } })
    assert(busy === 200 && busyRow?.isBusy === true && !!busyRow.busyUntil && busyRow.busyUntil > new Date() && busyRow.status === 'ACTIVE',
      `vendor pauses (busy, auto-resume time set) → 200, status still ACTIVE (got ${busy})`)
    const resume = await own({ isBusy: false })
    const offline = await own({ isOffline: true })
    const online = await own({ isOffline: false })
    const after = await prisma.vendor.findUnique({ where: { id: vendor.id }, select: { isBusy: true, isOffline: true, status: true } })
    assert(resume === 200 && offline === 200 && online === 200 && after?.isBusy === false && after.isOffline === false && after.status === 'ACTIVE',
      `vendor resumes, goes offline and back online → all 200, status never changes (got ${resume}/${offline}/${online})`)
    const statusAttempt = await own({ status: 'PAUSED' })
    assert(statusAttempt === 200 && await statusOf(vendor.id) === 'ACTIVE', '[0] control: a vendor cannot change its own status at all (the field is ignored)')
  }

  // ── [7] moving out of ACTIVE ────────────────────────────────────────────────────────────────
  console.log('\n[7] pausing or suspending a live booth is never gated')
  {
    const { vendor } = await mkVendor('ACTIVE', { menu: false, payouts: false, docs: false })
    const p = await setStatus(vendor.id, { status: 'PAUSED' })
    const s = await setStatus(vendor.id, { status: 'SUSPENDED', reason: 'Health inspection' })
    assert(p.status === 200 && s.status === 200 && await statusOf(vendor.id) === 'SUSPENDED',
      `an incomplete ACTIVE booth can be paused and suspended (got ${p.status}/${s.status})`)
  }
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
