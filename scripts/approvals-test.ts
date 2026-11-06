/**
 * SIGN-UP APPROVALS (Batch 1 item 9, B1.12) — real routes and lib, test DB, Clerk mocked.
 *
 *   [1] Gates: approvals routes admit admin / super_admin / platform_manager only; the per-fair
 *       vendor approve/reject no longer admit event_operator
 *   [2] Vendor owner rows (approval is per booth): every agreed case, owner pre-set through the
 *       existing Booth Operators routes — incl. reject leaving an already-APPROVED owner untouched
 *   [3] Documents gate, required reject reason, double decision → 409, staff never touched
 *   [4] Organizer and partner decisions; applicant emails queued; audit rows
 *   [5] The per-fair admin vendor routes run the same single decision
 *   [6] Organizers can't decide pending vendors (C-9 switched off); pausing still works
 *   [7] Document viewing: pending only, audited (actor, role, document)
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/approvals-test.ts
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
const PFX = 'apr-'
const MAIL = '@apr.local'
const rand = () => Math.random().toString(36).slice(2, 8)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
const login = (clerkId: string | null, roles: string[] = []) => {
  (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId, publicMetadata: { roles } } : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
async function call(p: Promise<Response>) {
  const r = await p
  const j: any = await r.json().catch(() => ({}))
  return { status: r.status, code: j?.error?.code as string | undefined, data: j?.data, details: j?.error?.details }
}

const SUPER = { id: `${PFX}super`, roles: ['super_admin'] }
const PM = { id: `${PFX}pm`, roles: ['platform_manager'] }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
    await prisma.notification.deleteMany({ where: { OR: vids.map(v => ({ dedupeKey: { contains: v } })) } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { id: { in: vids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  const orgs = await prisma.fairOrganizer.findMany({ where: { contactEmail: { endsWith: MAIL } }, select: { id: true } })
  const partners = await prisma.partnerOrganization.findMany({ where: { contactEmail: { endsWith: MAIL } }, select: { id: true } })
  const other = [...orgs, ...partners].map(o => o.id)
  if (other.length) {
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: other } } })
    await prisma.notification.deleteMany({ where: { OR: other.map(o => ({ dedupeKey: { contains: o } })) } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.partnerOrganization.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  await cleanup()
  const superUser = await prisma.user.create({ data: { clerkId: SUPER.id, email: `super${MAIL}`, name: 'Super' } })
  void superUser

  // An organizer who owns the fair, for [6].
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}orgu`, email: `orgu${MAIL}`, name: 'Org' } })
  const ownerOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}owner-org`, contactEmail: `owner-org${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: ownerOrg.id, userId: orgUser.id, role: 'owner' } })
  const ev = await prisma.event.create({ data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, organizerId: ownerOrg.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  const mkVendor = async (opts: { docs?: boolean; withStaff?: boolean } = {}) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const docs = opts.docs === false ? {} : { foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf' }
    const v = await prisma.vendor.create({
      data: {
        eventId: ev.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: VendorStatus.PENDING,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`, ...docs,
        vendorMembers: { create: { userId: u.id, role: 'owner' } },
      },
      include: { vendorMembers: true },
    })
    let staffId: string | null = null
    if (opts.withStaff) {
      const s = await prisma.user.create({ data: { clerkId: `${PFX}st-${rand()}`, email: `st-${rand()}${MAIL}`, name: 'Staff' } })
      staffId = (await prisma.vendorMember.create({ data: { vendorId: v.id, userId: s.id, role: 'staff' } })).id
    }
    return { vendor: v, ownerId: v.vendorMembers[0].id, staffId }
  }
  const state = async (vendorId: string, ownerId: string) => {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } })
    const o = await prisma.vendorMember.findUnique({ where: { id: ownerId }, select: { approvalStatus: true, approvedAt: true, rejectionReason: true } })
    return { booth: v?.status, owner: o?.approvalStatus, ownerApprovedAt: o?.approvedAt?.getTime() ?? null, ownerReason: o?.rejectionReason ?? null }
  }

  const approvals = await import('../app/api/admin/approvals/route')
  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const decideAs = (who: { id: string; roles: string[] }, kind: string, id: string, body: object) => {
    login(who.id, who.roles); return call(decideRoute(req(`/api/admin/approvals/${kind}/${id}`, 'POST', body), { params: Promise.resolve({ kind, id }) }))
  }
  const memberApprove = (await import('../app/api/admin/vendor-members/[id]/approve/route')).PATCH
  const memberReject = (await import('../app/api/admin/vendor-members/[id]/reject/route')).PATCH

  // ── [1] gates ──────────────────────────────────────────────────────────────────────────
  console.log('\n[1] Who can approve')
  for (const [roles, expected] of [[['platform_manager'], 200], [['admin'], 200], [['super_admin'], 200], [['event_operator'], 403], [['vendor'], 403], [[], 403]] as const) {
    login(`${PFX}gate-${rand()}`, [...roles])
    const r = await call(approvals.GET(req('/api/admin/approvals') as any))
    assert(r.status === expected, `${roles.join(',') || 'customer'} → GET /api/admin/approvals ${expected} (got ${r.status})`)
  }
  login(null)
  assert((await call(approvals.GET(req('/api/admin/approvals') as any))).status === 401, 'anonymous → 401')
  const g = await mkVendor()
  const oldApprove = (await import('../app/api/admin/vendors/[id]/approve/route')).PATCH
  login(`${PFX}evop`, ['event_operator'])
  const evop = await call(oldApprove(req(`/api/admin/vendors/${g.vendor.id}/approve`, 'PATCH', {}), { params: Promise.resolve({ id: g.vendor.id }) }))
  assert(evop.status === 403 && (await state(g.vendor.id, g.ownerId)).booth === 'PENDING', `event_operator can no longer approve a vendor on the fair page (got ${evop.status})`)

  // ── [2] vendor owner cases ─────────────────────────────────────────────────────────────
  console.log('\n[2] Booth + owner, every case')
  const a = await mkVendor({ withStaff: true })
  const ra = await decideAs(PM, 'vendor', a.vendor.id, { decision: 'approve' })
  const sa = await state(a.vendor.id, a.ownerId)
  assert(ra.status === 200 && sa.booth === 'ACTIVE' && sa.owner === 'APPROVED', '[0] control: a new application → booth ACTIVE and owner APPROVED in one decision')
  assert((await prisma.vendorMember.findUnique({ where: { id: a.staffId! } }))?.approvalStatus === 'PENDING', 'staff added later are never touched')

  const b = await mkVendor()
  login(SUPER.id, SUPER.roles)
  await memberApprove(req(`/api/admin/vendor-members/${b.ownerId}/approve`, 'PATCH', {}), { params: Promise.resolve({ id: b.ownerId }) })
  const before = await state(b.vendor.id, b.ownerId)
  assert(before.owner === 'APPROVED' && before.booth === 'PENDING', '[0] setup: owner approved separately on Booth Operators, booth still pending')
  const rb = await decideAs(PM, 'vendor', b.vendor.id, { decision: 'approve' })
  const sb = await state(b.vendor.id, b.ownerId)
  assert(rb.status === 200 && sb.booth === 'ACTIVE' && sb.owner === 'APPROVED' && sb.ownerApprovedAt === before.ownerApprovedAt, 'owner already APPROVED → approve changes only the booth (owner row untouched)')

  const c = await mkVendor()
  login(SUPER.id, SUPER.roles)
  await memberReject(req(`/api/admin/vendor-members/${c.ownerId}/reject`, 'PATCH', { reason: 'Not the owner' }), { params: Promise.resolve({ id: c.ownerId }) })
  const rc = await decideAs(PM, 'vendor', c.vendor.id, { decision: 'approve' })
  const sc = await state(c.vendor.id, c.ownerId)
  assert(rc.status === 409 && rc.code === 'OWNER_REJECTED' && sc.booth === 'PENDING' && sc.owner === 'REJECTED', 'owner already REJECTED → approve refused, nothing changes (an explicit rejection is never overridden)')

  const d = await mkVendor({ withStaff: true })
  const rd = await decideAs(PM, 'vendor', d.vendor.id, { decision: 'reject', reason: 'Missing health permit' })
  const sd = await state(d.vendor.id, d.ownerId)
  assert(rd.status === 200 && sd.booth === 'REJECTED' && sd.owner === 'REJECTED' && sd.ownerReason === 'Missing health permit', 'owner PENDING → reject rejects booth and owner, with the reason')
  assert((await prisma.vendorMember.findUnique({ where: { id: d.staffId! } }))?.approvalStatus === 'PENDING', 'staff untouched by a reject too')

  const e = await mkVendor()
  login(SUPER.id, SUPER.roles)
  await memberApprove(req(`/api/admin/vendor-members/${e.ownerId}/approve`, 'PATCH', {}), { params: Promise.resolve({ id: e.ownerId }) })
  const eBefore = await state(e.vendor.id, e.ownerId)
  const re = await decideAs(PM, 'vendor', e.vendor.id, { decision: 'reject', reason: 'Booth space full' })
  const se = await state(e.vendor.id, e.ownerId)
  assert(re.status === 200 && se.booth === 'REJECTED' && se.owner === 'APPROVED' && se.ownerApprovedAt === eBefore.ownerApprovedAt && se.ownerReason === null,
    'owner already APPROVED → reject rejects ONLY the booth; the owner stays APPROVED, untouched')

  const f = await mkVendor()
  login(SUPER.id, SUPER.roles)
  await memberReject(req(`/api/admin/vendor-members/${f.ownerId}/reject`, 'PATCH', { reason: 'Earlier no' }), { params: Promise.resolve({ id: f.ownerId }) })
  const rf = await decideAs(PM, 'vendor', f.vendor.id, { decision: 'reject', reason: 'Later no' })
  const sf = await state(f.vendor.id, f.ownerId)
  assert(rf.status === 200 && sf.booth === 'REJECTED' && sf.owner === 'REJECTED' && sf.ownerReason === 'Earlier no', 'owner already REJECTED → reject changes only the booth (owner keeps its own reason)')

  // ── [3] documents, reasons, double decisions ───────────────────────────────────────────
  console.log('\n[3] Documents gate, reasons, double decisions')
  const h = await mkVendor({ docs: false })
  const rh = await decideAs(PM, 'vendor', h.vendor.id, { decision: 'approve' })
  assert(rh.status === 409 && rh.code === 'DOCS_INCOMPLETE' && Array.isArray(rh.details?.missing) && rh.details.missing.length === 3, 'missing documents → 409 DOCS_INCOMPLETE listing what is missing')
  assert((await state(h.vendor.id, h.ownerId)).booth === 'PENDING', 'and nothing changed')
  const noReason = await decideAs(PM, 'vendor', h.vendor.id, { decision: 'reject', reason: '   ' })
  assert(noReason.status === 400, 'reject with no reason → 400')
  const again = await decideAs(PM, 'vendor', a.vendor.id, { decision: 'reject', reason: 'Too late' })
  assert(again.status === 409 && again.code === 'ALREADY_DECIDED' && (await state(a.vendor.id, a.ownerId)).booth === 'ACTIVE', 'deciding an already-decided vendor → 409 ALREADY_DECIDED, no change')
  const race = await mkVendor()
  const both = await Promise.all([decideAs(PM, 'vendor', race.vendor.id, { decision: 'approve' }), decideAs(SUPER, 'vendor', race.vendor.id, { decision: 'reject', reason: 'x' })])
  const codes = both.map(r => r.status).sort()
  assert(codes[0] === 200 && codes[1] === 409, `two admins at once → one wins, one gets 409 (got ${codes.join('/')})`)

  // ── [4] organizers, partners, emails, audit ────────────────────────────────────────────
  console.log('\n[4] Organizers and partners; emails and audit')
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}County Board`, contactEmail: `board${MAIL}` } })
  const ro = await decideAs(PM, 'organizer', org.id, { decision: 'approve' })
  const orgRow = await prisma.fairOrganizer.findUnique({ where: { id: org.id } })
  assert(ro.status === 200 && orgRow?.approvalStatus === 'APPROVED' && orgRow.approvedBy === PM.id, 'organizer approved (approvedBy = the Clerk id, as the existing route stores it)')
  const partner = await prisma.partnerOrganization.create({ data: { name: `${PFX}PTA`, groupType: 'school', contactName: 'Pat', contactEmail: `pta${MAIL}`, contactPhone: '6185550100', city: 'Alton', state: 'IL' } })
  const rp = await decideAs(PM, 'partner', partner.id, { decision: 'reject', reason: 'Outside our area for now' })
  const pRow = await prisma.partnerOrganization.findUnique({ where: { id: partner.id } })
  assert(rp.status === 200 && pRow?.approvalStatus === 'REJECTED' && pRow.rejectionReason === 'Outside our area for now', 'partner rejected with the reason stored')
  const mails = await prisma.notification.findMany({ where: { audience: 'applicant', OR: [{ dedupeKey: `decision:vendor:${a.vendor.id}:approved` }, { dedupeKey: `decision:organizer:${org.id}:approved` }, { dedupeKey: `decision:partner:${partner.id}:rejected` }] } })
  assert(mails.length === 3, 'each decision queued the applicant\'s email (vendor approved, organizer approved, partner rejected)')
  assert(mails.find(m => m.template === 'decision_rejected')?.to === `pta${MAIL}` && (mails.find(m => m.template === 'decision_rejected')?.payload as any)?.reason === 'Outside our area for now',
    'the rejection email goes to the applicant and carries the reason')
  const audit = await prisma.approvalAction.findMany({ where: { applicationId: { in: [a.vendor.id, org.id, partner.id] } } })
  assert(audit.length === 3 && audit.every(x => x.actorId === PM.id && x.actorType === 'platform_manager'), 'every decision has an audit row with the actor and role')
  const noAuditOnRefusal = await prisma.approvalAction.count({ where: { applicationId: c.vendor.id } })
  assert(noAuditOnRefusal === 0, '[0] a refused decision writes no audit row')

  // ── [5] the per-fair admin route runs the same decision ────────────────────────────────
  console.log('\n[5] The fair Vendors page uses the same decision')
  const k = await mkVendor()
  login(SUPER.id, SUPER.roles)
  const rk = await call(oldApprove(req(`/api/admin/vendors/${k.vendor.id}/approve`, 'PATCH', { boothNumber: 'B12' }), { params: Promise.resolve({ id: k.vendor.id }) }))
  const sk = await state(k.vendor.id, k.ownerId)
  assert(rk.status === 200 && sk.booth === 'ACTIVE' && sk.owner === 'APPROVED' && rk.data?.vendor?.boothNumber === 'B12', 'super_admin on the fair page: booth + owner approved together, booth number kept')

  // ── [6] organizers can't decide pending vendors ────────────────────────────────────────
  console.log('\n[6] Organizer approval of vendors is off (C-9)')
  const orgPATCH = (await import('../app/api/organizer/vendors/[id]/route')).PATCH
  const m = await mkVendor()
  const orgSet = (id: string, status: string) => { login(orgUser.clerkId, ['organizer']); return call(orgPATCH(req(`/api/organizer/vendors/${id}`, 'PATCH', { status }) as any, { params: Promise.resolve({ id }) })) }
  const oa = await orgSet(m.vendor.id, 'ACTIVE'), orj = await orgSet(m.vendor.id, 'REJECTED')
  assert(oa.status === 403 && oa.code === 'APPROVAL_BY_PLATFORM' && orj.status === 403, 'organizer PENDING → ACTIVE or REJECTED → 403 APPROVAL_BY_PLATFORM')
  assert((await state(m.vendor.id, m.ownerId)).booth === 'PENDING', 'and the vendor is still pending')
  const op = await orgSet(k.vendor.id, 'PAUSED')
  assert(op.status === 200 && (await prisma.vendor.findUnique({ where: { id: k.vendor.id } }))?.status === 'PAUSED', '[0] control: the organizer can still pause an active vendor')

  // ── [7] document viewing ───────────────────────────────────────────────────────────────
  console.log('\n[7] Viewing documents')
  const { vendorDocumentPathForReview } = await import('../lib/approvals')
  const n = await mkVendor()
  const path = await vendorDocumentPathForReview(n.vendor.id, 'insurance', { clerkId: PM.id, actorType: 'platform_manager' })
  const view = await prisma.approvalAction.findFirst({ where: { applicationId: n.vendor.id, action: 'VIEW_DOCUMENT' } })
  assert(path === 'x/ins.pdf' && view?.actorId === PM.id && view.actorType === 'platform_manager' && (view.detail as any)?.document === 'insurance', 'a pending vendor\'s document → its path, and an audit row (actor, role, document, time)')
  let refused = ''
  try { await vendorDocumentPathForReview(a.vendor.id, 'insurance', { clerkId: PM.id, actorType: 'platform_manager' }) } catch (err: any) { refused = err.code }
  assert(refused === 'NOT_PENDING', 'an already-decided vendor\'s documents → refused (pending only)')
  const docRoute = (await import('../app/api/admin/approvals/vendors/[id]/documents/[doc]/route')).GET
  login(`${PFX}evop2`, ['event_operator'])
  const evDoc = await call(docRoute(req(`/api/admin/approvals/vendors/${n.vendor.id}/documents/insurance`) as any, { params: Promise.resolve({ id: n.vendor.id, doc: 'insurance' }) }))
  assert(evDoc.status === 403, 'event_operator can\'t use the document route')
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
