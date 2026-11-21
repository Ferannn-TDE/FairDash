/**
 * WHO APPROVES VENDORS (Jordan, Nov 16; sub-step B). Real routes and lib, test DB, Clerk mocked,
 * Stripe stubbed through the seam (never called).
 *
 *   [1] The rule (lib/vendor-approver.ts): the event's organizer; FairSynq only when there is none;
 *       a strict admin may override with a reason; platform_manager / event_operator never on an
 *       organizer's event; an organizer never on another organization's event
 *   [2] Organizer approves (door 4): the shared decision — Stripe asked fresh, checklist, booth +
 *       owner together, ApprovalAction (organizer, name), vendor email naming the organization
 *   [3] Organizer rejects a pending vendor: reason required; with one, booth + owner rejected
 *   [4] FairSynq on an organizer's fair: 409 for platform_manager, 400 for an override with no
 *       reason; a strict-admin override is recorded (override + reason) and emails the organizer;
 *       the same Stripe check and checklist refuse it like a normal approval
 *   [5] Re-approve a REJECTED booth (door 5): the full path; refused without Stripe; approved with
 *       it, owner re-admitted, record (reconsidered) and a NEW approved email
 *   [6] Reject a live booth (door 6): reason required; record (fromStatus) and a NEW rejected email;
 *       owner untouched; a booth number sent with a reject → 400
 *   [7] Reviewer labels on organizer screens: own team by name, FairSynq staff as "FairSynq";
 *       admins see the organizer's name and organization
 *   [8] Source checks
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/vendor-approver-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
delete process.env.SLACK_WEBHOOK_URL

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'vapr-'
const MAIL = '@vapr.local'
const rand = () => Math.random().toString(36).slice(2, 8)

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
type ReviewJson = { decision: string; by: string; at: string } | null
interface CallJson {
  error?: { code?: string; message?: string; details?: { missing?: string[] } }
  data?: { status?: string; review?: ReviewJson; vendors?: { id: string; review?: ReviewJson }[] }
}
async function call(p: Promise<Response>) {
  const r = await p
  const text = await r.text()
  let j: CallJson = {}
  try { j = JSON.parse(text) as CallJson } catch { /* not JSON */ }
  return { status: r.status, code: j?.error?.code, message: j?.error?.message, data: j?.data, raw: text }
}

const PM: Who = { id: `${PFX}pm`, roles: ['platform_manager'], fullName: 'Pat Manager' }
const ADMIN: Who = { id: `${PFX}admin`, roles: ['admin'], fullName: 'Avery Admin' }
const EVOP: Who = { id: `${PFX}evop`, roles: ['event_operator'], fullName: 'Eve Operator' }

