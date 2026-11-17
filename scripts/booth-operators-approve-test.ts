/**
 * BOOTH OPERATORS APPROVE (Jordan, Nov 16; sub-step C). Real routes and lib, test DB, Clerk mocked,
 * Stripe stubbed through the seam (never called).
 *
 * The bug: admitting a booth's OWNER on Booth Operators set VendorMember.approvalStatus but left
 * Vendor.status PENDING. Now, for the owner of a PENDING booth:
 *   [1] fair with NO organizer → the full vendor approval: booth ACTIVE + owner APPROVED together,
 *       ApprovalAction (reviewer name, detail.via 'booth-operators'), the vendor's email
 *   [2] …refused (no Stripe account / payouts off / Stripe down / checklist) → NOTHING changes:
 *       owner stays PENDING, booth PENDING, no record, no email
 *   [3] a REJECTED owner ("Admit anyway") on such a booth is re-admitted with the booth
 *   [4] fair WITH an organizer → the person only; booth stays PENDING; boothWaitsForOrganizer; no
 *       record, no email, no Stripe check
 *   [5] unchanged: staff rows; owners of ACTIVE / REJECTED booths; the reject route never touches
 *       the booth; who may call it (strict admins only)
 *   [6] the list says whether the fair's organizer approves; the panel's wording
 *
 * Run:  ./scripts/with-test-db.sh npx tsx scripts/booth-operators-approve-test.ts
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
const PFX = 'bop-'
const MAIL = '@bop.local'
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
interface CallJson {
  error?: { code?: string; message?: string }
  data?: {
    boothApproved?: boolean; boothWaitsForOrganizer?: boolean
    vendorMember?: { approvalStatus?: string; vendor?: { status?: string } }
    vendorMembers?: { id: string; fair: { organizerApproves?: boolean } | null }[]
  }
}
async function call(p: Promise<Response>) {
  const r = await p
  let j: CallJson = {}
  try { j = await r.json() as CallJson } catch { /* not JSON */ }
  return { status: r.status, code: j?.error?.code, data: j?.data }
}

const SUPER: Who = { id: `${PFX}super`, roles: ['super_admin'], fullName: 'Sam Super' }
const PM: Who = { id: `${PFX}pm`, roles: ['platform_manager'], fullName: 'Pat Manager' }

type StubAnswer = { readyToReceivePayments: boolean; payoutsEnabled: boolean } | 'throw'
const stub = new Map<string, StubAnswer>()
let stripeCalls = 0

