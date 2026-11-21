/**
 * A REJECTED BOOTH LEAVES REJECTED ONLY BY RE-APPROVAL (independent review F5; Jordan, Nov 17).
 *
 * THE BUG. The organizer status route let REJECTED → PAUSED (or SUSPENDED) through as a plain
 * write, and the go-live check for lifting a pause asked "was this booth EVER approved"
 * (lib/vendor-go-live.ts vendorApprovedForEvent counted any APPROVE). So REJECTED → PAUSED → ACTIVE
 * put a rejected booth live with no re-approval, no fresh Stripe payouts check, no approval record
 * and no email, and could undo a FairSynq rejection.
 *
 * Locked decisions:
 *   1. Only reconsiderVendor (the full approval path) may move a booth out of REJECTED.
 *   2. "Approved for this event" reads the LATEST decision, not any decision ever made.
 *   3. A vendor's own pause / auto-resume on an approved booth keeps working.
 *   4. Refusals are 409 and change nothing.
 *
 *   [1] organizer status changes out of REJECTED other than re-approval → 409, nothing changes
 *   [2] "approved for event" = the newest decision (ApprovalAction and the organizer status log)
 *   [3] the allowed path: re-approval (reconsiderVendor) still works, Stripe asked fresh
 *   [4] the other doors can't move a REJECTED booth either (admin, approvals page, Booth
 *       Operators, demo switch, the vendor's own PATCH)
 *   [5] a vendor's own pause / resume, and an organizer pause / lift, on an approved booth
 *   [6] source checks: the organizer route's status write is conditional on the status it read;
 *       the inventory of Vendor writes in app/, lib/, workers/ (with a positive control); every
 *       vendor APPROVE / REJECT record gets its number from nextDecisionSeq (with positive controls)
 *   [7] clock-safe order (Jordan, Nov 17): decisions are ordered by the booth's decision number
 *       (detail.seq), never by clocks — status-log clock ahead, a second server's clock behind,
 *       approval clocks after a rejection, numbers 1, 2, 3, two decisions at the same moment,
 *       and the demo switch writing no number
 *
 * Real route handlers on the test DB; Clerk identity and next/cache mocked
 * (scripts/_route-loader.mjs); Stripe stubbed through lib/vendor-payouts-check.ts's test seam.
 *
 * Run: ./scripts/with-test-db.sh npx tsx scripts/vendor-rejected-exit-test.ts
 * Self-cleaning, prefix vrx-.
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
delete process.env.SLACK_WEBHOOK_URL

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { readFileSync, readdirSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { EventStatus, VendorStatus } from '@prisma/client'

const prisma = testPrisma()
const PFX = 'vrx-'
const MAIL = '@vrx.local'
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
interface CallJson { error?: { code?: string; message?: string; details?: { missing?: string[] } }; data?: Record<string, unknown> }
async function call(p: Promise<Response>) {
  const r = await p
  const text = await r.text()
  let j: CallJson = {}
  try { j = JSON.parse(text) as CallJson } catch { /* not JSON */ }
  return { status: r.status, code: j?.error?.code, message: j?.error?.message, missing: j?.error?.details?.missing, data: j?.data }
}
/** The organizer route writes its status-change audit row fire-and-forget, after the response. */
const settle = () => new Promise(r => setTimeout(r, 400))

const SUPER: Who = { id: `${PFX}super`, roles: ['super_admin'], fullName: 'Sam Super' }

type StubAnswer = { readyToReceivePayments: boolean; payoutsEnabled: boolean }
const stub = new Map<string, StubAnswer>()

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walkTs(`${dir}/${e.name}`))
      : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])
}

/** Every call matching `re` (which must end at the opening parenthesis) in a source text: where it
 *  starts and its full text up to the matching closing parenthesis. */
function callsOf(src: string, re: RegExp): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
      i++
    }
    out.push({ at: m.index, text: src.slice(m.index, i) })
  }
  return out
}