type StubAnswer = { readyToReceivePayments: boolean; payoutsEnabled: boolean }
const stub = new Map<string, StubAnswer>()

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
    if (vids.length) await prisma.notification.deleteMany({ where: { OR: vids.map(v => ({ dedupeKey: { contains: v } })) } })
    await prisma.payeeNotice.deleteMany({ where: { payeeId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()

  // ── [1] the rule ────────────────────────────────────────────────────────────────────────
  console.log('\n[1] The approver rule')
  const { vendorApproverCheck } = await import('../lib/vendor-approver')
  const outcome = (input: Parameters<typeof vendorApproverCheck>[0]) => {
    try { return vendorApproverCheck(input).override ? 'override' : 'ok' } catch (e) { return (e as { code?: string }).code ?? 'error' }
  }
  assert(outcome({ eventOrganizerId: 'o1', actorType: 'organizer', actorOrganizerId: 'o1', reason: null }) === 'ok', "the event's own organizer → ok")
  assert(outcome({ eventOrganizerId: 'o1', actorType: 'organizer', actorOrganizerId: 'o2', reason: null }) === 'FORBIDDEN', 'another organization\'s organizer → 403')
  assert(outcome({ eventOrganizerId: null, actorType: 'organizer', actorOrganizerId: 'o1', reason: null }) === 'FORBIDDEN', 'an organizer on a fair with no organizer → 403')
  for (const t of ['platform_manager', 'admin', 'super_admin']) {
    assert(outcome({ eventOrganizerId: null, actorType: t, reason: null }) === 'ok', `no organizer: FairSynq (${t}) → ok`)
  }
  for (const t of ['platform_manager', 'event_operator']) {
    assert(outcome({ eventOrganizerId: 'o1', actorType: t, reason: 'urgent' }) === 'APPROVAL_BY_ORGANIZER', `organizer's fair: ${t} → 409 even with a reason`)
  }
  for (const t of ['admin', 'super_admin']) {
    assert(outcome({ eventOrganizerId: 'o1', actorType: t, reason: null }) === 'OVERRIDE_REASON_REQUIRED', `organizer's fair: ${t} with no reason → 400 OVERRIDE_REASON_REQUIRED`)
    assert(outcome({ eventOrganizerId: 'o1', actorType: t, reason: '   ' }) === 'OVERRIDE_REASON_REQUIRED', `organizer's fair: ${t} with a blank reason → 400`)
    assert(outcome({ eventOrganizerId: 'o1', actorType: t, reason: 'Organizer unreachable' }) === 'override', `organizer's fair: ${t} with a reason → override`)
  }

  // ── fixtures ────────────────────────────────────────────────────────────────────────────
  const payouts = await import('../lib/vendor-payouts-check')
  payouts.__setStripePayoutsStatusForTest(async (acct: string) => stub.get(acct) ?? { readyToReceivePayments: true, payoutsEnabled: true })
  const { renderEmail } = await import('../lib/notifications')

  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}orgu`, email: `orgu${MAIL}`, name: 'Olive Organizer' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}County Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const ORG: Who = { id: orgUser.clerkId, roles: ['organizer'] }
  const otherUser = await prisma.user.create({ data: { clerkId: `${PFX}othu`, email: `othu${MAIL}`, name: 'Other Organizer' } })
  const otherOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}Other Board`, contactEmail: `other${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: otherOrg.id, userId: otherUser.id, role: 'owner' } })
  const OTHER: Who = { id: otherUser.clerkId, roles: ['organizer'] }

  const ev = await prisma.event.create({ data: { name: `${PFX}Org Fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, organizerId: org.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const fsEv = await prisma.event.create({ data: { name: `${PFX}FS Fair`, urlSlug: `${PFX}fs-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  const mkVendor = async (opts: { status?: VendorStatus; account?: string | null; eventId?: string; ownerStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {}) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: opts.eventId ?? ev.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: opts.status ?? VendorStatus.PENDING,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`,
        foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf', boothNumber: 'A1', stripeVerified: true,
        stripeAccountId: opts.account === undefined ? `acct_${PFX}${rand()}` : opts.account,
        vendorMembers: { create: { userId: u.id, role: 'owner', approvalStatus: opts.ownerStatus ?? 'PENDING' } },
        menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } },
      },
      include: { vendorMembers: true },
    })
    return { vendor: v, ownerId: v.vendorMembers[0].id, account: v.stripeAccountId }
  }
  const state = async (vendorId: string, ownerId: string) => {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } })
    const o = await prisma.vendorMember.findUnique({ where: { id: ownerId }, select: { approvalStatus: true, rejectionReason: true } })
    const audits = await prisma.approvalAction.count({ where: { applicationId: vendorId } })
    const mails = await prisma.notification.count({ where: { dedupeKey: { contains: vendorId } } })
    return { booth: v?.status, owner: o?.approvalStatus, ownerReason: o?.rejectionReason ?? null, audits, mails, key: `${v?.status}|${o?.approvalStatus}|${audits}|${mails}` }
  }
  const mailsOf = (vendorId: string) => prisma.notification.findMany({ where: { dedupeKey: { contains: vendorId } }, orderBy: { createdAt: 'asc' } })

  const orgPATCH = (await import('../app/api/organizer/vendors/[id]/route')).PATCH
  const orgSet = (who: Who, id: string, body: object) => { login(who); return call(orgPATCH(req(`/api/organizer/vendors/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) })) }
  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const decideAs = (who: Who, id: string, body: object) => { login(who); return call(decideRoute(req(`/api/admin/approvals/vendor/${id}`, 'POST', body), { params: Promise.resolve({ kind: 'vendor', id }) })) }
  const fairApprove = (await import('../app/api/admin/vendors/[id]/approve/route')).PATCH
  const fairReject = (await import('../app/api/admin/vendors/[id]/reject/route')).PATCH
  const fairApproveAs = (who: Who, id: string, body: object) => { login(who); return call(fairApprove(req(`/api/admin/vendors/${id}/approve`, 'PATCH', body), { params: Promise.resolve({ id }) })) }
  const fairRejectAs = (who: Who, id: string, body: object) => { login(who); return call(fairReject(req(`/api/admin/vendors/${id}/reject`, 'PATCH', body), { params: Promise.resolve({ id }) })) }

  // ── [2] organizer approves ──────────────────────────────────────────────────────────────
  console.log('\n[2] The organizer approves on their own fair (the shared decision)')
  const noStripe = await mkVendor({ account: null })
  const r0 = await orgSet(ORG, noStripe.vendor.id, { status: 'ACTIVE' })
  assert(r0.status === 409 && r0.code === 'VENDOR_STRIPE_NOT_LINKED' && (await state(noStripe.vendor.id, noStripe.ownerId)).key === 'PENDING|PENDING|0|0',
    `no Stripe account → 409 VENDOR_STRIPE_NOT_LINKED, nothing changed (got ${r0.status} ${r0.code})`)
  const noPayouts = await mkVendor()
  stub.set(noPayouts.account!, { readyToReceivePayments: true, payoutsEnabled: false })
  const r1 = await orgSet(ORG, noPayouts.vendor.id, { status: 'ACTIVE' })
  assert(r1.status === 409 && r1.code === 'VENDOR_PAYOUTS_NOT_ENABLED' && (await state(noPayouts.vendor.id, noPayouts.ownerId)).key === 'PENDING|PENDING|0|0',
    `payouts not enabled → 409 VENDOR_PAYOUTS_NOT_ENABLED, nothing changed (got ${r1.status} ${r1.code})`)
  const noMenu = await mkVendor()
  await prisma.menuItem.deleteMany({ where: { vendorId: noMenu.vendor.id } })
  const r1b = await orgSet(ORG, noMenu.vendor.id, { status: 'ACTIVE' })
  assert(r1b.status === 409 && r1b.code === 'VENDOR_NOT_READY_TO_GO_LIVE' && (await state(noMenu.vendor.id, noMenu.ownerId)).booth === 'PENDING',
    `checklist incomplete (no menu) → 409 VENDOR_NOT_READY_TO_GO_LIVE (got ${r1b.status} ${r1b.code})`)
  const good = await mkVendor()
  const r2 = await orgSet(ORG, good.vendor.id, { status: 'ACTIVE', boothNumber: 'B7' })
  const g2 = await state(good.vendor.id, good.ownerId)
  const g2row = await prisma.vendor.findUnique({ where: { id: good.vendor.id }, select: { boothNumber: true } })
  assert(r2.status === 200 && g2.booth === 'ACTIVE' && g2.owner === 'APPROVED' && g2row?.boothNumber === 'B7', `approved: booth ACTIVE + owner APPROVED together, booth number kept (got ${r2.status} ${g2.key})`)
  const a2 = await prisma.approvalAction.findFirst({ where: { applicationId: good.vendor.id, action: 'APPROVE' } })
  const d2 = a2?.detail as Record<string, unknown> | null
  assert(a2?.actorType === 'organizer' && a2.actorId === ORG.id && a2.actorName === 'Olive Organizer' && d2?.organizerId === org.id && d2?.organizerName === org.name && d2?.override === undefined,
    `audit row: organizer, their name, their organization, not an override (got ${a2?.actorType}/${a2?.actorName})`)
  const m2 = await mailsOf(good.vendor.id)
  const m2text = m2[0] ? renderEmail(m2[0].template, m2[0].payload) : null
  assert(m2.length === 1 && m2[0].template === 'decision_approved' && !!m2text?.text.includes(`approved by ${org.name}`) && !m2text.text.includes('Olive'),
    `vendor email: "approved by <organization>", never the person (got ${m2text?.text.slice(0, 80)})`)
  const r2b = await orgSet(OTHER, good.vendor.id, { status: 'PAUSED' })
  assert(r2b.status === 403, `another organization's organizer can't touch the booth → 403 (got ${r2b.status})`)
  const fsVendor = await mkVendor({ eventId: fsEv.id })
  const r2c = await orgSet(ORG, fsVendor.vendor.id, { status: 'ACTIVE' })
  assert(r2c.status === 403 && (await state(fsVendor.vendor.id, fsVendor.ownerId)).booth === 'PENDING', `an organizer on a fair with no organizer → 403, nothing changed (got ${r2c.status})`)

  // ── [3] organizer rejects a pending vendor ──────────────────────────────────────────────
  console.log('\n[3] The organizer rejects a pending vendor')
  const rj = await mkVendor()
  const r3a = await orgSet(ORG, rj.vendor.id, { status: 'REJECTED' })
  assert(r3a.status === 400 && (await state(rj.vendor.id, rj.ownerId)).key === 'PENDING|PENDING|0|0', `no reason → 400, nothing changed (got ${r3a.status})`)
  const r3b = await orgSet(ORG, rj.vendor.id, { status: 'REJECTED', reason: 'Too many taco stands' })
  const s3 = await state(rj.vendor.id, rj.ownerId)
  assert(r3b.status === 200 && s3.booth === 'REJECTED' && s3.owner === 'REJECTED' && s3.ownerReason === 'Too many taco stands' && s3.audits === 1,
    `with a reason → booth + owner REJECTED, reason stored, one record (got ${r3b.status} ${s3.key})`)
  const m3 = await mailsOf(rj.vendor.id)
  const m3text = m3[0] ? renderEmail(m3[0].template, m3[0].payload).text : ''
  assert(m3.length === 1 && m3text.includes(`${org.name} is not able to approve`) && m3text.includes('Too many taco stands') && !m3text.includes('Olive'),
    'vendor email: the organization (not the person) and the reason')

  // ── [4] FairSynq on an organizer's fair ─────────────────────────────────────────────────
  console.log("\n[4] FairSynq on an organizer's fair: 409, or a strict-admin override with a reason")
  const f1 = await mkVendor()
  const pmA = await decideAs(PM, f1.vendor.id, { decision: 'approve', reason: 'Please' })
  const pmR = await decideAs(PM, f1.vendor.id, { decision: 'reject', reason: 'Please' })
  assert(pmA.status === 409 && pmA.code === 'APPROVAL_BY_ORGANIZER' && pmR.status === 409 && pmR.code === 'APPROVAL_BY_ORGANIZER'
    && (await state(f1.vendor.id, f1.ownerId)).key === 'PENDING|PENDING|0|0',
  `platform_manager approve / reject → 409 APPROVAL_BY_ORGANIZER even with a reason, nothing changed (got ${pmA.code}/${pmR.code})`)
  const evop = await fairApproveAs(EVOP, f1.vendor.id, { reason: 'x' })
  assert(evop.status === 403, `event_operator on the fair approve route → 403 (got ${evop.status})`)
  const noR1 = await decideAs(ADMIN, f1.vendor.id, { decision: 'approve' })
  const noR2 = await fairApproveAs(ADMIN, f1.vendor.id, {})
  const noR3 = await fairRejectAs(ADMIN, f1.vendor.id, {})
  assert([noR1, noR2, noR3].every(r => r.status === 400 && r.code === 'OVERRIDE_REASON_REQUIRED') && (await state(f1.vendor.id, f1.ownerId)).key === 'PENDING|PENDING|0|0',
    `strict admin override with NO reason (approvals page approve, fair approve, fair reject) → 400 OVERRIDE_REASON_REQUIRED, nothing changed (got ${[noR1, noR2, noR3].map(r => r.code).join('/')})`)

  const ovStripe = await mkVendor({ account: null })
  const r4s = await decideAs(ADMIN, ovStripe.vendor.id, { decision: 'approve', reason: 'Organizer away' })
  assert(r4s.status === 409 && r4s.code === 'VENDOR_STRIPE_NOT_LINKED' && (await state(ovStripe.vendor.id, ovStripe.ownerId)).key === 'PENDING|PENDING|0|0',
    `an override is refused by the Stripe check like any approval: no account → 409, nothing changed, no organizer email (got ${r4s.code})`)

  const ov = await mkVendor()
  const r4 = await decideAs(ADMIN, ov.vendor.id, { decision: 'approve', reason: 'Organizer unreachable before opening day' })
  const s4 = await state(ov.vendor.id, ov.ownerId)
  const a4 = await prisma.approvalAction.findFirst({ where: { applicationId: ov.vendor.id, action: 'APPROVE' } })
  const d4 = a4?.detail as Record<string, unknown> | null
  assert(r4.status === 200 && s4.booth === 'ACTIVE' && s4.owner === 'APPROVED', `strict admin override with a reason → approved (got ${r4.status} ${s4.key})`)
  assert(a4?.actorType === 'admin' && a4.actorName === 'Avery Admin' && a4.reason === 'Organizer unreachable before opening day' && d4?.override === true && d4?.organizerId === org.id,
    'audit row: detail.override = true, the reason, the admin\'s name and role')
  const m4 = await mailsOf(ov.vendor.id)
  const notice = m4.find(n => n.template === 'vendor_override_organizer')
  const noticeText = notice ? renderEmail(notice.template, notice.payload) : null
  assert(!!notice && notice.to === `board${MAIL}` && notice.audience === 'user', `the organizer is emailed (to the organization's contact address) (got ${notice?.to})`)
  assert(!!noticeText && noticeText.text.includes('FairSynq approved') && noticeText.text.includes(ov.vendor.name) && noticeText.text.includes('Organizer unreachable before opening day')
    && !noticeText.text.includes('Avery') && !noticeText.subject.includes('Avery'),
  'organizer email: "FairSynq approved <vendor>", the reason, a link; never the admin\'s name')
  const vMail = m4.find(n => n.template === 'decision_approved')
  const vText = vMail ? renderEmail(vMail.template, vMail.payload).text : ''
  assert(!!vMail && !vText.includes('Avery') && !vText.includes('Organizer unreachable') && !vText.includes(' by '), 'vendor email: the usual FairSynq approval, without the internal reason or a name')

  const ovRej = await mkVendor()
  const r4r = await fairRejectAs(ADMIN, ovRej.vendor.id, { reason: 'Failed health inspection' })
  const s4r = await state(ovRej.vendor.id, ovRej.ownerId)
  const m4r = await mailsOf(ovRej.vendor.id)
  assert(r4r.status === 200 && s4r.booth === 'REJECTED' && m4r.some(n => n.template === 'vendor_override_organizer') && m4r.some(n => n.template === 'decision_rejected'),
    `strict admin override REJECT with a reason (fair page) → rejected, organizer emailed, vendor told (got ${r4r.status} ${s4r.key})`)

  // ── [5] re-approve a rejected booth ─────────────────────────────────────────────────────
  console.log('\n[5] Re-approve a REJECTED booth: the full approval path')
  const rr0 = await mkVendor({ status: VendorStatus.REJECTED, ownerStatus: 'REJECTED', account: null })
  const r5a = await orgSet(ORG, rr0.vendor.id, { status: 'ACTIVE' })
  assert(r5a.status === 409 && r5a.code === 'VENDOR_STRIPE_NOT_LINKED' && (await state(rr0.vendor.id, rr0.ownerId)).key === 'REJECTED|REJECTED|0|0',
    `no Stripe → 409, still REJECTED, owner still REJECTED, no record, no email (got ${r5a.code})`)
  // Approve → reject live → re-approve: the second approval must get its own email.
  const rr = await mkVendor()
  await orgSet(ORG, rr.vendor.id, { status: 'ACTIVE' })
  await orgSet(ORG, rr.vendor.id, { status: 'REJECTED', reason: 'Closed for the season' })
  await prisma.vendorMember.update({ where: { id: rr.ownerId }, data: { approvalStatus: 'REJECTED', rejectionReason: 'separately' } })
  const r5b = await orgSet(ORG, rr.vendor.id, { status: 'ACTIVE' })
  const s5 = await state(rr.vendor.id, rr.ownerId)
  const a5 = await prisma.approvalAction.findFirst({ where: { applicationId: rr.vendor.id, action: 'APPROVE' }, orderBy: { createdAt: 'desc' } })
  const d5 = a5?.detail as Record<string, unknown> | null
  assert(r5b.status === 200 && s5.booth === 'ACTIVE' && s5.owner === 'APPROVED' && s5.ownerReason === null,
    `re-approved: booth ACTIVE, the REJECTED owner re-admitted (APPROVED, reason cleared) (got ${r5b.status} ${s5.key})`)
  assert(d5?.reconsidered === true && d5?.fromStatus === 'REJECTED' && d5?.ownerBefore === 'REJECTED' && d5?.ownerChanged === true && a5?.actorType === 'organizer',
    'audit row: detail.reconsidered, from REJECTED, owner change recorded, by the organizer')
  const approvedMails = (await mailsOf(rr.vendor.id)).filter(n => n.template === 'decision_approved')
  assert(approvedMails.length === 2, `a NEW approved email for the re-approval (2 approved emails in all, got ${approvedMails.length})`)
  const rr2 = await mkVendor({ status: VendorStatus.REJECTED })
  stub.set(rr2.account!, { readyToReceivePayments: true, payoutsEnabled: false })
  const r5c = await orgSet(ORG, rr2.vendor.id, { status: 'ACTIVE' })
  assert(r5c.status === 409 && r5c.code === 'VENDOR_PAYOUTS_NOT_ENABLED' && (await state(rr2.vendor.id, rr2.ownerId)).booth === 'REJECTED',
    `payouts not enabled → 409, still REJECTED (got ${r5c.code})`)

  // ── [6] reject a live booth ─────────────────────────────────────────────────────────────
  console.log('\n[6] Reject a live booth: reason required')
  const live = await mkVendor({ status: VendorStatus.ACTIVE, ownerStatus: 'APPROVED' })
  const r6a = await orgSet(ORG, live.vendor.id, { status: 'REJECTED' })
  assert(r6a.status === 400 && (await state(live.vendor.id, live.ownerId)).key === 'ACTIVE|APPROVED|0|0', `no reason → 400, still ACTIVE, nothing recorded (got ${r6a.status})`)
  const r6b = await orgSet(ORG, live.vendor.id, { status: 'REJECTED', reason: 'Repeated no-shows', boothNumber: 'Z9' })
  assert(r6b.status === 400 && (await state(live.vendor.id, live.ownerId)).booth === 'ACTIVE', `a booth number sent with a reject → 400, still ACTIVE (got ${r6b.status})`)
  const r6c = await orgSet(ORG, live.vendor.id, { status: 'REJECTED', reason: 'Repeated no-shows' })
  const s6 = await state(live.vendor.id, live.ownerId)
  const a6 = await prisma.approvalAction.findFirst({ where: { applicationId: live.vendor.id } })
  const m6 = (await mailsOf(live.vendor.id)).filter(n => n.template === 'decision_rejected')
  assert(r6c.status === 200 && s6.booth === 'REJECTED' && s6.owner === 'APPROVED', `with a reason → REJECTED, owner untouched (got ${r6c.status} ${s6.key})`)
  assert(a6?.action === 'REJECT' && (a6.detail as Record<string, unknown>)?.fromStatus === 'ACTIVE' && a6.reason === 'Repeated no-shows' && m6.length === 1
    && renderEmail(m6[0].template, m6[0].payload).text.includes('Repeated no-shows'),
  'record REJECT (fromStatus ACTIVE, the reason) and the vendor\'s rejection email with the reason')
  const paused = await mkVendor({ status: VendorStatus.PAUSED, ownerStatus: 'APPROVED' })
  const r6d = await orgSet(ORG, paused.vendor.id, { status: 'REJECTED', reason: 'Not coming back' })
  assert(r6d.status === 200 && (await state(paused.vendor.id, paused.ownerId)).booth === 'REJECTED', `a PAUSED booth can be rejected the same way (got ${r6d.status})`)
  const twice = await mkVendor()
  await orgSet(ORG, twice.vendor.id, { status: 'REJECTED', reason: 'First no' })
  await orgSet(ORG, twice.vendor.id, { status: 'ACTIVE' })
  await orgSet(ORG, twice.vendor.id, { status: 'REJECTED', reason: 'Second no' })
  const twiceMails = (await mailsOf(twice.vendor.id)).filter(n => n.template === 'decision_rejected')
  assert(twiceMails.length === 2, `a second rejection gets its own email (got ${twiceMails.length})`)

  // ── [7] labels on organizer and admin screens ───────────────────────────────────────────
  console.log('\n[7] Reviewer labels on organizer screens')
  const orgDetail = (await import('../app/api/organizer/vendors/[id]/route')).GET
  login(ORG)
  const odOwn = await call(orgDetail(req(`/api/organizer/vendors/${good.vendor.id}`), { params: Promise.resolve({ id: good.vendor.id }) }))
  assert(odOwn.status === 200 && odOwn.data?.review?.by === 'Olive Organizer' && odOwn.data.review.decision === 'APPROVE',
    `organizer detail, decided by their own team → their name (got ${odOwn.data?.review?.by})`)
  const odFs = await call(orgDetail(req(`/api/organizer/vendors/${ov.vendor.id}`), { params: Promise.resolve({ id: ov.vendor.id }) }))
  assert(odFs.status === 200 && odFs.data?.review?.by === 'FairSynq' && !odFs.raw.includes('Avery'),
    `organizer detail, decided by a FairSynq override → "FairSynq", never the admin's name (got ${odFs.data?.review?.by})`)
  const orgList = (await import('../app/api/organizer/fairs/[fairSlug]/vendors/route')).GET
  const ol = await call(orgList(req(`/api/organizer/fairs/${ev.urlSlug}/vendors?take=200`), { params: Promise.resolve({ fairSlug: ev.urlSlug }) }))
  const byId = new Map((ol.data?.vendors ?? []).map(v => [v.id, v.review?.by]))
  assert(ol.status === 200 && byId.get(good.vendor.id) === 'Olive Organizer' && byId.get(ov.vendor.id) === 'FairSynq' && !ol.raw.includes('Avery'),
    'organizer fair list: own team by name, FairSynq staff as "FairSynq"')
  login(ADMIN)
  const adminList = (await import('../app/api/admin/events/[id]/vendors/route')).GET
  const al = await call(adminList(req(`/api/admin/events/${ev.urlSlug}/vendors?take=200`), { params: Promise.resolve({ id: ev.urlSlug }) }))
  const aById = new Map((al.data?.vendors ?? []).map(v => [v.id, v.review?.by]))
  assert(al.status === 200 && aById.get(good.vendor.id) === `Olive Organizer (organizer, ${org.name})` && aById.get(ov.vendor.id) === 'Avery Admin',
    `admin roster: full names, organizers with their organization (got ${aById.get(good.vendor.id)} / ${aById.get(ov.vendor.id)})`)

  // ── [8] source checks ───────────────────────────────────────────────────────────────────
  console.log('\n[8] Source checks')
  const route = readFileSync('app/api/organizer/vendors/[id]/route.ts', 'utf8').replace(/\r\n/g, '\n')
  assert(/const ORGANIZER_MAY_APPROVE_VENDORS: boolean = true/.test(route), 'organizer approval is switched on (the switch is kept)')
  assert(/await decideVendor\(vendorId,/.test(route) && /await reconsiderVendor\(vendorId,/.test(route) && /await rejectLiveVendor\(vendorId,/.test(route),
    'the organizer route sends every decision to the shared decisions')
  const iDecision = route.indexOf('if (decision) {'), iGoLive = route.indexOf('vendorGoLiveRefusal(db,'), iWrite = route.indexOf('db.vendor.updateMany(')
  assert(iDecision !== -1 && iGoLive !== -1 && iWrite !== -1 && iDecision < iGoLive && iGoLive < iWrite,
    'decisions return before the plain status write; the go-live check still sits before that write')
  const lib = readFileSync('lib/approvals.ts', 'utf8').replace(/\r\n/g, '\n')
  for (const fn of ['decideVendor', 'reconsiderVendor', 'rejectLiveVendor']) {
    const body = lib.slice(lib.indexOf(`export async function ${fn}(`))
    const iCtx = body.indexOf('decisionContext(vendor, actor, reasonIn)'), iTx = body.indexOf('db.$transaction(')
    assert(iCtx !== -1 && iTx !== -1 && iCtx < iTx, `${fn}: the approver rule runs before the transaction`)
  }
  const panel = readFileSync('app/admin/_components/ApprovalsPanel.tsx', 'utf8')
  assert(/canOverride && <DecisionControls kind="vendor" id=\{v\.id\} onDone=\{load\} override \/>/.test(panel), 'approvals page: override controls only for strict admins (canOverride)')
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