async function cleanup() {
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
  const payouts = await import('../lib/vendor-payouts-check')
  payouts.__setStripePayoutsStatusForTest(async (acct: string) => {
    stripeCalls++
    const a = stub.get(acct) ?? { readyToReceivePayments: true, payoutsEnabled: true }
    if (a === 'throw') throw new Error('stripe down (stub)')
    return a
  })

  await prisma.user.create({ data: { clerkId: SUPER.id, email: `super${MAIL}`, name: 'Super (db name)' } })
  await prisma.user.create({ data: { clerkId: PM.id, email: `pm${MAIL}`, name: 'PM' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  const fsEv = await prisma.event.create({ data: { name: `${PFX}FS Fair`, urlSlug: `${PFX}fs-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const orgEv = await prisma.event.create({ data: { name: `${PFX}Org Fair`, urlSlug: `${PFX}org-${rand()}`, status: EventStatus.UPCOMING, organizerId: org.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  const mkBooth = async (opts: { eventId?: string; status?: VendorStatus; account?: string | null; menu?: boolean; ownerStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {}) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: opts.eventId ?? fsEv.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: opts.status ?? VendorStatus.PENDING,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`,
        foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf', boothNumber: 'A1', stripeVerified: true,
        stripeAccountId: opts.account === undefined ? `acct_${PFX}${rand()}` : opts.account,
        vendorMembers: { create: { userId: u.id, role: 'owner', approvalStatus: opts.ownerStatus ?? 'PENDING', ...(opts.ownerStatus === 'REJECTED' && { rejectionReason: 'Earlier no' }) } },
        ...(opts.menu !== false && { menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } } }),
      },
      include: { vendorMembers: true },
    })
    return { vendor: v, ownerId: v.vendorMembers[0].id, account: v.stripeAccountId }
  }
  const state = async (vendorId: string, memberId: string) => {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true } })
    const m = await prisma.vendorMember.findUnique({ where: { id: memberId }, select: { approvalStatus: true, rejectionReason: true } })
    const audits = await prisma.approvalAction.count({ where: { applicationId: vendorId } })
    const mails = await prisma.notification.count({ where: { dedupeKey: { contains: vendorId } } })
    return { booth: v?.status, member: m?.approvalStatus, reason: m?.rejectionReason ?? null, key: `${v?.status}|${m?.approvalStatus}|${audits}|${mails}` }
  }

  const approveRoute = (await import('../app/api/admin/vendor-members/[id]/approve/route')).PATCH
  const rejectRoute = (await import('../app/api/admin/vendor-members/[id]/reject/route')).PATCH
  const approve = (who: Who, id: string) => { login(who); return call(approveRoute(req(`/api/admin/vendor-members/${id}/approve`, 'PATCH', {}), { params: Promise.resolve({ id }) })) }
  const reject = (who: Who, id: string, reason: string) => { login(who); return call(rejectRoute(req(`/api/admin/vendor-members/${id}/reject`, 'PATCH', { reason }), { params: Promise.resolve({ id }) })) }

  // ── [1] organizer-less fair: the full approval ──────────────────────────────────────────
  console.log('\n[1] Owner of a PENDING booth, fair with no organizer → the full approval')
  const ok = await mkBooth()
  const r1 = await approve(SUPER, ok.ownerId)
  const s1 = await state(ok.vendor.id, ok.ownerId)
  assert(r1.status === 200 && s1.booth === 'ACTIVE' && s1.member === 'APPROVED' && r1.data?.boothApproved === true && r1.data?.boothWaitsForOrganizer === false,
    `booth ACTIVE + owner APPROVED together, response says boothApproved (got ${r1.status} ${s1.key})`)
  assert(r1.data?.vendorMember?.approvalStatus === 'APPROVED' && r1.data.vendorMember.vendor?.status === 'ACTIVE', 'the response shows the person and the booth as they now are')
  const a1 = await prisma.approvalAction.findFirst({ where: { applicationId: ok.vendor.id, action: 'APPROVE' } })
  const d1 = a1?.detail as Record<string, unknown> | null
  const superUser = await prisma.user.findUnique({ where: { clerkId: SUPER.id }, select: { id: true } })
  const om1 = await prisma.vendorMember.findUnique({ where: { id: ok.ownerId }, select: { approvedBy: true, approvedAt: true } })
  assert(a1?.actorName === 'Sam Super' && a1.actorType === 'super_admin' && d1?.via === 'booth-operators' && d1?.ownerChanged === true,
    `one APPROVE record: the reviewer's name, role, detail.via 'booth-operators' (got ${a1?.actorName}/${String(d1?.via)})`)
  assert(om1?.approvedBy === superUser?.id && !!om1?.approvedAt, 'the owner row records who admitted them (the admin\'s User.id) and when, as before')
  const mails1 = await prisma.notification.findMany({ where: { dedupeKey: { contains: ok.vendor.id } } })
  assert(mails1.length === 1 && mails1[0].template === 'decision_approved', 'the vendor\'s approved email is queued (one)')

  // ── [2] refusals change nothing ─────────────────────────────────────────────────────────
  console.log('\n[2] A refused approval changes NOTHING (owner stays pending)')
  const noAcct = await mkBooth({ account: null })
  const r2a = await approve(SUPER, noAcct.ownerId)
  assert(r2a.status === 409 && r2a.code === 'VENDOR_STRIPE_NOT_LINKED' && (await state(noAcct.vendor.id, noAcct.ownerId)).key === 'PENDING|PENDING|0|0',
    `no Stripe account → 409 VENDOR_STRIPE_NOT_LINKED, owner + booth still PENDING, no record, no email (got ${r2a.status} ${r2a.code})`)
  const noPay = await mkBooth()
  stub.set(noPay.account!, { readyToReceivePayments: true, payoutsEnabled: false })
  const r2b = await approve(SUPER, noPay.ownerId)
  assert(r2b.status === 409 && r2b.code === 'VENDOR_PAYOUTS_NOT_ENABLED' && (await state(noPay.vendor.id, noPay.ownerId)).key === 'PENDING|PENDING|0|0',
    `payouts not enabled → 409 VENDOR_PAYOUTS_NOT_ENABLED, nothing changed (got ${r2b.code})`)
  const down = await mkBooth()
  stub.set(down.account!, 'throw')
  const r2c = await approve(SUPER, down.ownerId)
  assert(r2c.status === 503 && r2c.code === 'STRIPE_CHECK_FAILED' && (await state(down.vendor.id, down.ownerId)).key === 'PENDING|PENDING|0|0',
    `Stripe unreachable → 503 STRIPE_CHECK_FAILED, nothing changed (got ${r2c.status} ${r2c.code})`)
  const noMenu = await mkBooth({ menu: false })
  const r2d = await approve(SUPER, noMenu.ownerId)
  assert(r2d.status === 409 && r2d.code === 'VENDOR_NOT_READY_TO_GO_LIVE' && (await state(noMenu.vendor.id, noMenu.ownerId)).key === 'PENDING|PENDING|0|0',
    `checklist incomplete (no menu) → 409 VENDOR_NOT_READY_TO_GO_LIVE, nothing changed (got ${r2d.code})`)

  // ── [3] a rejected owner re-admitted ────────────────────────────────────────────────────
  console.log('\n[3] "Admit anyway" on a rejected owner of a pending booth')
  const back = await mkBooth({ ownerStatus: 'REJECTED' })
  const r3 = await approve(SUPER, back.ownerId)
  const s3 = await state(back.vendor.id, back.ownerId)
  const d3 = (await prisma.approvalAction.findFirst({ where: { applicationId: back.vendor.id } }))?.detail as Record<string, unknown> | null
  assert(r3.status === 200 && s3.booth === 'ACTIVE' && s3.member === 'APPROVED' && s3.reason === null && d3?.ownerBefore === 'REJECTED' && d3?.ownerChanged === true,
    `owner re-admitted (reason cleared) and the booth approved with them; the record notes the owner was REJECTED (got ${r3.status} ${s3.key})`)
  const backNoAcct = await mkBooth({ ownerStatus: 'REJECTED', account: null })
  const r3b = await approve(SUPER, backNoAcct.ownerId)
  const s3b = await state(backNoAcct.vendor.id, backNoAcct.ownerId)
  assert(r3b.status === 409 && s3b.booth === 'PENDING' && s3b.member === 'REJECTED' && s3b.reason === 'Earlier no',
    `…but refused by Stripe → the owner stays REJECTED with their reason, booth PENDING (got ${r3b.status} ${s3b.key})`)

  // ── [4] organizer's fair: the person only ───────────────────────────────────────────────
  console.log("\n[4] Owner of a PENDING booth on an organizer's fair → the person only")
  const og = await mkBooth({ eventId: orgEv.id, account: null })
  const callsBefore = stripeCalls
  const r4 = await approve(SUPER, og.ownerId)
  const s4 = await state(og.vendor.id, og.ownerId)
  assert(r4.status === 200 && s4.key === 'PENDING|APPROVED|0|0' && r4.data?.boothWaitsForOrganizer === true && r4.data?.boothApproved === false,
    `owner APPROVED, booth still PENDING, no record, no email, response says boothWaitsForOrganizer (got ${r4.status} ${s4.key})`)
  assert(stripeCalls === callsBefore, 'no Stripe check (nothing is being approved for trading)')

  // ── [5] unchanged cases ─────────────────────────────────────────────────────────────────
  console.log('\n[5] Unchanged: staff, booths not pending, the reject route, who may call it')
  const withStaff = await mkBooth()
  const staffUser = await prisma.user.create({ data: { clerkId: `${PFX}st-${rand()}`, email: `st-${rand()}${MAIL}`, name: 'Staff' } })
  const staff = await prisma.vendorMember.create({ data: { vendorId: withStaff.vendor.id, userId: staffUser.id, role: 'staff', approvalStatus: 'PENDING' } })
  const r5a = await approve(SUPER, staff.id)
  assert(r5a.status === 200 && (await state(withStaff.vendor.id, staff.id)).key === 'PENDING|APPROVED|0|0' && r5a.data?.boothApproved === false,
    `a STAFF row on a pending booth → the person only, booth PENDING, no record (got ${r5a.status})`)
  const activeBooth = await mkBooth({ status: VendorStatus.ACTIVE })
  const r5b = await approve(SUPER, activeBooth.ownerId)
  assert(r5b.status === 200 && (await state(activeBooth.vendor.id, activeBooth.ownerId)).key === 'ACTIVE|APPROVED|0|0',
    `owner of an ACTIVE booth → the person only, no record (got ${r5b.status})`)
  const rejBooth = await mkBooth({ status: VendorStatus.REJECTED })
  const r5c = await approve(SUPER, rejBooth.ownerId)
  assert(r5c.status === 200 && (await state(rejBooth.vendor.id, rejBooth.ownerId)).key === 'REJECTED|APPROVED|0|0',
    `owner of a REJECTED booth → the person only, booth stays REJECTED (got ${r5c.status})`)
  const toRefuse = await mkBooth()
  const r5d = await reject(SUPER, toRefuse.ownerId, 'Wrong person')
  assert(r5d.status === 200 && (await state(toRefuse.vendor.id, toRefuse.ownerId)).key === 'PENDING|REJECTED|0|0',
    `the reject route refuses the person only; the booth is untouched (got ${r5d.status})`)
  const pmTry = await mkBooth()
  const r5e = await approve(PM, pmTry.ownerId)
  assert(r5e.status === 403 && (await state(pmTry.vendor.id, pmTry.ownerId)).key === 'PENDING|PENDING|0|0',
    `platform_manager → 403 (strict admins only, as before), nothing changed (got ${r5e.status})`)

  // ── [6] the list and the panel ──────────────────────────────────────────────────────────
  console.log('\n[6] The list says who approves the booth; the panel says so in words')
  const listRoute = (await import('../app/api/admin/vendor-members/route')).GET
  login(SUPER)
  const l = await call(listRoute(req('/api/admin/vendor-members')))
  const byId = new Map((l.data?.vendorMembers ?? []).map(m => [m.id, m.fair?.organizerApproves]))
  assert(l.status === 200 && byId.get(og.ownerId) === true && byId.get(noAcct.ownerId) === false,
    'organizerApproves: true on the organizer\'s fair, false on the fair with no organizer')
  const panel = readFileSync('app/admin/_components/VendorOperatorsPanel.tsx', 'utf8')
  assert(panel.includes(`export const BOOTH_WAITS_FOR_ORGANIZER = "Booth waits for the organizer's approval."`)
    && /op\.fair\?\.organizerApproves\s*\?\s*BOOTH_WAITS_FOR_ORGANIZER/.test(panel)
    && /\$\{BOOTH_WAITS_FOR_ORGANIZER\}/.test(panel),
  'panel: "Booth waits for the organizer\'s approval." for a pending booth on an organizer\'s fair (queue and admitted row)')
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
