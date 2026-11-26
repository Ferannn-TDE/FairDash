/**
 * APPROVALS FRONT DOOR (Jordan, Nov 25) — real routes and lib, test DB, Clerk mocked, Stripe
 * stubbed through the seam (never called).
 *
 * On Nov 25 every live decision was made on the Organizers and Booth Operators pages, whose routes
 * change status only: no ApprovalAction, no applicant email. Now PENDING applications are decided
 * ONLY on the Approvals page, and the old routes refuse them.
 *
 *   AF1–AF4  The Approvals route: approve / reject, vendor / organizer → exactly ONE decision email
 *            (Notification) and ONE ApprovalAction each (controls: these pass on the old code too)
 *   AF5      Owner already REJECTED, booth PENDING (the Nov 25 live rows): approve → 409
 *            OWNER_REJECTED with the new text, nothing changed; reject → one email + one record
 *   AF6–AF7  Organizers approve / reject on a PENDING organizer → 409 DECIDE_IN_APPROVALS, nothing
 *   AF8      …already-decided organizers: re-decisions still work there (no email, as before)
 *   AF9–AF10 Booth Operators approve / reject on the owner of a PENDING booth (fair with and without
 *            an organizer) → 409 DECIDE_IN_APPROVALS, nothing
 *   AF11     …a team member on an ACTIVE booth: approve and reject work as today
 *   AF12     …the owner of an ACTIVE booth (a person re-decision): works as today
 *
 * BITE: the 409 code and text are literal strings here (not imported from the new
 * lib/approvals-front-door.ts), so on the old code each missing piece fails its own row instead
 * of crashing the file.
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/approvals-front-door-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'
import { EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'afd-'
const MAIL = '@afd.local'
const rand = () => Math.random().toString(36).slice(2, 8)

const DECIDE_CODE = 'DECIDE_IN_APPROVALS'
const DECIDE_TEXT = 'Pending applications are decided on the Approvals page.'
const OWNER_REJECTED_TEXT = "The owner was rejected separately, so this booth can't be approved yet. You can reject it here."

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
type Who = { id: string; roles: string[]; fullName?: string }
const login = (who: Who | null) => {
  (globalThis as unknown as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = who
    ? { userId: who.id, publicMetadata: { roles: who.roles }, fullName: who.fullName }
    : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
interface CallJson { error?: { code?: string; message?: string }; data?: unknown }
async function call(p: Promise<Response>) {
  const r = await p
  let j: CallJson = {}
  try { j = await r.json() as CallJson } catch { /* not JSON */ }
  return { status: r.status, code: j?.error?.code, message: j?.error?.message, data: j?.data }
}
const refusedToApprovals = (r: { status: number; code?: string; message?: string }) =>
  r.status === 409 && r.code === DECIDE_CODE && r.message === DECIDE_TEXT

