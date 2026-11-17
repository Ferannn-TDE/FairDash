/**
 * VENDOR APPROVAL NEEDS STRIPE PAYOUTS + REVIEWER NAME (Jordan, Nov 16; sub-step A).
 * Real routes and lib, test DB, Clerk mocked, Stripe stubbed through the seam (never called).
 *
 *   [1] Reviewer labels: who sees what (admins: full name; organizers: own org only, FairSynq
 *       staff as "FairSynq"; vendors: never a person) and the recorded-name fallbacks
 *   [2] Every FairSynq approval door refuses without a linked account / with payouts not enabled /
 *       when Stripe can't be asked, and changes NOTHING when it refuses
 *   [3] Stripe is asked fresh: a stale stored flag neither blocks nor allows; the stored flag
 *       catches up; the vendor's own account is the one asked
 *   [4] Every decision records the reviewer's name, role and time with its email, in ONE
 *       transaction (a forced audit failure rolls the decision back)
 *   [5] Name visibility end to end: the admin roster shows it; the organizer's views, the vendor's
 *       readiness and the decision email never contain it
 *   [6] Source checks: the Stripe check runs before the write, on approve only
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/vendor-approval-payouts-test.ts
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'vap-'
const MAIL = '@vap.local'
const rand = () => Math.random().toString(36).slice(2, 8)
const FAIL_NAME = 'VAP-FORCED-AUDIT-FAILURE'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}
type Who = { id: string; roles: string[]; fullName?: string; firstName?: string; lastName?: string }
const login = (who: Who | null) => {
  (globalThis as unknown as { __MOCK_CLERK?: unknown }).__MOCK_CLERK = who
    ? { userId: who.id, publicMetadata: { roles: who.roles }, fullName: who.fullName, firstName: who.firstName, lastName: who.lastName }
    : undefined
}
const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
type ReviewJson = { decision: string; by: string; at: string } | null
interface CallJson {
  error?: { code?: string; message?: string; details?: { missing?: string[] } }
  data?: { vendors?: { id: string; review?: ReviewJson }[] }
}
async function call(p: Promise<Response>) {
  const r = await p
  const text = await r.text()
  let j: CallJson = {}
  try { j = JSON.parse(text) as CallJson } catch { /* not JSON */ }
  return { status: r.status, code: j?.error?.code as string | undefined, message: j?.error?.message as string | undefined, data: j?.data, details: j?.error?.details, raw: text }
}

// Admins: names come from the (mocked) Clerk sign-in.
const PM: Who = { id: `${PFX}pm`, roles: ['platform_manager'], fullName: 'Pat Manager' }
const ADMIN: Who = { id: `${PFX}admin`, roles: ['admin'], firstName: 'Avery', lastName: 'Admin' }
const SUPER: Who = { id: `${PFX}super`, roles: ['super_admin'], fullName: 'Sam Super' }
const NONAME: Who = { id: `${PFX}noname`, roles: ['admin'] }

// ── Stripe stub ─────────────────────────────────────────────────────────────────────────────
type StubAnswer = { readyToReceivePayments: boolean; payoutsEnabled: boolean } | 'throw' | 'missing'
const stub = new Map<string, StubAnswer>()
const asked: string[] = []

async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vap_fail_audit ON "ApprovalAction"`)
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vap_fail_audit_fn()`)
}