/** Every `<client>.vendor.update|updateMany|upsert(` call in a source text, with its full argument text. */
function vendorWriteCalls(src: string): string[] {
  return callsOf(src, /\.vendor\.(update|updateMany|upsert)\s*\(/g).map(c => c.text)
}

/**
 * Vendor decision records (an approvalAction.create naming applicationType 'vendor' and APPROVE or
 * REJECT) that do NOT take their number from nextDecisionSeq right after the booth update in the
 * same function: the create must carry `seq`, and `const seq = await nextDecisionSeq(tx, …)` must
 * sit after the function's `flip.count === 0` check and before the create.
 */
function seqOffenders(src: string, file: string): string[] {
  const out: string[] = []
  for (const c of callsOf(src, /\.approvalAction\.create\s*\(/g)) {
    if (!/applicationType:\s*'vendor'/.test(c.text) || !/'APPROVE'|'REJECT'/.test(c.text)) continue
    const fnStart = src.lastIndexOf('async function ', c.at)
    const flipAt = src.lastIndexOf('flip.count === 0', c.at)
    const seqAt = src.lastIndexOf('const seq = await nextDecisionSeq(tx, ', c.at)
    const ok = /\bseq\b/.test(c.text) && fnStart !== -1 && flipAt > fnStart && seqAt > flipAt
    if (!ok) out.push(`${file}@${c.at}`)
  }
  return out
}
/**
 * Vendor decision records whose `detail` object does NOT end with `seq` (Jordan, Nov 17: seq goes
 * after every spread, so nothing spread into detail can overwrite the decision number).
 */
function seqNotLast(src: string, file: string): string[] {
  const out: string[] = []
  for (const c of callsOf(src, /\.approvalAction\.create\s*\(/g)) {
    if (!/applicationType:\s*'vendor'/.test(c.text) || !/'APPROVE'|'REJECT'/.test(c.text)) continue
    const open = c.text.indexOf('{', c.text.indexOf('detail:'))
    let i = open + 1, depth = 1
    while (open !== -1 && i < c.text.length && depth > 0) {
      if (c.text[i] === '{') depth++
      else if (c.text[i] === '}') depth--
      i++
    }
    const body = open === -1 ? '' : c.text.slice(open + 1, i - 1).replace(/\/\/[^\n]*/g, '').trim().replace(/,$/, '').trim()
    if (!/(^|[\s,])seq$/.test(body)) out.push(`${file}@${c.at}`)
  }
  return out
}
/** How many vendor decision records a source text creates (for the inventory). */
const decisionCreates = (src: string) => callsOf(src, /\.approvalAction\.create\s*\(/g)
  .filter(c => /applicationType:\s*'vendor'/.test(c.text) && /'APPROVE'|'REJECT'/.test(c.text)).length

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
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ A REJECTED BOOTH LEAVES REJECTED ONLY BY RE-APPROVAL (F5) ══')
  await cleanup()

  // ── fixtures ────────────────────────────────────────────────────────────────────────────
  const payouts = await import('../lib/vendor-payouts-check')
  payouts.__setStripePayoutsStatusForTest(async (acct: string) => stub.get(acct) ?? { readyToReceivePayments: true, payoutsEnabled: true })

  await prisma.user.create({ data: { clerkId: SUPER.id, email: `super${MAIL}`, name: 'Super' } })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}orgu`, email: `orgu${MAIL}`, name: 'Olive Organizer' } })
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}County Board`, contactEmail: `board${MAIL}`, approvalStatus: 'APPROVED' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const ORG: Who = { id: orgUser.clerkId, roles: ['organizer'] }

  const ev = await prisma.event.create({ data: { name: `${PFX}Org Fair`, urlSlug: `${PFX}${rand()}`, status: EventStatus.UPCOMING, organizerId: org.id, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })
  const fsEv = await prisma.event.create({ data: { name: `${PFX}FS Fair`, urlSlug: `${PFX}fs-${rand()}`, status: EventStatus.UPCOMING, startDate: new Date(), endDate: new Date(Date.now() + 864e5) } })

  /** A booth with the go-live checklist complete and a linked Stripe account (the stub says ready). */
  const mkVendor = async (opts: { status: VendorStatus; eventId?: string; ownerStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' }) => {
    const u = await prisma.user.create({ data: { clerkId: `${PFX}vu-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Owner', role: 'vendor' } })
    const v = await prisma.vendor.create({
      data: {
        eventId: opts.eventId ?? ev.id, name: `${PFX}Booth ${rand()}`, slug: `${PFX}v-${rand()}`, cuisineType: 'Tacos', status: opts.status,
        contactName: 'Ana', contactEmail: `ana-${rand()}${MAIL}`,
        foodHandlerPermitPath: 'x/fh.pdf', insurancePath: 'x/ins.pdf', businessLicensePath: 'x/bl.pdf', boothNumber: 'A1', stripeVerified: true,
        stripeAccountId: `acct_${PFX}${rand()}`,
        vendorMembers: { create: { userId: u.id, role: 'owner', approvalStatus: opts.ownerStatus ?? 'APPROVED' } },
        menuItems: { create: { name: 'Taco', price: 5, category: 'Mains', isAvailable: true } },
      },
      include: { vendorMembers: true },
    })
    return { vendor: v, user: u, ownerId: v.vendorMembers[0].id, account: v.stripeAccountId! }
  }
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
  const aa = (vendorId: string, action: 'APPROVE' | 'REJECT', at: Date, actorType = 'admin') => prisma.approvalAction.create({
    data: { action, applicationType: 'vendor', applicationId: vendorId, actorId: `${PFX}seed`, actorType, createdAt: at },
  })
  const statusLog = (vendorId: string, previousStatus: string, newStatus: string, at: Date) => prisma.vendorAuditLog.create({
    data: { vendorId, userId: orgUser.id, action: 'VENDOR_STATUS_CHANGED', metadata: { previousStatus, newStatus, reason: null }, createdAt: at },
  })
  /** The F5 starting point: approved once, then rejected by FairSynq (a strict-admin override). */
  const mkRejectedAfterApproval = async () => {
    const b = await mkVendor({ status: VendorStatus.REJECTED })
    await aa(b.vendor.id, 'APPROVE', t(60))
    await aa(b.vendor.id, 'REJECT', t(30))
    return b
  }
  const snapshot = async (vendorId: string) => {
    const v = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { status: true, boothNumber: true } })
    const audits = await prisma.approvalAction.count({ where: { applicationId: vendorId } })
    const logs = await prisma.vendorAuditLog.count({ where: { vendorId } })
    const mails = await prisma.notification.count({ where: { dedupeKey: { contains: vendorId } } })
    return { status: v.status, booth: v.boothNumber, audits, logs, mails, key: `${v.status}|${v.boothNumber}|${audits}|${logs}|${mails}` }
  }
  const statusOf = async (id: string) => (await prisma.vendor.findUniqueOrThrow({ where: { id }, select: { status: true } })).status

  const orgPATCH = (await import('../app/api/organizer/vendors/[id]/route')).PATCH
  const orgSet = (id: string, body: object) => { login(ORG); return call(orgPATCH(req(`/api/organizer/vendors/${id}`, 'PATCH', body), { params: Promise.resolve({ id }) })) }

  // ── [1] organizer status changes out of REJECTED ────────────────────────────────────────
  console.log('\n[1] Out of REJECTED: only re-approval; every other status change → 409, nothing changes')
  for (const target of ['PAUSED', 'SUSPENDED'] as const) {
    const b = await mkRejectedAfterApproval()
    const before = await snapshot(b.vendor.id)
    const r = await orgSet(b.vendor.id, { status: target, reason: 'Trying again' })
    await settle()
    const after = await snapshot(b.vendor.id)
    assert(r.status === 409 && r.code === 'VENDOR_REJECTED',
      `REJECTED → ${target} → 409 VENDOR_REJECTED (got ${r.status} ${r.code ?? ''})`)
    assert(after.key === before.key && after.status === 'REJECTED',
      `REJECTED → ${target}: still REJECTED, no new approval record, audit-log row or email (before ${before.key}, after ${after.key})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    const before = await snapshot(b.vendor.id)
    const r = await orgSet(b.vendor.id, { status: 'PAUSED', boothNumber: 'Z9' })
    await settle()
    const after = await snapshot(b.vendor.id)
    assert(r.status === 409 && r.code === 'VENDOR_REJECTED' && after.key === before.key && after.booth === 'A1',
      `REJECTED → PAUSED with a booth number → 409, the whole request refused (booth number still A1) (got ${r.status} ${r.code ?? ''}, ${after.key})`)
  }
  {
    // The full F5 chain: REJECTED → PAUSED → ACTIVE. Stripe says payouts are OFF for this booth, so
    // the only way out (a re-approval, which asks Stripe fresh) must refuse; the old plain lift went
    // live on the stored stripeVerified flag instead.
    const b = await mkRejectedAfterApproval()
    stub.set(b.account, { readyToReceivePayments: true, payoutsEnabled: false })
    const p = await orgSet(b.vendor.id, { status: 'PAUSED' })
    const a = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    const end = await statusOf(b.vendor.id)
    const approvals = await prisma.approvalAction.count({ where: { applicationId: b.vendor.id, action: 'APPROVE' } })
    assert(p.status === 409 && p.code === 'VENDOR_REJECTED' && a.status === 409 && a.code === 'VENDOR_PAYOUTS_NOT_ENABLED'
      && end === 'REJECTED' && approvals === 1,
    `the F5 chain with Stripe payouts off: → PAUSED 409 VENDOR_REJECTED, then → ACTIVE is a re-approval → 409 VENDOR_PAYOUTS_NOT_ENABLED; ends REJECTED, no new APPROVE record (got ${p.status} ${p.code ?? ''} then ${a.status} ${a.code ?? ''}, ends ${end}, ${approvals} APPROVE)`)
  }
  {
    const b = await mkRejectedAfterApproval()
    const r = await orgSet(b.vendor.id, { status: 'PENDING' })
    assert(r.status === 400 && await statusOf(b.vendor.id) === 'REJECTED', `[0] control: REJECTED → PENDING → 400 (not an allowed status), still REJECTED (got ${r.status})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    const r = await orgSet(b.vendor.id, { boothNumber: 'B2' })
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: b.vendor.id }, select: { status: true, boothNumber: true } })
    assert(r.status === 200 && after.status === 'REJECTED' && after.boothNumber === 'B2',
      `[0] control: a booth-number-only edit on a REJECTED booth is not a status change → 200, still REJECTED (got ${r.status} ${after.status} ${after.boothNumber})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    const before = await snapshot(b.vendor.id)
    const r = await orgSet(b.vendor.id, { status: 'REJECTED' })
    await settle()
    assert(r.status === 200 && (await snapshot(b.vendor.id)).key === before.key,
      `[0] control: REJECTED → REJECTED is a no-op → 200, nothing written (got ${r.status})`)
  }

  // ── [2] the newest decision ─────────────────────────────────────────────────────────────
  console.log('\n[2] "Approved for this event" reads the NEWEST decision')
  const { vendorApprovedForEvent } = await import('../lib/vendor-go-live')
  const approved = (id: string, requirePlatformAccountApproval?: boolean) =>
    vendorApprovedForEvent(prisma, id, requirePlatformAccountApproval === undefined ? {} : { requirePlatformAccountApproval })
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await aa(b.vendor.id, 'APPROVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30))
    assert(await approved(b.vendor.id) === false, 'APPROVE then REJECT → not approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await aa(b.vendor.id, 'REJECT', t(60)); await aa(b.vendor.id, 'APPROVE', t(30))
    assert(await approved(b.vendor.id) === true, '[0] REJECT then APPROVE (re-approved) → approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await statusLog(b.vendor.id, 'PENDING', 'ACTIVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30), 'organizer')
    assert(await approved(b.vendor.id) === false, 'an organizer-logged PENDING → ACTIVE, then a REJECT record → not approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await statusLog(b.vendor.id, 'PENDING', 'ACTIVE', t(60)); await statusLog(b.vendor.id, 'ACTIVE', 'REJECTED', t(30))
    assert(await approved(b.vendor.id) === false, 'an organizer-logged approval, then an organizer-logged rejection (older records) → not approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    assert(await approved(b.vendor.id) === false, '[0] control: no decision at all → not approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    const same = t(10)
    await aa(b.vendor.id, 'APPROVE', same); await aa(b.vendor.id, 'REJECT', same)
    assert(await approved(b.vendor.id) === false, 'an APPROVE and a REJECT at the same instant → not approved (a rejection wins a tie)')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await aa(b.vendor.id, 'APPROVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30))
    await statusLog(b.vendor.id, 'REJECTED', 'ACTIVE', t(10))
    assert(await approved(b.vendor.id) === false, 'a logged REJECTED → ACTIVE plain write (the old hole itself) is not an approval → not approved')
  }
  {
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await aa(b.vendor.id, 'APPROVE', t(60))
    assert(await approved(b.vendor.id, true) === true, '[0] two-approvals switch on: a FairSynq APPROVE as the newest decision → approved')
    await statusLog(b.vendor.id, 'ACTIVE', 'REJECTED', t(30))
    assert(await approved(b.vendor.id, true) === false, 'two-approvals switch on: a later logged rejection → not approved')
  }
  {
    // Data already revived through the hole: PAUSED now, but the newest decision is a rejection.
    const b = await mkVendor({ status: VendorStatus.PAUSED })
    await aa(b.vendor.id, 'APPROVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30))
    const r = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(r.status === 409 && r.code === 'VENDOR_NOT_READY_TO_GO_LIVE' && JSON.stringify(r.missing) === JSON.stringify(['Application approved'])
      && await statusOf(b.vendor.id) === 'PAUSED',
    `a PAUSED booth whose newest decision is a rejection: lifting the pause → 409, missing only "Application approved", still PAUSED (got ${r.status} ${JSON.stringify(r.missing)})`)
  }

  // ── [3] the allowed path ────────────────────────────────────────────────────────────────
  console.log('\n[3] The allowed path: re-approval (reconsiderVendor), Stripe asked fresh')
  {
    const b = await mkRejectedAfterApproval()
    const mailsBefore = await prisma.notification.count({ where: { dedupeKey: { contains: b.vendor.id }, template: 'decision_approved' } })
    const r = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    const newest = await prisma.approvalAction.findFirst({ where: { applicationId: b.vendor.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    const d = newest?.detail as Record<string, unknown> | null
    const mailsAfter = await prisma.notification.count({ where: { dedupeKey: { contains: b.vendor.id }, template: 'decision_approved' } })
    assert(r.status === 200 && await statusOf(b.vendor.id) === 'ACTIVE', `organizer re-approves the rejected booth → 200 ACTIVE (got ${r.status} ${r.code ?? ''})`)
    assert(newest?.action === 'APPROVE' && d?.reconsidered === true && d?.fromStatus === 'REJECTED' && newest.actorType === 'organizer',
      'its newest record is an APPROVE marked reconsidered, from REJECTED, by the organizer')
    assert(mailsAfter === mailsBefore + 1, `the vendor gets a new approved email (${mailsBefore} → ${mailsAfter})`)
    const p = await orgSet(b.vendor.id, { status: 'PAUSED' })
    const l = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(p.status === 200 && l.status === 200 && await statusOf(b.vendor.id) === 'ACTIVE',
      `after re-approval, pause and lift work again (the newest decision is the approval) (got ${p.status}/${l.status} ${l.code ?? ''})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    stub.set(b.account, { readyToReceivePayments: true, payoutsEnabled: false })
    const before = await snapshot(b.vendor.id)
    const r = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(r.status === 409 && r.code === 'VENDOR_PAYOUTS_NOT_ENABLED' && (await snapshot(b.vendor.id)).key === before.key,
      `re-approval with Stripe payouts off → 409 VENDOR_PAYOUTS_NOT_ENABLED, nothing changed (got ${r.status} ${r.code ?? ''})`)
  }

  // ── [4] the other doors ─────────────────────────────────────────────────────────────────
  console.log('\n[4] No other door moves a REJECTED booth')
  const decideRoute = (await import('../app/api/admin/approvals/[kind]/[id]/route')).POST
  const fairApprove = (await import('../app/api/admin/vendors/[id]/approve/route')).PATCH
  const fairReject = (await import('../app/api/admin/vendors/[id]/reject/route')).PATCH
  const memberApprove = (await import('../app/api/admin/vendor-members/[id]/approve/route')).PATCH
  const demoRoute = (await import('../app/api/admin/vendors/[id]/demo/route')).PATCH
  const vendorPATCH = (await import('../app/api/vendors/[id]/route')).PATCH
  for (const [where, eventId, reason] of [['fair with no organizer', fsEv.id, undefined], ["organizer's fair (override with a reason)", ev.id, 'Organizer away']] as const) {
    const b = await mkVendor({ status: VendorStatus.REJECTED, eventId })
    await aa(b.vendor.id, 'APPROVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30))
    const before = await snapshot(b.vendor.id)
    login(SUPER)
    const r1 = await call(decideRoute(req(`/api/admin/approvals/vendor/${b.vendor.id}`, 'POST', { decision: 'approve', reason }), { params: Promise.resolve({ kind: 'vendor', id: b.vendor.id }) }))
    login(SUPER)
    const r2 = await call(fairApprove(req(`/api/admin/vendors/${b.vendor.id}/approve`, 'PATCH', { reason }), { params: Promise.resolve({ id: b.vendor.id }) }))
    login(SUPER)
    const r3 = await call(fairReject(req(`/api/admin/vendors/${b.vendor.id}/reject`, 'PATCH', { reason: reason ?? 'Again' }), { params: Promise.resolve({ id: b.vendor.id }) }))
    assert([r1, r2, r3].every(r => r.status === 409 && r.code === 'ALREADY_DECIDED') && (await snapshot(b.vendor.id)).key === before.key,
      `[0] ${where}: approvals page approve, fair approve, fair reject → 409 ALREADY_DECIDED, nothing changed (got ${[r1, r2, r3].map(r => `${r.status} ${r.code}`).join(' / ')})`)
  }
  {
    const b = await mkVendor({ status: VendorStatus.REJECTED, eventId: fsEv.id, ownerStatus: 'REJECTED' })
    login(SUPER)
    const r = await call(memberApprove(req(`/api/admin/vendor-members/${b.ownerId}/approve`, 'PATCH', {}), { params: Promise.resolve({ id: b.ownerId }) }))
    const owner = await prisma.vendorMember.findUniqueOrThrow({ where: { id: b.ownerId }, select: { approvalStatus: true } })
    assert(r.status === 200 && owner.approvalStatus === 'APPROVED' && await statusOf(b.vendor.id) === 'REJECTED',
      `[0] Booth Operators: admitting the owner of a REJECTED booth admits the person only; the booth stays REJECTED (got ${r.status}, owner ${owner.approvalStatus})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    login(SUPER)
    const on = await call(demoRoute(req(`/api/admin/vendors/${b.vendor.id}/demo`, 'PATCH', { demo: true }), { params: Promise.resolve({ id: b.vendor.id }) }))
    login(SUPER)
    const off = await call(demoRoute(req(`/api/admin/vendors/${b.vendor.id}/demo`, 'PATCH', { demo: false }), { params: Promise.resolve({ id: b.vendor.id }) }))
    assert(on.status === 200 && off.status === 200 && await statusOf(b.vendor.id) === 'REJECTED',
      `[0] demo switch on and off on a REJECTED booth: the status stays REJECTED (got ${on.status}/${off.status})`)
  }
  {
    const b = await mkRejectedAfterApproval()
    login({ id: b.user.clerkId, roles: ['vendor'] })
    const r = await call(vendorPATCH(req(`/api/vendors/${b.vendor.id}`, 'PATCH', { status: 'ACTIVE', description: 'Back again' }), { params: Promise.resolve({ id: b.vendor.id }) }))
    assert(await statusOf(b.vendor.id) === 'REJECTED', `[0] the vendor's own PATCH with status ACTIVE: the field is ignored, still REJECTED (status ${r.status})`)
  }

  // ── [5] pause and resume on an approved booth ───────────────────────────────────────────
  console.log("\n[5] A vendor's own pause / auto-resume, and an organizer pause / lift, on an approved booth")
  {
    const b = await mkVendor({ status: VendorStatus.ACTIVE })
    await aa(b.vendor.id, 'APPROVE', t(60))
    const own = async (body: object) => {
      login({ id: b.user.clerkId, roles: ['vendor'] })
      return (await call(vendorPATCH(req(`/api/vendors/${b.vendor.id}`, 'PATCH', body), { params: Promise.resolve({ id: b.vendor.id }) }))).status
    }
    const busy = await own({ isBusy: true })
    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: b.vendor.id }, select: { isBusy: true, busyUntil: true, status: true } })
    assert(busy === 200 && row.isBusy && !!row.busyUntil && row.busyUntil > new Date() && row.status === 'ACTIVE',
      `[0] vendor pauses (busy, auto-resume time set) → 200, still ACTIVE (got ${busy})`)
    const codes = [await own({ isBusy: false }), await own({ isOffline: true }), await own({ isOffline: false })]
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: b.vendor.id }, select: { isBusy: true, isOffline: true, status: true } })
    assert(codes.every(c => c === 200) && !after.isBusy && !after.isOffline && after.status === 'ACTIVE',
      `[0] vendor resumes, goes offline and back online → all 200, still ACTIVE (got ${codes.join('/')})`)
  }
  {
    const b = await mkVendor({ status: VendorStatus.ACTIVE })
    await aa(b.vendor.id, 'APPROVE', t(60))
    const p = await orgSet(b.vendor.id, { status: 'PAUSED' })
    const s = await orgSet(b.vendor.id, { status: 'SUSPENDED', reason: 'Inspection' })
    const l = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(p.status === 200 && s.status === 200 && l.status === 200 && await statusOf(b.vendor.id) === 'ACTIVE',
      `[0] organizer pauses, suspends and lifts an approved booth → 200 each, ends ACTIVE (got ${p.status}/${s.status}/${l.status} ${l.code ?? ''})`)
  }

  // ── [7] clock-safe order ────────────────────────────────────────────────────────────────
  console.log("\n[7] Decisions are ordered by the booth's decision number, never by clocks")
  const { decideVendor, reconsiderVendor } = await import('../lib/approvals')
  const actorOrg = { clerkId: ORG.id, actorType: 'organizer' as const, organizerId: org.id }
  const decisionsOf = (vendorId: string) => prisma.approvalAction.findMany({
    where: { applicationType: 'vendor', applicationId: vendorId, action: { in: ['APPROVE', 'REJECT'] } },
    select: { id: true, action: true, createdAt: true, detail: true },
  })
  const seqOf = (d: { detail: unknown }) => (d.detail as { seq?: unknown } | null)?.seq
  const statusLogsOf = async (vendorId: string) => (await prisma.vendorAuditLog.findMany({
    where: { vendorId, action: 'VENDOR_STATUS_CHANGED' }, select: { id: true, metadata: true, createdAt: true },
  })).map(l => ({ ...l, m: l.metadata as { previousStatus?: string; newStatus?: string } | null }))
  const newestAt = (rows: { createdAt: Date }[]) => rows.reduce((mx, r) => Math.max(mx, r.createdAt.getTime()), 0)
  /** approve → reject live → re-approve → pause, through the real organizer route. */
  const approveRejectReapprovePause = async () => {
    const b = await mkVendor({ status: VendorStatus.PENDING, ownerStatus: 'PENDING' })
    const codes: number[] = []
    for (const body of [{ status: 'ACTIVE' }, { status: 'REJECTED', reason: 'Closed for a week' }, { status: 'ACTIVE' }, { status: 'PAUSED' }]) {
      codes.push((await orgSet(b.vendor.id, body)).status)
    }
    await settle()
    return { b, codes }
  }
  {
    // 7a + 7e: the status log's clock is AHEAD — the reject's log row is stamped 5 s after the re-approval.
    const { b, codes } = await approveRejectReapprovePause()
    const ds = await decisionsOf(b.vendor.id)
    const bySeq = [...ds].sort((x, y) => Number(seqOf(x)) - Number(seqOf(y)))
    assert(codes.join(',') === '200,200,200,200' && bySeq.map(seqOf).join(',') === '1,2,3' && bySeq.map(d => d.action).join(',') === 'APPROVE,REJECT,APPROVE',
      `approve, reject, re-approve: decision numbers 1, 2, 3 in that order (got ${codes.join(',')}; ${bySeq.map(d => `${d.action}:${String(seqOf(d))}`).join(', ')})`)
    const rejLog = (await statusLogsOf(b.vendor.id)).find(l => l.m?.newStatus === 'REJECTED')
    const reapprovedAt = newestAt(ds.filter(d => d.action === 'APPROVE'))
    if (rejLog) await prisma.vendorAuditLog.update({ where: { id: rejLog.id }, data: { createdAt: new Date(reapprovedAt + 5000) } })
    const lift = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(!!rejLog && lift.status === 200 && await statusOf(b.vendor.id) === 'ACTIVE',
      `status-log clock 5 s ahead of the re-approval: reject → re-approve → pause → lift → 200 ACTIVE (got ${lift.status} ${lift.code ?? ''})`)
  }
  {
    // 7b: the re-approval was stamped by a server whose clock is 5 s BEHIND the one that rejected.
    const { b, codes } = await approveRejectReapprovePause()
    const ds = await decisionsOf(b.vendor.id)
    const reject = ds.find(d => d.action === 'REJECT')
    const reapproval = [...ds].filter(d => d.action === 'APPROVE').sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]
    if (reject && reapproval) await prisma.approvalAction.update({ where: { id: reapproval.id }, data: { createdAt: new Date(reject.createdAt.getTime() - 5000) } })
    const lift = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(codes.join(',') === '200,200,200,200' && !!reject && !!reapproval && lift.status === 200 && await statusOf(b.vendor.id) === 'ACTIVE',
      `re-approval record's clock 5 s behind the reject's: pause → lift → 200 ACTIVE (got ${lift.status} ${lift.code ?? ''})`)
  }
  {
    // 7c + 7d: approve then reject, with the approval's clocks set 5 s AFTER the rejection.
    const b = await mkVendor({ status: VendorStatus.PENDING, ownerStatus: 'PENDING' })
    const a1 = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    const r1 = await orgSet(b.vendor.id, { status: 'REJECTED', reason: 'Failed inspection' })
    await settle()
    const ds = await decisionsOf(b.vendor.id)
    const rejectAt = newestAt(ds.filter(d => d.action === 'REJECT'))
    const later = new Date(rejectAt + 5000)
    for (const d of ds.filter(x => x.action === 'APPROVE')) await prisma.approvalAction.update({ where: { id: d.id }, data: { createdAt: later } })
    for (const l of (await statusLogsOf(b.vendor.id)).filter(x => x.m?.previousStatus === 'PENDING' && x.m?.newStatus === 'ACTIVE')) {
      await prisma.vendorAuditLog.update({ where: { id: l.id }, data: { createdAt: later } })
    }
    const isApproved = await approved(b.vendor.id)
    const p = await orgSet(b.vendor.id, { status: 'PAUSED' })
    assert(a1.status === 200 && r1.status === 200 && isApproved === false && p.status === 409 && p.code === 'VENDOR_REJECTED' && await statusOf(b.vendor.id) === 'REJECTED',
      `approve then reject, approval clocks 5 s after the rejection: not approved; → PAUSED → 409 VENDOR_REJECTED, still REJECTED (got approved=${isApproved}, ${p.status} ${p.code ?? ''})`)
    await prisma.vendor.update({ where: { id: b.vendor.id }, data: { status: VendorStatus.PAUSED } })
    const lift = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    assert(lift.status === 409 && lift.code === 'VENDOR_NOT_READY_TO_GO_LIVE' && JSON.stringify(lift.missing) === JSON.stringify(['Application approved'])
      && await statusOf(b.vendor.id) === 'PAUSED',
    `same booth forced to PAUSED (as if revived): lifting → 409, missing only "Application approved", still PAUSED (got ${lift.status} ${JSON.stringify(lift.missing)})`)
  }
  {
    // 7f: two decisions on one booth at the same moment (the shared decisions, called directly).
    const b = await mkVendor({ status: VendorStatus.PENDING, ownerStatus: 'PENDING' })
    const rs = await Promise.allSettled([
      decideVendor(b.vendor.id, 'approve', null, actorOrg),
      decideVendor(b.vendor.id, 'reject', 'Too many taco stands', actorOrg),
    ])
    const ok = rs.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof decideVendor>>> => r.status === 'fulfilled')
    const bad = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    const ds = await decisionsOf(b.vendor.id)
    const now = await statusOf(b.vendor.id)
    assert(ok.length === 1 && bad.length === 1 && (bad[0].reason as { code?: string })?.code === 'ALREADY_DECIDED'
      && ds.length === 1 && seqOf(ds[0]) === 1 && now === ok[0].value.status,
    `approve and reject at the same moment: one succeeds, the other 409 ALREADY_DECIDED, one record numbered 1, status matches the winner (got ${ok.length} ok / ${bad.map(r => (r.reason as { code?: string })?.code).join(',')}; records ${ds.map(d => `${d.action}:${String(seqOf(d))}`).join(',')}; ${now})`)
  }
  {
    const b = await mkVendor({ status: VendorStatus.REJECTED })
    await aa(b.vendor.id, 'APPROVE', t(60)); await aa(b.vendor.id, 'REJECT', t(30)) // two older, unnumbered records
    const rs = await Promise.allSettled([reconsiderVendor(b.vendor.id, null, actorOrg), reconsiderVendor(b.vendor.id, null, actorOrg)])
    const ok = rs.filter(r => r.status === 'fulfilled')
    const bad = rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    const numbered = (await decisionsOf(b.vendor.id)).map(seqOf).filter(s => s !== undefined)
    assert(ok.length === 1 && bad.length === 1 && (bad[0].reason as { code?: string })?.code === 'ALREADY_DECIDED'
      && JSON.stringify(numbered) === JSON.stringify([3]) && await statusOf(b.vendor.id) === 'ACTIVE',
    `two re-approvals at the same moment: one succeeds, the other 409 ALREADY_DECIDED; the one new record is numbered 3 (after 2 older ones), numbers unique (got ${ok.length} ok, numbers ${JSON.stringify(numbered)})`)
  }
  {
    // 7g: the demo switch is not a decision: no number, and "approved" is unchanged.
    const b = await mkVendor({ status: VendorStatus.PENDING, ownerStatus: 'PENDING' })
    const ap = await orgSet(b.vendor.id, { status: 'ACTIVE' })
    login(SUPER)
    const on = await call(demoRoute(req(`/api/admin/vendors/${b.vendor.id}/demo`, 'PATCH', { demo: true }), { params: Promise.resolve({ id: b.vendor.id }) }))
    login(SUPER)
    const off = await call(demoRoute(req(`/api/admin/vendors/${b.vendor.id}/demo`, 'PATCH', { demo: false }), { params: Promise.resolve({ id: b.vendor.id }) }))
    const demoRows = await prisma.approvalAction.findMany({ where: { applicationId: b.vendor.id, action: { in: ['DEMO_ON', 'DEMO_OFF'] } }, select: { detail: true } })
    assert(ap.status === 200 && on.status === 200 && off.status === 200 && demoRows.length === 2 && demoRows.every(r => seqOf(r) === undefined)
      && await approved(b.vendor.id) === true,
    `[0] demo on / off on an approved booth: two DEMO records, neither numbered; still approved (got ${ap.status}/${on.status}/${off.status}, ${demoRows.length} rows)`)
  }

  // ── [6] source checks ───────────────────────────────────────────────────────────────────
  console.log('\n[6] Source checks')
  const norm = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const ROUTE = 'app/api/organizer/vendors/[id]/route.ts'
  const routeCalls = vendorWriteCalls(norm(ROUTE))
  assert(routeCalls.length === 1 && /\.vendor\.updateMany\(/.test(routeCalls[0]) && /status:\s*vendor\.status/.test(routeCalls[0]),
    `the organizer route's one Vendor write is conditional on the status it read (updateMany … status: vendor.status) (got ${JSON.stringify(routeCalls.map(c => c.slice(0, 60)))})`)

  // Positive control: the scanner finds a planted write and its status argument.
  const planted = vendorWriteCalls('await tx.vendor.update({ where: { id: f(x) }, data: { status: \'ACTIVE\' } })\nawait db.vendor.updateMany({ where: { id } , data })')
  assert(planted.length === 2 && /status: 'ACTIVE'/.test(planted[0]) && /data \}\)$/.test(planted[1]),
    '[0] positive control: the scanner finds both planted Vendor writes with their full arguments')

  // Inventory: every Vendor write in app/, lib/, workers/. A new one fails here and must be reviewed
  // against F5 (only lib/approvals.ts decisions and the organizer route may write Vendor.status).
  const EXPECTED: Record<string, number> = {
    'app/api/admin/vendors/[id]/demo/route.ts': 1,
    'app/api/organizer/vendors/[id]/route.ts': 1,
    'app/api/vendors/[id]/documents/route.ts': 1,
    'app/api/vendors/[id]/route.ts': 1,
    'app/api/vendors/[id]/stripe/connect/route.ts': 1,
    'lib/admin-money.ts': 1,
    'lib/approvals.ts': 3,
    'workers/order-worker.ts': 1,
  }
  const files = ['app', 'lib', 'workers'].flatMap(d => walkTs(d))
  const found: Record<string, number> = {}
  const statusWriters: string[] = []
  for (const f of files) {
    const calls = vendorWriteCalls(norm(f))
    if (!calls.length) continue
    found[f] = calls.length
    // A status in the DATA object (a status in `where` is only a condition, not a write).
    if (calls.some(c => /\bdata:\s*\{[^}]*\bstatus\s*:/.test(c))) statusWriters.push(f)
  }
  const sortObj = (o: Record<string, number>) => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]))
  assert(files.length > 200 && sortObj(found) === sortObj(EXPECTED),
    `inventory: Vendor writes in app/, lib/, workers/ (${files.length} files) are exactly the reviewed list (got ${sortObj(found)})`)
  assert(JSON.stringify(statusWriters.sort()) === JSON.stringify(['lib/approvals.ts']),
    `the only Vendor write naming a status in its data is lib/approvals.ts (the decisions) (got ${JSON.stringify(statusWriters)})`)
  const freeze = norm('lib/admin-money.ts')
  const freezeData = freeze.slice(freeze.indexOf('const data = frozen'), freeze.indexOf('const data = frozen') + 400).split('\n\n')[0]
  assert(freezeData.startsWith('const data = frozen') && !/status/.test(freezeData),
    'lib/admin-money.ts: its Vendor write passes `data` built from payout-freeze fields only (no status)')

  // Every vendor APPROVE / REJECT record takes its number from nextDecisionSeq (Jordan, Nov 17).
  const plantedMissing = 'export async function x(tx) {\n  const flip = await tx.vendor.updateMany({ where: { id, status: s }, data: { status: t } })\n  if (flip.count === 0) throw e()\n  await tx.approvalAction.create({ data: { action: \'APPROVE\', applicationType: \'vendor\', applicationId: id, detail: { fromStatus: s } } })\n}\n'
  const plantedEarly = 'export async function y(tx) {\n  const seq = await nextDecisionSeq(tx, id)\n  const flip = await tx.vendor.updateMany({ where: { id, status: s }, data: { status: t } })\n  if (flip.count === 0) throw e()\n  await tx.approvalAction.create({ data: { action: \'REJECT\', applicationType: \'vendor\', applicationId: id, detail: { seq } } })\n}\n'
  const plantedGood = 'export async function z(tx) {\n  const flip = await tx.vendor.updateMany({ where: { id, status: s }, data: { status: t } })\n  if (flip.count === 0) throw e()\n  const seq = await nextDecisionSeq(tx, id)\n  await tx.approvalAction.create({ data: { action: \'APPROVE\', applicationType: \'vendor\', applicationId: id, detail: { seq } } })\n}\n'
  const plantedDemo = 'export async function w(tx) {\n  await tx.approvalAction.create({ data: { action: demo ? \'DEMO_ON\' : \'DEMO_OFF\', applicationType: \'vendor\', applicationId: id } })\n}\n'
  assert(seqOffenders(plantedMissing, 'planted').length === 1 && seqOffenders(plantedEarly, 'planted').length === 1
    && seqOffenders(plantedGood, 'planted').length === 0 && seqOffenders(plantedDemo, 'planted').length === 0,
  '[0] positive controls: a planted decision record with no number, and one numbered BEFORE the booth update, are both caught; a correct one and a demo record are not')
  const createsByFile: Record<string, number> = {}
  const seqBad: string[] = []
  for (const f of files) {
    const src = norm(f)
    const n = decisionCreates(src)
    if (n) createsByFile[f] = n
    seqBad.push(...seqOffenders(src, f))
  }
  assert(sortObj(createsByFile) === sortObj({ 'lib/approvals.ts': 3 }) && seqBad.length === 0,
    `every vendor APPROVE / REJECT record (${JSON.stringify(createsByFile)}) takes its number from nextDecisionSeq right after the booth update (offenders: ${JSON.stringify(seqBad)})`)
  // seq is the LAST key of detail, after every spread (Jordan, Nov 17).
  const plantedSeqFirst = 'await tx.approvalAction.create({ data: { action: \'APPROVE\', applicationType: \'vendor\', applicationId: id, detail: { seq, reconsidered: true, ...ctx.detail } } })'
  const plantedSeqLast = 'await tx.approvalAction.create({ data: { action: \'REJECT\', applicationType: \'vendor\', applicationId: id, detail: {\n  fromStatus: s, ...ctx.detail,\n  seq, // last\n} } })'
  assert(seqNotLast(plantedSeqFirst, 'planted').length === 1 && seqNotLast(plantedSeqLast, 'planted').length === 0,
    '[0] positive controls: a planted record with seq BEFORE a ...ctx.detail spread is caught; one with seq last (and a trailing comment) is not')
  const notLast = files.flatMap(f => seqNotLast(norm(f), f))
  assert(notLast.length === 0,
    `every vendor APPROVE / REJECT record puts seq LAST in detail, after every spread, so nothing spread in can overwrite it (offenders: ${JSON.stringify(notLast)})`)
  const approvalsSrc = norm('lib/approvals.ts')
  const helper = approvalsSrc.slice(approvalsSrc.indexOf('async function nextDecisionSeq('), approvalsSrc.indexOf('async function nextDecisionSeq(') + 400)
  assert(/applicationType: 'vendor'/.test(helper) && /action: \{ in: \['APPROVE', 'REJECT'\] \}/.test(helper),
    'nextDecisionSeq counts only the booth\'s APPROVE / REJECT records (never DEMO_ON / DEMO_OFF / VIEW_DOCUMENT)')
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