const SUPER: Who = { id: `${PFX}super`, roles: ['super_admin'], fullName: 'Sam Super' }
const PM: Who = { id: `${PFX}pm`, roles: ['platform_manager'], fullName: 'Pat Manager' }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    if (vids.length) {
      await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
      await prisma.notification.deleteMany({ where: { OR: vids.map(v => ({ dedupeKey: { contains: v } })) } })
      await prisma.payeeNotice.deleteMany({ where: { payeeId: { in: vids } } })
      await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
      await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
      await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    }
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  const orgs = (await prisma.fairOrganizer.findMany({ where: { contactEmail: { endsWith: MAIL } }, select: { id: true } })).map(o => o.id)
  if (orgs.length) {
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: orgs } } })
    await prisma.notification.deleteMany({ where: { OR: orgs.map(o => ({ dedupeKey: { contains: o } })) } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const payouts = await import('../lib/vendor-payouts-check')
  payouts.__setStripePayoutsStatusForTest(async () => ({ readyToReceivePayments: true, payoutsEnabled: true }))

  await prisma.user.create({ data: { clerkId: SUPER.id, email: `super${MAIL}`, name: 'Super' } })
  await prisma.user.create({ data: { clerkId: PM.id, email: `pm${MAIL}`, name: 'PM' } })
  const ownerOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  const fsEv = await prisma.event.create({ data: { name: `${PFX}FS Fair`, urlSlug: `${PFX}fs-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const orgEv = await prisma.event.create({ data: { name: `${PFX}Org Fair`, urlSlug: `${PFX}org-${rand()}`, status: EventStatus.UPCOMING, organizerId: ownerOrg.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  // A complete booth (documents, payouts, booth number, menu), so an approval can go through.
  const mkBooth = async (opts: { eventId?: string; status?: VendorStatus; ownerStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {}) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: opts.eventId ?? fsEv.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: opts.status ?? VendorStatus.PENDING,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`,
        foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf', boothNumber: 'A1',
        stripeVerified: true, stripeAccountId: `acct_${PFX}${rand()}`,
        vendorMembers: { create: { userId: u.id, role: 'owner', approvalStatus: opts.ownerStatus ?? 'PENDING', ...(opts.ownerStatus === 'REJECTED' && { rejectionReason: 'Earlier no' }) } },
        menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } },
      },
      include: { vendorMembers: true },
    })
    return { vendor: v, ownerId: v.vendorMembers[0].id }
  }
  const mkOrg = async (approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    prisma.fairOrganizer.create({ data: { name: `${PFX}Org ${rand()}`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus, ...(approvalStatus === 'REJECTED' && { rejectionReason: 'Earlier no' }) } })

  /** Decision emails and decision records for one application. */
  const trail = async (applicationId: string) => {
    const mails = await prisma.notification.findMany({ where: { audience: 'applicant', dedupeKey: { contains: applicationId } }, select: { template: true } })
    const actions = await prisma.approvalAction.findMany({ where: { applicationId, action: { in: ['APPROVE', 'REJECT'] } }, select: { action: true } })
    return { mails: mails.map(m => m.template), actions: actions.map(a => a.action) }
  }
  const boothState = async (vendorId: string, memberId: string) => {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } })
    const m = await prisma.vendorMember.findUnique({ where: { id: memberId }, select: { approvalStatus: true, rejectionReason: true } })
    const t = await trail(vendorId)
    return `${v?.status}|${m?.approvalStatus}|${t.mails.length}|${t.actions.length}`
  }
  const orgState = async (id: string) => {
    const o = await prisma.fairOrganizer.findUnique({ where: { id }, select: { approvalStatus: true } })
    const t = await trail(id)
    return `${o?.approvalStatus}|${t.mails.length}|${t.actions.length}`
  }

  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const decide = (who: Who, kind: string, id: string, body: object) => {
    login(who); return call(decideRoute(req(`/api/admin/approvals/${kind}/${id}`, 'POST', body), { params: Promise.resolve({ kind, id }) }))
  }
  const orgApproveH = (await import('../app/api/admin/organizers/[id]/approve/route')).POST
  const orgRejectH = (await import('../app/api/admin/organizers/[id]/reject/route')).POST
  const orgApprove = (id: string) => { login(SUPER); return call(orgApproveH(req(`/api/admin/organizers/${id}/approve`, 'POST', {}), { params: Promise.resolve({ id }) })) }
  const orgReject = (id: string, reason: string) => { login(SUPER); return call(orgRejectH(req(`/api/admin/organizers/${id}/reject`, 'POST', { reason }), { params: Promise.resolve({ id }) })) }
  const memApproveH = (await import('../app/api/admin/vendor-members/[id]/approve/route')).PATCH
  const memRejectH = (await import('../app/api/admin/vendor-members/[id]/reject/route')).PATCH
  const memApprove = (id: string) => { login(SUPER); return call(memApproveH(req(`/api/admin/vendor-members/${id}/approve`, 'PATCH', {}), { params: Promise.resolve({ id }) })) }
  const memReject = (id: string, reason: string) => { login(SUPER); return call(memRejectH(req(`/api/admin/vendor-members/${id}/reject`, 'PATCH', { reason }), { params: Promise.resolve({ id }) })) }

  // ── AF1–AF4: the Approvals route, one email and one record each ─────────────────────────
  console.log('\n[AF1–AF4] The Approvals route: exactly one decision email and one ApprovalAction')
  const v1 = await mkBooth()
  const r1 = await decide(PM, 'vendor', v1.vendor.id, { decision: 'approve' })
  const t1 = await trail(v1.vendor.id)
  assert(r1.status === 200 && (await boothState(v1.vendor.id, v1.ownerId)) === 'ACTIVE|APPROVED|1|1'
    && t1.mails[0] === 'decision_approved' && t1.actions[0] === 'APPROVE',
  `AF1 vendor approve → booth ACTIVE + owner APPROVED, 1 decision_approved, 1 APPROVE (got ${r1.status} ${JSON.stringify(t1)})`)
  const v2 = await mkBooth()
  const r2 = await decide(PM, 'vendor', v2.vendor.id, { decision: 'reject', reason: 'No space' })
  const t2 = await trail(v2.vendor.id)
  assert(r2.status === 200 && (await boothState(v2.vendor.id, v2.ownerId)) === 'REJECTED|REJECTED|1|1'
    && t2.mails[0] === 'decision_rejected' && t2.actions[0] === 'REJECT',
  `AF2 vendor reject → 1 decision_rejected, 1 REJECT (got ${r2.status} ${JSON.stringify(t2)})`)
  const o3 = await mkOrg('PENDING')
  const r3 = await decide(PM, 'organizer', o3.id, { decision: 'approve' })
  const t3 = await trail(o3.id)
  assert(r3.status === 200 && (await orgState(o3.id)) === 'APPROVED|1|1' && t3.mails[0] === 'decision_approved' && t3.actions[0] === 'APPROVE',
    `AF3 organizer approve → 1 decision_approved, 1 APPROVE (got ${r3.status} ${JSON.stringify(t3)})`)
  const o4 = await mkOrg('PENDING')
  const r4 = await decide(PM, 'organizer', o4.id, { decision: 'reject', reason: 'Not a fair' })
  const t4 = await trail(o4.id)
  assert(r4.status === 200 && (await orgState(o4.id)) === 'REJECTED|1|1' && t4.mails[0] === 'decision_rejected' && t4.actions[0] === 'REJECT',
    `AF4 organizer reject → 1 decision_rejected, 1 REJECT (got ${r4.status} ${JSON.stringify(t4)})`)

  // ── AF5: owner rejected as a person, booth still pending ────────────────────────────────
  console.log('\n[AF5] Owner already REJECTED, booth PENDING: approve refused with the new text; reject works')
  const v5 = await mkBooth({ ownerStatus: 'REJECTED' })
  const r5a = await decide(PM, 'vendor', v5.vendor.id, { decision: 'approve' })
  assert(r5a.status === 409 && r5a.code === 'OWNER_REJECTED' && (await boothState(v5.vendor.id, v5.ownerId)) === 'PENDING|REJECTED|0|0',
    `approve → 409 OWNER_REJECTED, nothing changed, no email, no record (got ${r5a.status} ${r5a.code})`)
  assert(r5a.message === OWNER_REJECTED_TEXT, `…with the text "${OWNER_REJECTED_TEXT}" (got ${JSON.stringify(r5a.message)})`)
  const r5b = await decide(PM, 'vendor', v5.vendor.id, { decision: 'reject', reason: 'Owner refused' })
  assert(r5b.status === 200 && (await boothState(v5.vendor.id, v5.ownerId)) === 'REJECTED|REJECTED|1|1',
    `reject → booth REJECTED, 1 email, 1 record (got ${r5b.status})`)

  // ── AF6–AF8: the Organizers routes ──────────────────────────────────────────────────────
  console.log('\n[AF6–AF8] Organizers page routes: PENDING refused; re-decisions unchanged')
  const o6 = await mkOrg('PENDING')
  const r6 = await orgApprove(o6.id)
  assert(refusedToApprovals(r6) && (await orgState(o6.id)) === 'PENDING|0|0',
    `AF6 approve on PENDING → 409 ${DECIDE_CODE} with the fixed text; still PENDING, 0 emails, 0 records (got ${r6.status} ${r6.code})`)
  const r7 = await orgReject(o6.id, 'Not here')
  assert(refusedToApprovals(r7) && (await orgState(o6.id)) === 'PENDING|0|0',
    `AF7 reject on PENDING → 409 ${DECIDE_CODE}; still PENDING, 0 emails, 0 records (got ${r7.status} ${r7.code})`)
  const o8a = await mkOrg('REJECTED')
  const r8a = await orgApprove(o8a.id)
  assert(r8a.status === 200 && (await orgState(o8a.id)) === 'APPROVED|0|0',
    `AF8 approve an already REJECTED organizer → 200 APPROVED (re-decision, no email as before) (got ${r8a.status})`)
  const o8b = await mkOrg('APPROVED')
  const r8b = await orgReject(o8b.id, 'Stopped')
  assert(r8b.status === 200 && (await orgState(o8b.id)) === 'REJECTED|0|0',
    `AF8 reject an already APPROVED organizer → 200 REJECTED (got ${r8b.status})`)

  // ── AF9–AF12: the Booth Operators routes ────────────────────────────────────────────────
  console.log('\n[AF9–AF12] Booth Operators routes: a pending booth\'s owner refused; team members and live booths unchanged')
  const b9 = await mkBooth()
  const r9 = await memApprove(b9.ownerId)
  assert(refusedToApprovals(r9) && (await boothState(b9.vendor.id, b9.ownerId)) === 'PENDING|PENDING|0|0',
    `AF9 approve the owner of a PENDING booth (no organizer) → 409 ${DECIDE_CODE}; nothing changed (got ${r9.status} ${r9.code})`)
  const b9o = await mkBooth({ eventId: orgEv.id })
  const r9o = await memApprove(b9o.ownerId)
  assert(refusedToApprovals(r9o) && (await boothState(b9o.vendor.id, b9o.ownerId)) === 'PENDING|PENDING|0|0',
    `AF9 …on an organizer's fair → 409 ${DECIDE_CODE}; nothing changed (got ${r9o.status} ${r9o.code})`)
  const r10 = await memReject(b9.ownerId, 'Wrong person')
  assert(refusedToApprovals(r10) && (await boothState(b9.vendor.id, b9.ownerId)) === 'PENDING|PENDING|0|0',
    `AF10 reject the owner of a PENDING booth → 409 ${DECIDE_CODE}; nothing changed (got ${r10.status} ${r10.code})`)
  const b10r = await mkBooth({ ownerStatus: 'REJECTED' })
  const r10r = await memApprove(b10r.ownerId)
  assert(refusedToApprovals(r10r) && (await boothState(b10r.vendor.id, b10r.ownerId)) === 'PENDING|REJECTED|0|0',
    `AF10 "Admit anyway" on a rejected owner of a PENDING booth → 409 ${DECIDE_CODE}; nothing changed (got ${r10r.status} ${r10r.code})`)

  const live = await mkBooth({ status: VendorStatus.ACTIVE, ownerStatus: 'APPROVED' })
  const staffUser = await prisma.user.create({ data: { clerkId: `${PFX}st-${rand()}`, email: `st-${rand()}${MAIL}`, name: 'Staff' } })
  const staff = await prisma.vendorMember.create({ data: { vendorId: live.vendor.id, userId: staffUser.id, role: 'staff', approvalStatus: 'PENDING' } })
  const r11a = await memApprove(staff.id)
  assert(r11a.status === 200 && (await boothState(live.vendor.id, staff.id)) === 'ACTIVE|APPROVED|0|0',
    `AF11 approve a team member on an ACTIVE booth → 200, person APPROVED, booth untouched (got ${r11a.status})`)
  const r11b = await memReject(staff.id, 'Not on the rota')
  assert(r11b.status === 200 && (await boothState(live.vendor.id, staff.id)) === 'ACTIVE|REJECTED|0|0',
    `AF11 reject the same team member → 200, person REJECTED, booth untouched (got ${r11b.status})`)
  const r12a = await memReject(live.ownerId, 'Owner paused')
  assert(r12a.status === 200 && (await boothState(live.vendor.id, live.ownerId)) === 'ACTIVE|REJECTED|0|0',
    `AF12 reject the owner of an ACTIVE booth → 200, person only (got ${r12a.status})`)
  const r12b = await memApprove(live.ownerId)
  assert(r12b.status === 200 && (await boothState(live.vendor.id, live.ownerId)) === 'ACTIVE|APPROVED|0|0',
    `AF12 approve them again → 200 (got ${r12b.status})`)
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(64)}`)
    console.log(fail === 0 ? `  ${pass} passed, 0 failed` : `  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
    console.log(`${'─'.repeat(64)}\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