async function cleanup() {
  await dropTrigger()
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.approvalAction.deleteMany({ where: { applicationId: { in: vids } } })
    if (vids.length) await prisma.notification.deleteMany({ where: { OR: vids.map(v => ({ dedupeKey: { contains: v } })) } })
    await prisma.payeeNotice.deleteMany({ where: { payeeId: { in: vids } } })
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
  const labels = await import('../lib/reviewer-label')
  const { reviewerLabel, reviewerNameFrom, FAIRSYNQ_LABEL, UNRECORDED_LABEL } = labels

  // ── [1] labels ──────────────────────────────────────────────────────────────────────────
  console.log('\n[1] Who sees the reviewer\'s name')
  const fairsynqRec = { actorType: 'admin', actorName: 'Avery Admin', detail: null }
  const oldRec = { actorType: 'platform_manager', actorName: null, detail: null }
  const orgRec = { actorType: 'organizer', actorName: 'Olive Org', detail: { organizerId: 'org-1', organizerName: 'County Fair Board' } }
  assert(reviewerLabel({ kind: 'admin' }, fairsynqRec) === 'Avery Admin', 'admin sees a FairSynq reviewer\'s full name')
  assert(reviewerLabel({ kind: 'admin' }, oldRec) === UNRECORDED_LABEL, 'admin sees an old row (no name recorded) as "FairSynq (before names were recorded)"')
  assert(reviewerLabel({ kind: 'admin' }, orgRec) === 'Olive Org (organizer, County Fair Board)', 'admin sees an organizer reviewer\'s full name and org')
  assert(reviewerLabel({ kind: 'organizer', organizerId: 'org-1' }, fairsynqRec) === FAIRSYNQ_LABEL, 'organizer sees a FairSynq decision as "FairSynq", never the person')
  assert(reviewerLabel({ kind: 'organizer', organizerId: 'org-1' }, oldRec) === FAIRSYNQ_LABEL, 'organizer sees an old FairSynq row as "FairSynq"')
  assert(reviewerLabel({ kind: 'organizer', organizerId: 'org-1' }, orgRec) === 'Olive Org', 'organizer sees their OWN org\'s reviewer by name')
  assert(reviewerLabel({ kind: 'organizer', organizerId: 'org-2' }, orgRec) === 'County Fair Board', 'another org\'s reviewer shows only as that org, never the person')
  assert(reviewerLabel({ kind: 'vendor' }, fairsynqRec) === FAIRSYNQ_LABEL, 'vendor sees a FairSynq decision as "FairSynq"')
  assert(reviewerLabel({ kind: 'vendor' }, orgRec) === 'County Fair Board', 'vendor sees an organizer decision as the org name, never the person')
  assert(reviewerLabel({ kind: 'vendor' }, { actorType: 'organizer', actorName: 'Olive Org', detail: null }) === 'The event organizer', 'vendor, organizer decision with no org name on file → "The event organizer"')
  assert(reviewerNameFrom({ fullName: '  Pat Manager ' }) === 'Pat Manager', 'name: full name first (trimmed)')
  assert(reviewerNameFrom({ firstName: 'Avery', lastName: 'Admin', dbName: 'X' }) === 'Avery Admin', 'name: first + last next')
  assert(reviewerNameFrom({ dbName: 'Db Name', email: 'e@x.y' }) === 'Db Name', 'name: then the account name on file')
  assert(reviewerNameFrom({ email: 'jo.smith@x.y' }) === 'jo.smith', 'name: then the part of the email before the @')
  assert(reviewerNameFrom({}) === null, 'name: null when nothing exists')

  // ── fixtures ────────────────────────────────────────────────────────────────────────────
  const payouts = await import('../lib/vendor-payouts-check')
  payouts.__setStripePayoutsStatusForTest(async (acct: string) => {
    asked.push(acct)
    const a = stub.get(acct) ?? { readyToReceivePayments: true, payoutsEnabled: true }
    if (a === 'throw') throw new Error('stripe down (stub)')
    if (a === 'missing') throw Object.assign(new Error('No such account (stub)'), { code: 'resource_missing', statusCode: 404 })
    return a
  })

  // The no-name admin has a DB row with an email but no name: the fallback must use the email.
  await prisma.user.create({ data: { clerkId: NONAME.id, email: `fallback.reviewer${MAIL}` } })

  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}orgu`, email: `orgu${MAIL}`, name: 'Org Person' } })
  const ownerOrg = await prisma.fairOrganizer.create({ data: { name: `${PFX}Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: ownerOrg.id, userId: orgUser.id, role: 'owner' } })
  const ev = await prisma.event.create({ data: { name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, organizerId: ownerOrg.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  const mkVendor = async (opts: { account?: string | null; stored?: boolean } = {}) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: ev.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: VendorStatus.PENDING,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`,
        foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf', boothNumber: 'A1',
        stripeVerified: opts.stored ?? true,
        stripeAccountId: opts.account === undefined ? `acct_${PFX}${rand()}` : opts.account,
        vendorMembers: { create: { userId: u.id, role: 'owner' } },
        menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } },
      },
      include: { vendorMembers: true },
    })
    return { vendor: v, ownerId: v.vendorMembers[0].id, account: v.stripeAccountId }
  }
  const snapshot = async (vendorId: string, ownerId: string) => {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } })
    const o = await prisma.vendorMember.findUnique({ where: { id: ownerId }, select: { approvalStatus: true } })
    const audits = await prisma.approvalAction.count({ where: { applicationId: vendorId } })
    const mails = await prisma.notification.count({ where: { dedupeKey: { contains: vendorId } } })
    return `${v?.status}|${o?.approvalStatus}|${audits}|${mails}`
  }
  const UNCHANGED = 'PENDING|PENDING|0|0'

  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const fairApprove = (await import('../app/api/admin/vendors/[id]/approve/route')).PATCH
  const fairReject = (await import('../app/api/admin/vendors/[id]/reject/route')).PATCH

  // The three FairSynq approval doors (sub-step A). Each returns the call result.
  const DOORS: { name: string; approve: (id: string) => Promise<Awaited<ReturnType<typeof call>>> }[] = [
    { name: 'approvals page as platform_manager', approve: id => { login(PM); return call(decideRoute(req(`/api/admin/approvals/vendor/${id}`, 'POST', { decision: 'approve' }), { params: Promise.resolve({ kind: 'vendor', id }) })) } },
    { name: 'approvals page as admin', approve: id => { login(ADMIN); return call(decideRoute(req(`/api/admin/approvals/vendor/${id}`, 'POST', { decision: 'approve' }), { params: Promise.resolve({ kind: 'vendor', id }) })) } },
    { name: 'fair Vendors page approve as super_admin', approve: id => { login(SUPER); return call(fairApprove(req(`/api/admin/vendors/${id}/approve`, 'PATCH', {}), { params: Promise.resolve({ id }) })) } },
  ]

  // ── [2] refusals on every door ──────────────────────────────────────────────────────────
  for (const door of DOORS) {
    console.log(`\n[2] ${door.name}`)
    const none = await mkVendor({ account: null })
    const r1 = await door.approve(none.vendor.id)
    assert(r1.status === 409 && r1.code === 'VENDOR_STRIPE_NOT_LINKED' && !!r1.message?.includes(none.vendor.name) && !!r1.message?.includes('Connect payouts'),
      `no Stripe account linked → 409 VENDOR_STRIPE_NOT_LINKED, message names the vendor and "Connect payouts" (got ${r1.status} ${r1.code})`)
    assert(await snapshot(none.vendor.id, none.ownerId) === UNCHANGED, '…and nothing changed (booth, owner, audit, email)')

    const noPayouts = await mkVendor()
    stub.set(noPayouts.account!, { readyToReceivePayments: true, payoutsEnabled: false })
    const r2 = await door.approve(noPayouts.vendor.id)
    assert(r2.status === 409 && r2.code === 'VENDOR_PAYOUTS_NOT_ENABLED' && !!r2.message?.includes("hasn't enabled payouts"),
      `transfers active but payouts NOT enabled → 409 VENDOR_PAYOUTS_NOT_ENABLED (got ${r2.status} ${r2.code})`)
    assert(await snapshot(noPayouts.vendor.id, noPayouts.ownerId) === UNCHANGED, '…and nothing changed')

    const noTransfers = await mkVendor()
    stub.set(noTransfers.account!, { readyToReceivePayments: false, payoutsEnabled: true })
    const r3 = await door.approve(noTransfers.vendor.id)
    assert(r3.status === 409 && r3.code === 'VENDOR_PAYOUTS_NOT_ENABLED', `payouts active but transfers NOT → 409 VENDOR_PAYOUTS_NOT_ENABLED (got ${r3.status} ${r3.code})`)
    assert(await snapshot(noTransfers.vendor.id, noTransfers.ownerId) === UNCHANGED, '…and nothing changed')

    const down = await mkVendor()
    stub.set(down.account!, 'throw')
    const r4 = await door.approve(down.vendor.id)
    assert(r4.status === 503 && r4.code === 'STRIPE_CHECK_FAILED' && !!r4.message?.includes('Nothing was changed'),
      `Stripe unreachable → 503 STRIPE_CHECK_FAILED (fails closed) (got ${r4.status} ${r4.code})`)
    assert(await snapshot(down.vendor.id, down.ownerId) === UNCHANGED, '…and nothing changed')

    const gone = await mkVendor()
    stub.set(gone.account!, 'missing')
    const r5 = await door.approve(gone.vendor.id)
    assert(r5.status === 409 && r5.code === 'VENDOR_STRIPE_NOT_LINKED', `Stripe can't find the account on file → 409 VENDOR_STRIPE_NOT_LINKED (got ${r5.status} ${r5.code})`)
    assert(await snapshot(gone.vendor.id, gone.ownerId) === UNCHANGED, '…and nothing changed')

    const ok = await mkVendor()
    const r6 = await door.approve(ok.vendor.id)
    assert(r6.status === 200 && (await snapshot(ok.vendor.id, ok.ownerId)) === 'ACTIVE|APPROVED|1|1',
      `[0] control: linked, transfers + payouts active → approved: booth ACTIVE, owner APPROVED, one audit row, one email (got ${r6.status} ${await snapshot(ok.vendor.id, ok.ownerId)})`)
  }

  // ── [3] asked fresh ─────────────────────────────────────────────────────────────────────
  console.log('\n[3] Stripe is asked fresh; the stored flag catches up')
  const staleOff = await mkVendor({ stored: false })
  asked.length = 0
  const s1 = await DOORS[1].approve(staleOff.vendor.id)
  const s1row = await prisma.vendor.findUnique({ where: { id: staleOff.vendor.id }, select: { status: true, stripeVerified: true } })
  assert(s1.status === 200 && s1row?.status === 'ACTIVE', `stored flag says "not connected" but Stripe now says ready → approved (got ${s1.status})`)
  assert(s1row?.stripeVerified === true, 'and the stored flag caught up (true), through the one writer')
  assert(asked.length === 1 && asked[0] === staleOff.account, 'Stripe was asked exactly once, for THIS vendor\'s account')

  const staleOn = await mkVendor({ stored: true })
  stub.set(staleOn.account!, { readyToReceivePayments: false, payoutsEnabled: false })
  const s2 = await DOORS[1].approve(staleOn.vendor.id)
  const s2row = await prisma.vendor.findUnique({ where: { id: staleOn.vendor.id }, select: { status: true, stripeVerified: true } })
  assert(s2.status === 409 && s2row?.status === 'PENDING', `stored flag says "connected" but Stripe now says restricted → refused (got ${s2.status} ${s2.code})`)
  assert(s2row?.stripeVerified === false, 'and the stored flag caught up (false)')

  const notReadyToo = await prisma.vendor.create({
    data: { eventId: ev.id, name: `${PFX}Bare ${rand()}`, slug: `${PFX}bare-${rand()}`, cuisineType: 'x', status: VendorStatus.PENDING,
      foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf' },
  })
  const s3 = await DOORS[1].approve(notReadyToo.id)
  assert(s3.status === 409 && s3.code === 'VENDOR_STRIPE_NOT_LINKED' && !!s3.message?.includes('Also still needed: Add your menu, Set booth number')
    && JSON.stringify(s3.details?.missing) === JSON.stringify(['Connect payouts', 'Add your menu', 'Set booth number']),
  `no Stripe AND other items missing → the Stripe message plus "Also still needed: …" naming the rest (got ${s3.message} ${JSON.stringify(s3.details?.missing)})`)

  const rejectNoStripe = await mkVendor({ account: null })
  login(SUPER)
  const rj = await call(fairReject(req(`/api/admin/vendors/${rejectNoStripe.vendor.id}/reject`, 'PATCH', { reason: 'No space' }), { params: Promise.resolve({ id: rejectNoStripe.vendor.id }) }))
  assert(rj.status === 200 && (await snapshot(rejectNoStripe.vendor.id, rejectNoStripe.ownerId)) === 'REJECTED|REJECTED|1|1',
    `[0] control: a REJECT needs no Stripe at all (got ${rj.status})`)

  // ── [4] reviewer recorded, one transaction ──────────────────────────────────────────────
  console.log('\n[4] Who decided, and when — recorded with the decision')
  for (const [door, who, expectName] of [[0, PM, 'Pat Manager'], [1, ADMIN, 'Avery Admin'], [2, SUPER, 'Sam Super']] as const) {
    const v = await mkVendor()
    const t0 = Date.now()
    await DOORS[door].approve(v.vendor.id)
    const a = await prisma.approvalAction.findFirst({ where: { applicationId: v.vendor.id, action: 'APPROVE' } })
    assert(a?.actorName === expectName && a.actorId === who.id && a.actorType === who.roles[0] && a.createdAt.getTime() >= t0 - 1000 && a.createdAt.getTime() <= Date.now() + 1000,
      `${DOORS[door].name}: APPROVE row records "${expectName}", the Clerk id, the role and the time (got ${a?.actorName}/${a?.actorType})`)
  }
  const fb = await mkVendor()
  login(NONAME)
  await call(decideRoute(req(`/api/admin/approvals/vendor/${fb.vendor.id}`, 'POST', { decision: 'approve' }), { params: Promise.resolve({ kind: 'vendor', id: fb.vendor.id }) }))
  const fbRow = await prisma.approvalAction.findFirst({ where: { applicationId: fb.vendor.id } })
  assert(fbRow?.actorName === 'fallback.reviewer', `no sign-in name and no account name → the email before the @ (got ${fbRow?.actorName})`)
  const rejV = await mkVendor()
  login(ADMIN)
  await call(fairReject(req(`/api/admin/vendors/${rejV.vendor.id}/reject`, 'PATCH', { reason: 'Duplicate application' }), { params: Promise.resolve({ id: rejV.vendor.id }) }))
  const rejRow = await prisma.approvalAction.findFirst({ where: { applicationId: rejV.vendor.id } })
  assert(rejRow?.action === 'REJECT' && rejRow.actorName === 'Avery Admin' && rejRow.reason === 'Duplicate application', 'a REJECT records the reviewer\'s name and the reason too')

  // Forced audit failure (test DB only, trigger always dropped): the decision must roll back whole.
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION vap_fail_audit_fn() RETURNS trigger AS $$
    BEGIN IF NEW."actorName" = '${FAIL_NAME}' THEN RAISE EXCEPTION 'vap forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
  await prisma.$executeRawUnsafe(`CREATE TRIGGER vap_fail_audit BEFORE INSERT ON "ApprovalAction" FOR EACH ROW EXECUTE FUNCTION vap_fail_audit_fn()`)
  try {
    const rb = await mkVendor()
    login({ id: `${PFX}failer`, roles: ['admin'], fullName: FAIL_NAME })
    const r = await call(decideRoute(req(`/api/admin/approvals/vendor/${rb.vendor.id}`, 'POST', { decision: 'approve' }), { params: Promise.resolve({ kind: 'vendor', id: rb.vendor.id }) }))
    assert(r.status >= 500 && (await snapshot(rb.vendor.id, rb.ownerId)) === UNCHANGED,
      `audit row fails → the whole decision rolls back: booth and owner still PENDING, no email (got ${r.status} ${await snapshot(rb.vendor.id, rb.ownerId)})`)
  } finally {
    await dropTrigger()
  }

  // ── [5] visibility end to end ───────────────────────────────────────────────────────────
  console.log('\n[5] Who can see the name')
  const seen = await mkVendor()
  await DOORS[1].approve(seen.vendor.id) // decided by "Avery Admin"
  login(SUPER)
  const adminList = (await import('../app/api/admin/events/[id]/vendors/route')).GET
  const al = await call(adminList(req(`/api/admin/events/${ev.urlSlug}/vendors?take=200`), { params: Promise.resolve({ id: ev.urlSlug }) }))
  const row = al.data?.vendors?.find(v => v.id === seen.vendor.id)
  assert(al.status === 200 && row?.review?.decision === 'APPROVE' && row.review.by === 'Avery Admin' && !!row.review.at,
    `admin fair roster: "Approved by Avery Admin" with the time (got ${JSON.stringify(row?.review)})`)

  login({ id: orgUser.clerkId, roles: ['organizer'] })
  const orgList = (await import('../app/api/organizer/fairs/[fairSlug]/vendors/route')).GET
  const ol = await call(orgList(req(`/api/organizer/fairs/${ev.urlSlug}/vendors`), { params: Promise.resolve({ fairSlug: ev.urlSlug }) }))
  assert(ol.status === 200 && !ol.raw.includes('Avery') && !ol.raw.includes('actorName'), `organizer fair vendor list: no FairSynq reviewer name anywhere (status ${ol.status})`)
  const orgDetail = (await import('../app/api/organizer/vendors/[id]/route')).GET
  const od = await call(orgDetail(req(`/api/organizer/vendors/${seen.vendor.id}`), { params: Promise.resolve({ id: seen.vendor.id }) }))
  assert(od.status === 200 && !od.raw.includes('Avery') && !od.raw.includes('actorName'), `organizer vendor detail: no FairSynq reviewer name anywhere (status ${od.status})`)

  const { computeVendorReadiness } = await import('../lib/vendor-readiness')
  const readiness = JSON.stringify(await computeVendorReadiness(seen.vendor.id))
  assert(!readiness.includes('Avery') && !readiness.includes('actorName'), 'vendor readiness (the vendor\'s own checklist): no reviewer name')
  const { renderEmail } = await import('../lib/notifications')
  const mail = await prisma.notification.findFirst({ where: { dedupeKey: `decision:vendor:${seen.vendor.id}:approved` } })
  const rendered = mail ? renderEmail(mail.template, mail.payload) : null
  assert(!!rendered && !JSON.stringify(mail!.payload).includes('Avery') && !rendered.text.includes('Avery') && !rendered.subject.includes('Avery') && rendered.subject.includes('FairSynq'),
    `vendor decision email: says "FairSynq", never the reviewer's name (subject: ${rendered?.subject})`)

  // ── [6] source checks ───────────────────────────────────────────────────────────────────
  console.log('\n[6] Source checks')
  const src = readFileSync('lib/approvals.ts', 'utf8').replace(/\r\n/g, '\n')
  const decideBody = src.slice(src.indexOf('export async function decideVendor'), src.indexOf('// ── Organizer (platform-wide account)'))
  const iCheck = decideBody.indexOf('await checkVendorPayouts(vendor)')
  const iApproveBranch = decideBody.indexOf("if (decision === 'approve') {")
  const iTx = decideBody.indexOf('db.$transaction(')
  assert(iCheck > iApproveBranch && iApproveBranch >= 0 && iCheck < iTx, 'decideVendor: the Stripe check runs inside the approve branch, BEFORE the transaction (no network call inside it)')
  assert((decideBody.match(/checkVendorPayouts\(/g) ?? []).length === 1, 'decideVendor: exactly one Stripe check')
  for (const f of ['app/api/admin/vendors/[id]/approve/route.ts', 'app/api/admin/vendors/[id]/reject/route.ts']) {
    assert(/name: reviewerNameFrom\(/.test(readFileSync(f, 'utf8')), `${f} passes the reviewer's sign-in name`)
  }
  assert(/name: reviewerNameFrom\(/.test(readFileSync('lib/auth.ts', 'utf8')), 'requireApprovalsAdmin returns the reviewer\'s sign-in name (approvals page)')
  const shared = readFileSync('lib/fair-vendors.ts', 'utf8')
  assert(!/actorName|latestVendorReviews|approvalAction/.test(shared), 'the shared roster core (also used by organizers) reads no reviewer data')
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
