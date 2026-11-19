/**
 * PRICE-INCREASE APPROVAL — F2 + F4 (Jordan, Nov 13; built Nov 21 after the Batch 1 merge).
 *
 * THE RULES:
 *   - a price increase on a live item, or on a size, waits for the approver: the event's organizer,
 *     or a strict admin only when the event has no organizer. The old price keeps selling meanwhile;
 *   - decreases, deletes, same-price and non-price edits (name, description, photo, category, prep
 *     time, size name) go live at once; an EDIT that mixes a raise with other fields applies the
 *     other fields now and leaves only the price waiting;
 *   - F4: every new size added to a live item waits, at any price, and is decided on its own;
 *   - one pending price change per item: a newer increase, a decrease or a removal replaces it;
 *   - every applied price change is logged (MENU_PRICE_CHANGED) in the same transaction, and every
 *     waiting price tells the approvers (MenuChangeEvent PRICE_PENDING, reason LIVE_INCREASE or
 *     NEW_SIZE) in the same transaction as the request;
 *   - an organizer who is suspended or not approved can't approve (403), and the admin can't step
 *     in for a fair that has an organizer (404): the increase just stays PENDING at the old price.
 *
 *   [1]  a live increase is PENDING: price unchanged (database and the vendor menu read), one
 *        LIVE_INCREASE notice, no price-log row yet
 *   [2]  the cent boundary: 10.00 → 10.01 waits; 10.00 → 10.00 is applied with no row, no notice
 *   [3]  a second increase replaces the first: one PENDING left, the older REJECTED "Replaced"
 *   [4]  a raise mixed with a rename and a description: those go live, the price waits
 *   [5]  a decrease while an increase waits: applied at once, logged, and it replaces the increase
 *   [6]  the organizer approves (price set, REQUEST_APPROVED_EDIT row by the organizer) or rejects
 *        (price kept, no row); two approvals at once apply once with ONE price-log row, so the
 *        log row is written inside the approval's transaction
 *   [7]  a fair with no organizer: the admin approves; an organizer of another fair gets 404
 *   [8]  a suspended or not-approved organizer: 403, still PENDING at the old price; the admin gets
 *        404 for a fair that has an organizer; approved again → the approval works (control)
 *   [9]  removal: a vendor DELETE closes the waiting increase; an item removed some other way while
 *        an increase waits → approval refused 409, the request stays PENDING
 *   [10] F4: a new size at a higher, lower or equal price waits, is not created, and tells the
 *        approvers (NEW_SIZE); the queue names it as a new size (no "decides all" count);
 *        approving one creates only that size, with a REQUEST_APPROVED_SIZE row; rejecting
 *        creates nothing
 *   [11] sizes follow F2: a size's price increase waits, its decrease is live
 *   [12] atomic: a batch whose later item is refused leaves no increase and no notice behind
 *   [13] while an increase waits, customers pay the old price: the public menu (GET /api/menu)
 *        serves it, and POST /api/orders charges it (the old total succeeds and the PaymentIntent
 *        is for it; the new total → 409 PRICE_CHANGED)
 *   [14] the vendor can't approve their own increase: through the organizer route → 403, through
 *        the admin route → 404; still PENDING, price unchanged
 *
 *   Ultrareview findings (Step 10, 2026-11-21):
 *   [3b] saving the live price withdraws a waiting increase (no log row, no notice)
 *   [4b] a mixed edit writes an activity-log entry for both rows; [4c] control: a decrease, one
 *   [9b] removing the last live row of a size group closes its waiting new sizes; approving → 409
 *   [9c] control: removing one size while another stays live closes nothing
 *   [9d] re-adding the item by the same name restores it; the closed sizes stay closed
 *   [9e] control: an unrelated removal leaves a brand-new item's waiting sizes alone
 *   [9f] the old pending-DELETE approval closes them too
 *   [9g] safety net: a new size whose item is gone is refused at approval (409, stays PENDING);
 *        control: a real brand-new item reusing a removed group's name is approved as new
 *   [15] vendor page: withdrawing is an explicit button; a normal save sends only what changed (source)
 *   [16] one definition of "this size group has a live item", built on ON_MENU; both transactions
 *        take the vendor lock first (source)
 *
 *   Ultrareview P7 findings (Step 11, 2026-11-21):
 *   [18] vendor page: one waiting-price lookup (source)
 *   [3c] a withdrawn increase leaves the organizer's queue; approving it afterwards → 409
 *   [4d] a description-only edit leaves a waiting increase PENDING
 *   [9h] orphaned new sizes on the review cards; rejecting one rejects only that one
 *   [9i] approving a brand-new item leaves an orphaned new size of the same group alone
 *   [9j] a removal closes real new sizes, not a brand-new item's sizes in the same group
 *   [9k] a batch answers and logs each row's final status
 *   [9l] two simultaneous removals still close the waiting new size (5 rounds)
 *   [9m] the vendor lock: released after a failure and a refused approval; blocks the same
 *        vendor only; transaction-scoped (source)
 *
 *   Ultrareview of Step 11 (Step 12, 2026-11-22):
 *   [9n] the lock wait: within 8 s it completes; past 8 s a named 503 MENU_BUSY, approval and filing;
 *        P2028 → 503 TX_TIMEOUT
 *   [3d] a withdraw names its increase: 409 INCREASE_NOT_PENDING once decided or replaced; 400s
 *   [9o] the approval reads the size group under the lock
 *   [9p] the "no longer on the menu" refusal is decided under the lock
 *   [9q] two approvals of one brand-new item at once: one 200, one 409
 *   [16b] no unsafe raw SQL in lib/menu-requests (source)
 *   [16c] the lock-taking routes set maxDuration = 30 (source)
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/price-increase-approval-test.ts
 * Self-cleaning, prefix pia-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
process.env.ENFORCE_VENDOR_READINESS = 'false'
// A fake test-mode key, as in scripts/online-markup-test.ts: the order route needs a
// non-placeholder key to proceed, and paymentIntents.create / update are replaced with recorders
// before the first order ([13]), so nothing is ever sent to Stripe.
process.env.STRIPE_SECRET_KEY = 'sk_test_pia_fake_key_never_sent'

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
// TEST-ONLY SHIM, as in scripts/online-markup-test.ts: lib/menu/getGroupedMenuItems.ts (behind the
// vendor menu read) uses a bare `require('next/cache')` that does not exist in an ES-module script.
// `next/cache` is answered with the route loader's stand-in (scripts/_next-cache-mock.mjs:
// unstable_cache(fn) just runs fn); every other require loads normally.
import * as nextCacheMock from './_next-cache-mock.mjs'
const realRequire = createRequire(import.meta.url)
;(globalThis as unknown as { require?: unknown }).require =
  Object.assign((id: string) => (id === 'next/cache' ? nextCacheMock : realRequire(id)), realRequire)

import { NextRequest } from 'next/server'
import { readFileSync, readdirSync } from 'node:fs'

const prisma = testPrisma()
const PFX = 'pia-'
const MAIL = '@pia.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/**
 * Run one section. If it stops on an exception (a row it expected is missing, as on code from
 * before F2), record ONE failed check and go on, so a run reports every section instead of
 * crashing at the first.
 */
async function section(run: () => Promise<void>) {
  try { await run() } catch (e) { assert(false, `this section stopped early: ${String(e).split('\n')[0]}`) }
}

function login(clerkId: string, roles?: string[]) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string; publicMetadata?: unknown } }).__MOCK_CLERK =
    { userId: clerkId, ...(roles && { publicMetadata: { roles } }) }
}
function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}
type Body = { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const oids = (await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(o => o.id)
    if (oids.length) {
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.order.deleteMany({ where: { id: { in: oids } } })
    }
    await prisma.fulfillmentConfig.deleteMany({ where: { eventId: { in: ids } } })
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.orgMember.deleteMany({ where: { user: { email: { endsWith: MAIL } } } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
}

async function main() {
  console.log('\n══ PRICE-INCREASE APPROVAL (F2 + F4) ══')
  await cleanup()

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const mkOrg = async (tag: string) => {
    const org = await prisma.fairOrganizer.create({
      data: { name: `${PFX}${tag}`, contactEmail: `${tag}-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
    })
    const user = await prisma.user.create({ data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${tag}u-${rand()}${MAIL}`, name: tag } })
    await prisma.orgMember.create({ data: { organizerId: org.id, userId: user.id, role: 'owner' } })
    return { org, user }
  }
  const mkFair = (organizerId: string | null) => prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId,
      startDate: new Date(now - 864e5), endDate: new Date(now + 864e5),
    },
  })
  const mkVendor = async (eventId: string) => {
    const vendor = await prisma.vendor.create({
      data: { eventId, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
    })
    const user = await prisma.user.create({ data: { clerkId: `${PFX}v-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Operator', role: 'vendor' } })
    await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'APPROVED' } })
    return { vendor, user }
  }

  const orgA = await mkOrg('orga')
  const orgB = await mkOrg('orgb')
  const fair = await mkFair(orgA.org.id)
  const fairB = await mkFair(orgB.org.id)
  const open = await mkFair(null) // no organizer: a strict admin decides
  const A = await mkVendor(fair.id)
  const O = await mkVendor(open.id)
  const admin = await prisma.user.create({ data: { clerkId: `${PFX}admin-${rand()}`, email: `adm-${rand()}${MAIL}`, name: 'Admin' } })

  const mkItem = (vendorId: string, name: string, price: number, extra: { variantGroup?: string; variantLabel?: string } = {}) =>
    prisma.menuItem.create({ data: { vendorId, name, price, category: 'Mains', ...extra } })
  const itemOf = async (id: string) => prisma.menuItem.findUniqueOrThrow({ where: { id } })
  const reqOf = async (id: string) => prisma.menuRequest.findUniqueOrThrow({ where: { id } })
  const priceLog = async (menuItemId: string) => (await prisma.vendorAuditLog.findMany({
    where: { action: 'MENU_PRICE_CHANGED' }, orderBy: { createdAt: 'asc' },
  })).map(r => ({ userId: r.userId, meta: r.metadata as Record<string, unknown> })).filter(r => r.meta.menuItemId === menuItemId)
  const notices = (menuRequestId: string) => prisma.menuChangeEvent.findMany({ where: { menuRequestId } })
  const payload = (e: { payload: unknown }) => e.payload as Record<string, unknown>
  const pendingPrices = (menuItemId: string) =>
    prisma.menuRequest.findMany({ where: { menuItemId, status: 'PENDING', price: { not: null } } })

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const reqPOST = (await import('../app/api/menu-requests/route')).POST as unknown as (r: NextRequest) => Promise<Response>
  const orgPATCH = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string; id: string }> }) => Promise<Response>
  const orgLIST = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/route')).GET as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string }> }) => Promise<Response>
  const adminPATCH = (await import('../app/api/admin/events/[id]/menu-requests/[requestId]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ id: string; requestId: string }> }) => Promise<Response>
  const menuGET = (await import('../app/api/vendors/[id]/menu/route')).GET as unknown as (r: Request, c: unknown) => Promise<Response>

  const file = (vendorId: string, body: Record<string, unknown>) =>
    reqPOST(jsonReq('/api/menu-requests', 'POST', { vendorId, ...body }))
  const fileBody = async (vendorId: string, body: Record<string, unknown>) => bodyOf(await file(vendorId, body))
  const orgDecide = (fairSlug: string, id: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') =>
    orgPATCH(jsonReq(`/api/organizer/fairs/${fairSlug}/menu-requests/${id}`, 'PATCH', { action }),
      { params: Promise.resolve({ fairSlug, id }) })
  const adminDecide = (eventId: string, requestId: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') =>
    adminPATCH(jsonReq(`/api/admin/events/${eventId}/menu-requests/${requestId}`, 'PATCH', { action }),
      { params: Promise.resolve({ id: eventId, requestId }) })
  /** As the organizer A, then back to vendor A. */
  const asOrgA = async <T>(f: () => Promise<T>): Promise<T> => {
    login(orgA.user.clerkId)
    try { return await f() } finally { login(A.user.clerkId) }
  }
  /** The in-person price the vendor menu read serves for an item (what the menu page shows). */
  const servedPrice = async (vendorId: string, itemId: string) => {
    const b = await bodyOf(await menuGET(new Request(`http://localhost/api/vendors/${vendorId}/menu`), { params: Promise.resolve({ id: vendorId }) }))
    const groups = (b.data as unknown as Array<{ variants: Array<{ id: string; inPersonPrice: number }> }> | undefined) ?? []
    return groups.flatMap(g => g.variants).find(x => x.id === itemId)?.inPersonPrice ?? null
  }

  login(A.user.clerkId)

  // ── [0] control ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[0] controls: filing works, and the vendor menu read finds the item')
  await section(async () => {
    const c = await mkItem(A.vendor.id, `${PFX}ctrl`, 10)
    const down = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: c.id, price: 9 })
    assert(down.data?.status === 'APPROVED' && (await itemOf(c.id)).price === 9,
      `[0] a decrease (10 → 9) is filed and applied at once (got ${down.data?.status}, ${(await itemOf(c.id)).price})`)
    assert(await servedPrice(A.vendor.id, c.id) === 9, `[0] the vendor menu read serves the applied price 9 (got ${await servedPrice(A.vendor.id, c.id)})`)
  })

  // ── [1] a live increase waits ───────────────────────────────────────────────────────────────
  console.log('\n[1] a price increase on a live item waits; the old price keeps selling')
  const burger = await mkItem(A.vendor.id, `${PFX}burger`, 10)
  await section(async () => {
    const r = await file(A.vendor.id, { type: 'EDIT', menuItemId: burger.id, price: 12 })
    const b = await bodyOf(r)
    const row = await reqOf(b.data?.id as string)
    assert(r.status === 201 && row.status === 'PENDING' && row.type === 'EDIT' && row.price === 12 && row.menuItemId === burger.id && row.reviewedAt === null,
      `201, one PENDING EDIT carrying 12 for the burger (got ${r.status} ${row.status} ${row.price})`)
    assert(b.data?.approver === 'organizer', `the answer says it waits for the organizer (got ${String(b.data?.approver)})`)
    assert((await itemOf(burger.id)).price === 10 && await servedPrice(A.vendor.id, burger.id) === 10,
      `the item still sells at 10: in the database and on the vendor menu read (got ${(await itemOf(burger.id)).price} / ${await servedPrice(A.vendor.id, burger.id)})`)
    const ev = await notices(row.id)
    assert(ev.length === 1 && ev[0].kind === 'PRICE_PENDING' && payload(ev[0]).reason === 'LIVE_INCREASE' && payload(ev[0]).previousPrice === 10
      && payload(ev[0]).requestedPrice === 12 && payload(ev[0]).name === `${PFX}burger` && ev[0].menuItemId === burger.id && ev[0].eventId === fair.id,
    `the approvers are told: one PRICE_PENDING notice, LIVE_INCREASE, 10 → 12, naming the item (got ${JSON.stringify(ev.map(payload))})`)
    assert((await priceLog(burger.id)).length === 0, 'no MENU_PRICE_CHANGED row while it waits')
  })

  // ── [2] the cent boundary ───────────────────────────────────────────────────────────────────
  console.log('\n[2] one cent up waits; the same price is applied at once')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}cent`, 10)
    const cent = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 10.01 })
    assert(cent.data?.status === 'PENDING' && (await itemOf(item.id)).price === 10, `10.00 → 10.01 is PENDING, still 10 (got ${cent.data?.status})`)
    const same = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: '10.00' })
    assert(same.data?.status === 'APPROVED' && (await itemOf(item.id)).price === 10 && (await priceLog(item.id)).length === 0
      && (await notices(same.data?.id as string)).length === 0,
    `10.00 → "10.00" is applied at once with no price-log row and no notice (got ${same.data?.status})`)
  })

  // ── [3] a second increase replaces the first ────────────────────────────────────────────────
  console.log('\n[3] a second increase replaces the older pending one (no stacked requests)')
  let burgerPendingId = ''
  await section(async () => {
    const first = (await pendingPrices(burger.id))[0]
    const second = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: burger.id, price: 13 })
    const older = await reqOf(first.id)
    const pending = await pendingPrices(burger.id)
    assert(second.data?.status === 'PENDING' && older.status === 'REJECTED' && older.reviewNote === 'Replaced by newer request' && older.reviewedBy === A.user.id,
      `the newer increase (13) is PENDING; the older (12) is REJECTED "Replaced by newer request" (got ${older.status}, ${older.reviewNote})`)
    assert(pending.length === 1 && pending[0].id === second.data?.id && pending[0].price === 13 && (await itemOf(burger.id)).price === 10,
      `exactly one PENDING price change is left, at 13, and the item still sells at 10 (got ${pending.length})`)
    burgerPendingId = second.data?.id as string
  })

  // ── [4] a raise mixed with other fields ─────────────────────────────────────────────────────
  console.log('\n[4] a raise mixed with a rename and a description: those go live, the price waits')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}mixed`, 10)
    const r = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 14, name: `${PFX}mixed v2`, description: 'New recipe' })
    const after = await itemOf(item.id)
    const live = await prisma.menuRequest.findMany({ where: { menuItemId: item.id, status: 'APPROVED' } })
    assert(r.data?.status === 'PENDING' && r.data?.price === 14 && r.data?.name === null,
      `the answer is the PENDING price row, carrying the price only (got ${r.data?.status} ${r.data?.price} ${String(r.data?.name)})`)
    assert(after.name === `${PFX}mixed v2` && after.description === 'New recipe' && after.price === 10,
      `the rename and description are live; the price stays 10 (got "${after.name}", ${after.price})`)
    assert(live.length === 1 && live[0].type === 'EDIT' && live[0].price === null && live[0].name === `${PFX}mixed v2`
      && live[0].reviewNote === 'Applied immediately by vendor' && (await priceLog(item.id)).length === 0,
    `the live part is its own APPROVED EDIT row with no price, and no price-log row (got ${live.length})`)
    const ev = await notices(r.data?.id as string)
    assert(ev.length === 1 && payload(ev[0]).name === `${PFX}mixed v2` && payload(ev[0]).previousPrice === 10 && payload(ev[0]).requestedPrice === 14,
      `the notice names the item by its new name, 10 → 14 (got ${JSON.stringify(ev.map(payload))})`)
  })

  // ── [5] a decrease while an increase waits ──────────────────────────────────────────────────
  console.log('\n[5] a decrease while an increase waits: applied at once, and it replaces the increase')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}drop`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const down = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 9 })
    const log = await priceLog(item.id)
    const replaced = await reqOf(up.data?.id as string)
    assert(down.data?.status === 'APPROVED' && (await itemOf(item.id)).price === 9,
      `10 → 9 is applied at once (got ${down.data?.status}, ${(await itemOf(item.id)).price})`)
    assert(log.length === 1 && log[0].meta.source === 'REQUEST_APPLIED_EDIT' && log[0].meta.previousPrice === 10 && log[0].meta.newPrice === 9
      && log[0].meta.requestId === down.data?.id && log[0].userId === A.user.id,
    `one REQUEST_APPLIED_EDIT row 10 → 9 by the vendor (got ${JSON.stringify(log.map(l => l.meta))})`)
    assert(replaced.status === 'REJECTED' && replaced.reviewNote === 'Replaced by newer request' && (await pendingPrices(item.id)).length === 0,
      `the waiting increase is REJECTED "Replaced by newer request"; nothing is pending (got ${replaced.status})`)
  })

  // ── [6] the organizer decides ───────────────────────────────────────────────────────────────
  console.log('\n[6] the organizer approves or rejects; the price-log row is written inside the approval')
  await section(async () => {
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, burgerPendingId))
    const log = await priceLog(burger.id)
    const row = await reqOf(burgerPendingId)
    assert(ap.status === 200 && row.status === 'APPROVED' && row.reviewedBy === orgA.user.id && (await itemOf(burger.id)).price === 13,
      `approved: 200, request APPROVED by the organizer, the burger now sells at 13 (got ${ap.status}, ${row.status}, ${(await itemOf(burger.id)).price})`)
    assert(log.length === 1 && log[0].meta.source === 'REQUEST_APPROVED_EDIT' && log[0].meta.previousPrice === 10 && log[0].meta.newPrice === 13
      && log[0].meta.requestId === burgerPendingId && log[0].userId === orgA.user.id,
    `one REQUEST_APPROVED_EDIT row 10 → 13 by the organizer (got ${JSON.stringify(log.map(l => l.meta))})`)
    assert(await servedPrice(A.vendor.id, burger.id) === 13, `the vendor menu read serves 13 after the approval (got ${await servedPrice(A.vendor.id, burger.id)})`)

    const again = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: burger.id, price: 15 })
    const rj = await asOrgA(() => orgDecide(fair.urlSlug, again.data?.id as string, 'REJECT'))
    assert(rj.status === 200 && (await reqOf(again.data?.id as string)).status === 'REJECTED' && (await itemOf(burger.id)).price === 13
      && (await priceLog(burger.id)).length === 1,
    `rejected: 200, REJECTED, the price stays 13 and no price-log row is added (got ${rj.status})`)

    // Two approvals at once: one wins. The loser's price write AND its log row roll back together,
    // which is only possible if the log row is written in the approval's own transaction.
    const race = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: burger.id, price: 16 })
    const [x, y] = await asOrgA(() => Promise.all([orgDecide(fair.urlSlug, race.data?.id as string), orgDecide(fair.urlSlug, race.data?.id as string)]))
    const statuses = [x.status, y.status].sort()
    const raceLog = (await priceLog(burger.id)).filter(l => l.meta.requestId === race.data?.id)
    assert(statuses[0] === 200 && statuses[1] === 409 && raceLog.length === 1 && (await itemOf(burger.id)).price === 16,
      `two approvals at once: one 200, one 409, exactly one price-log row, price 16 (got ${statuses.join('/')}, ${raceLog.length} rows)`)
  })

  // ── [7] a fair with no organizer ────────────────────────────────────────────────────────────
  console.log('\n[7] no organizer: the admin approves; an organizer of another fair cannot')
  await section(async () => {
    const item = await mkItem(O.vendor.id, `${PFX}open-item`, 10)
    login(O.user.clerkId)
    const up = await fileBody(O.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    assert(up.data?.status === 'PENDING' && up.data?.approver === 'FairSynq' && (await itemOf(item.id)).price === 10,
      `PENDING, waiting for FairSynq, still 10 (got ${up.data?.status}, ${String(up.data?.approver)})`)
    login(orgB.user.clerkId)
    const other = await orgDecide(open.urlSlug, up.data?.id as string)
    assert(other.status === 404 && (await reqOf(up.data?.id as string)).status === 'PENDING',
      `an organizer of another fair → 404, still PENDING (got ${other.status})`)
    login(admin.clerkId, ['admin'])
    const ap = await adminDecide(open.id, up.data?.id as string)
    const log = await priceLog(item.id)
    assert(ap.status === 200 && (await itemOf(item.id)).price === 12 && log.length === 1 && log[0].meta.source === 'REQUEST_APPROVED_EDIT' && log[0].userId === admin.id,
      `the admin approves: 200, price 12, one REQUEST_APPROVED_EDIT row by the admin (got ${ap.status}, ${(await itemOf(item.id)).price})`)
    login(A.user.clerkId)
  })

  // ── [8] a suspended or not-approved organizer ───────────────────────────────────────────────
  console.log('\n[8] suspended or not-approved organizer: the increase stays PENDING at the old price')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}held`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const id = up.data?.id as string

    await prisma.fairOrganizer.update({ where: { id: orgA.org.id }, data: { suspendedAt: new Date(), suspendedReason: 'test' } })
    const susp = await asOrgA(() => orgDecide(fair.urlSlug, id))
    const sb = await bodyOf(susp)
    assert(susp.status === 403 && sb.error?.code === 'ORGANIZER_SUSPENDED' && (await reqOf(id)).status === 'PENDING' && (await itemOf(item.id)).price === 10,
      `suspended organizer → 403 ORGANIZER_SUSPENDED; still PENDING, still 10 (got ${susp.status} ${sb.error?.code})`)
    login(admin.clerkId, ['admin'])
    const adm = await adminDecide(fair.id, id)
    assert(adm.status === 404 && (await reqOf(id)).status === 'PENDING' && (await itemOf(item.id)).price === 10,
      `the admin can't step in for a fair that has an organizer → 404; still PENDING at 10 (got ${adm.status})`)
    login(A.user.clerkId)

    await prisma.fairOrganizer.update({ where: { id: orgA.org.id }, data: { suspendedAt: null, suspendedReason: null, approvalStatus: 'PENDING' } })
    const notApproved = await asOrgA(() => orgDecide(fair.urlSlug, id))
    assert(notApproved.status === 403 && (await reqOf(id)).status === 'PENDING' && (await itemOf(item.id)).price === 10,
      `not-approved organizer → 403; still PENDING at 10 (got ${notApproved.status})`)

    await prisma.fairOrganizer.update({ where: { id: orgA.org.id }, data: { approvalStatus: 'APPROVED' } })
    const ok = await asOrgA(() => orgDecide(fair.urlSlug, id))
    assert(ok.status === 200 && (await itemOf(item.id)).price === 12,
      `[0] control: approved again, the same organizer approves → 200, price 12 (got ${ok.status})`)
  })

  // ── [9] removal while an increase waits ─────────────────────────────────────────────────────
  console.log('\n[9] removal: a vendor DELETE closes the waiting increase; approving after a removal is refused')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}gone`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const del = await fileBody(A.vendor.id, { type: 'DELETE', menuItemId: item.id })
    const closed = await reqOf(up.data?.id as string)
    assert(del.data?.status === 'APPROVED' && closed.status === 'REJECTED' && closed.reviewNote === 'Replaced by newer request',
      `the DELETE applies and closes the waiting increase (REJECTED "Replaced by newer request") (got ${del.data?.status}, ${closed.status})`)

    const item2 = await mkItem(A.vendor.id, `${PFX}gone2`, 10)
    const up2 = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item2.id, price: 12 })
    await prisma.menuItem.update({ where: { id: item2.id }, data: { removedAt: new Date() } })
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, up2.data?.id as string))
    const apb = await bodyOf(ap)
    assert(ap.status === 409 && apb.error?.code === 'CONFLICT' && /removed from the menu/.test(apb.error?.message ?? '')
      && (await reqOf(up2.data?.id as string)).status === 'PENDING' && (await itemOf(item2.id)).price === 10 && (await priceLog(item2.id)).length === 0,
    `approving an increase on an item removed meanwhile → 409, still PENDING, price 10, no log row (got ${ap.status}: ${apb.error?.message})`)
  })

  // ── [10] F4: new sizes of a live item ───────────────────────────────────────────────────────
  console.log('\n[10] F4: a new size of a live item waits at any price and is decided on its own')
  await section(async () => {
    const group = `${PFX}Soda`
    await mkItem(A.vendor.id, `${group} Small`, 3, { variantGroup: group, variantLabel: 'Small' })
    const sizes: Array<[string, number]> = [['Large', 5], ['Kids', 2], ['Regular', 3]]
    const filed: Record<string, Body> = {}
    for (const [label, price] of sizes) {
      filed[label] = await fileBody(A.vendor.id, { type: 'ADD', name: `${group} ${label}`, price, category: 'Drinks', variantGroup: group, variantLabel: label })
    }
    const created0 = await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: group } })
    assert(sizes.every(([l]) => filed[l].data?.status === 'PENDING') && created0 === 1,
      `higher (5), lower (2) and equal (3) new sizes are all PENDING and none is created (got ${sizes.map(([l]) => filed[l].data?.status).join('/')}, ${created0} item)`)
    const ev = (await Promise.all(sizes.map(([l]) => notices(filed[l].data?.id as string)))).flat()
    assert(ev.length === 3 && ev.every(e => e.kind === 'PRICE_PENDING' && payload(e).reason === 'NEW_SIZE' && payload(e).previousPrice === null && e.menuItemId === null),
      `three PRICE_PENDING notices, reason NEW_SIZE, previous price null, no item yet (got ${JSON.stringify(ev.map(payload))})`)

    const list = await asOrgA(async () => bodyOf(await orgLIST(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests?status=PENDING&take=100`, 'GET'),
      { params: Promise.resolve({ fairSlug: fair.urlSlug }) })))
    const listed = ((list.data?.requests ?? []) as Array<{ id: string; sizesInGroup?: number | null; newSizeOf?: string | null }>)
      .filter(r => sizes.some(([l]) => filed[l].data?.id === r.id))
    assert(listed.length === 3 && listed.every(r => r.newSizeOf === group && r.sizesInGroup === null),
      `the organizer queue marks each as a new size of ${group}, with no "decides all" count (got ${JSON.stringify(listed.map(r => [r.newSizeOf, r.sizesInGroup]))})`)

    const ap = await asOrgA(() => orgDecide(fair.urlSlug, filed.Large.data?.id as string))
    const large = await prisma.menuItem.findFirst({ where: { vendorId: A.vendor.id, variantGroup: group, variantLabel: 'Large' } })
    const others = await prisma.menuRequest.findMany({ where: { id: { in: [filed.Kids.data?.id as string, filed.Regular.data?.id as string] } } })
    assert(ap.status === 200 && !!large && large.price === 5 && others.every(o => o.status === 'PENDING')
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: group } }) === 2,
    `approving Large creates only Large at 5; Kids and Regular stay PENDING and uncreated (got ${ap.status}, ${others.map(o => o.status).join('/')})`)
    const log = large ? await priceLog(large.id) : []
    assert(log.length === 1 && log[0].meta.source === 'REQUEST_APPROVED_SIZE' && log[0].meta.previousPrice === null && log[0].meta.newPrice === 5
      && log[0].meta.requestId === filed.Large.data?.id && log[0].userId === orgA.user.id,
    `one REQUEST_APPROVED_SIZE row null → 5 by the organizer (got ${JSON.stringify(log.map(l => l.meta))})`)

    const rj = await asOrgA(() => orgDecide(fair.urlSlug, filed.Kids.data?.id as string, 'REJECT'))
    assert(rj.status === 200 && (await reqOf(filed.Kids.data?.id as string)).status === 'REJECTED'
      && (await reqOf(filed.Regular.data?.id as string)).status === 'PENDING'
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: group, variantLabel: 'Kids' } }) === 0,
    `rejecting Kids creates nothing and leaves Regular PENDING (got ${rj.status})`)
  })

  // ── [11] sizes follow F2 ────────────────────────────────────────────────────────────────────
  console.log('\n[11] a size\'s price increase waits; its decrease is live')
  await section(async () => {
    const group = `${PFX}Fries`
    const small = await mkItem(A.vendor.id, `${group} Small`, 3, { variantGroup: group, variantLabel: 'Small' })
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: small.id, price: 3.5 })
    assert(up.data?.status === 'PENDING' && (await itemOf(small.id)).price === 3, `Small 3 → 3.5 is PENDING, still 3 (got ${up.data?.status})`)
    const down = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: small.id, price: 2.5 })
    assert(down.data?.status === 'APPROVED' && (await itemOf(small.id)).price === 2.5 && (await reqOf(up.data?.id as string)).status === 'REJECTED',
      `Small 3 → 2.5 is live at once and replaces the waiting 3.5 (got ${down.data?.status}, ${(await itemOf(small.id)).price})`)
  })

  // ── [12] atomic ─────────────────────────────────────────────────────────────────────────────
  console.log('\n[12] a batch whose later item is refused leaves no increase and no notice behind')
  await section(async () => {
    // The increase is written first, inside the transaction; the second DELETE of the same item
    // passes the up-front checks (the item is live when they run) and fails only inside the
    // transaction, so everything before it must roll back.
    const item = await mkItem(A.vendor.id, `${PFX}atomic`, 10)
    const other = await mkItem(A.vendor.id, `${PFX}atomic-other`, 5)
    const reqsBefore = await prisma.menuRequest.count({ where: { vendorId: A.vendor.id } })
    const noticesBefore = await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } })
    const r = await file(A.vendor.id, { items: [
      { type: 'EDIT', menuItemId: item.id, price: 20 },
      { type: 'DELETE', menuItemId: other.id },
      { type: 'DELETE', menuItemId: other.id },
    ] })
    assert(r.status === 409 && await prisma.menuRequest.count({ where: { vendorId: A.vendor.id } }) === reqsBefore
      && await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } }) === noticesBefore
      && (await itemOf(item.id)).price === 10 && (await itemOf(other.id)).removedAt === null,
    `refused inside the transaction (${r.status}): no request row, no notice, the price still 10, the other item still on the menu`)
    const ok = await file(A.vendor.id, { items: [{ type: 'EDIT', menuItemId: item.id, price: 20 }] })
    assert(ok.status === 201 && await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } }) === noticesBefore + 1,
      `[0] control: the same increase alone is filed with its notice (got ${ok.status})`)
  })

  // ── [13] customers pay the old price while an increase waits ────────────────────────────────
  console.log('\n[13] while an increase waits, the public menu and checkout use the old price')
  await section(async () => {
    const rl = await import('../lib/ratelimit')
    const allowAll = { limit: async () => ({ success: true, limit: 999, remaining: 999, reset: Date.now() + 3600e3 }) }
    rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as never })
    const { stripe } = await import('../lib/stripe')
    const piCalls: Array<{ amount: number }> = []
    const pis = stripe.paymentIntents as unknown as { create: (p: { amount: number }) => Promise<unknown>; update: () => Promise<unknown> }
    pis.create = async (p: { amount: number }) => { piCalls.push(p); return { id: `pi_${PFX}${rand()}`, client_secret: `pi_${PFX}s_${rand()}`, metadata: {} } }
    pis.update = async () => ({})
    const orderPOST = (await import('../app/api/orders/route')).POST as unknown as (r: NextRequest) => Promise<Response>
    const menuPublic = (await import('../app/api/menu/route')).GET as unknown as (r: Request) => Promise<Response>
    const { checkoutTotals, toCents } = await import('../lib/checkout-total')

    const shop = await prisma.event.create({
      data: {
        name: `${PFX}shop`, urlSlug: `${PFX}shop-${rand()}`, status: 'ACTIVE', organizerId: orgA.org.id,
        startDate: new Date(now - 864e5), endDate: new Date(now + 864e5),
        fulfillmentConfig: { create: { boothPickupEnabled: true, curbsideEnabled: false, homeDeliveryEnabled: false } },
      },
    })
    const S = await mkVendor(shop.id)
    const item = await mkItem(S.vendor.id, `${PFX}hotdog`, 10)
    login(S.user.clerkId)
    const up = await fileBody(S.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    assert(up.data?.status === 'PENDING' && (await itemOf(item.id)).price === 10, `[0] the increase 10 → 12 is PENDING (got ${up.data?.status})`)

    const pub = await bodyOf(await menuPublic(new Request(`http://localhost/api/menu?eventSlug=${shop.urlSlug}`)))
    const variants = ((pub.data as unknown as Array<{ variants: Array<{ id: string; price: number; inPersonPrice: number }> }> | undefined) ?? [])
      .flatMap(g => g.variants)
    const served = variants.find(v => v.id === item.id)
    assert(!!served && served.inPersonPrice === 10 && served.price === 10,
      `the public menu serves the old price: in person 10, online 10 at no markup (got ${served?.inPersonPrice} / ${served?.price})`)

    const feeTerms = await (await import('../lib/settings')).getMoneySettings()
    const totalAt = (dollars: number) => checkoutTotals({
      lines: [{ inPersonCents: toCents(dollars), quantity: 1 }], markupBps: 0, feeTerms, deliveryFeeCents: 0, tipCents: 0,
    }).totalCents
    const customer = await prisma.user.create({ data: { clerkId: `${PFX}cust-${rand()}`, email: `cust-${rand()}${MAIL}`, name: 'C' } })
    const place = async (expectedTotalCents: number) => {
      login(customer.clerkId)
      const res = await orderPOST(jsonReq('/api/orders', 'POST', {
        eventId: shop.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100',
        items: [{ menuItemId: item.id, vendorId: S.vendor.id, quantity: 1 }], expectedTotalCents,
      }))
      return { status: res.status, body: await bodyOf(res) }
    }
    const oldTotal = totalAt(10), newTotal = totalAt(12)
    assert(oldTotal !== newTotal, `[0] control: the totals at 10 and at 12 differ (${oldTotal}¢ vs ${newTotal}¢), so the check can tell them apart`)
    const atNew = await place(newTotal)
    assert(atNew.status === 409 && atNew.body.error?.code === 'PRICE_CHANGED' && piCalls.length === 0,
      `checkout expecting the NEW price's total (${newTotal}¢) → 409 PRICE_CHANGED, no payment started (got ${atNew.status} ${atNew.body.error?.code})`)
    const atOld = await place(oldTotal)
    const orderId = atOld.body.data?.orderId as string | undefined
    const order = orderId ? await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: true } }) : null
    assert(atOld.status === 201 && piCalls.length === 1 && piCalls[0].amount === oldTotal && !!order && order.subtotal === 10
      && order.orderItems.length === 1 && order.orderItems[0].unitPrice === 10 && order.orderItems[0].inPersonUnitPrice === 10,
    `checkout at the OLD price's total (${oldTotal}¢) → 201; the PaymentIntent is for ${oldTotal}¢ and the order line is 10 (got ${atOld.status}, PI ${piCalls[0]?.amount}, line ${order?.orderItems[0]?.unitPrice})`)
    login(A.user.clerkId)
  })

  // ── [14] the vendor can't approve their own increase ────────────────────────────────────────
  console.log('\n[14] the vendor cannot approve their own pending increase')
  await section(async () => {
    const item = await mkItem(A.vendor.id, `${PFX}self`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const id = up.data?.id as string
    login(A.user.clerkId)
    const viaOrg = await orgDecide(fair.urlSlug, id)
    const viaAdmin = await adminDecide(fair.id, id)
    assert(viaOrg.status === 403 && (await reqOf(id)).status === 'PENDING' && (await itemOf(item.id)).price === 10,
      `vendor A through the organizer route → 403; still PENDING, price 10 (got ${viaOrg.status})`)
    assert(viaAdmin.status === 404 && (await reqOf(id)).status === 'PENDING' && (await itemOf(item.id)).price === 10 && (await priceLog(item.id)).length === 0,
      `vendor A through the admin route → 404; still PENDING, price 10, no log row (got ${viaAdmin.status})`)
    const ok = await asOrgA(() => orgDecide(fair.urlSlug, id))
    assert(ok.status === 200 && (await itemOf(item.id)).price === 12, `[0] control: the organizer approves the same request → 200, price 12 (got ${ok.status})`)
  })

  // ═══ Ultrareview findings 1–5 (Step 10, 2026-11-21) ═══════════════════════════════════════

  // ── [3b] saving the live price withdraws a waiting increase (finding 3, server side) ───────
  console.log('\n[3b] saving the live price withdraws a waiting increase')
  await section(async () => {
    login(A.user.clerkId)
    const item = await mkItem(A.vendor.id, `${PFX}withdraw`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 13 })
    const noticesBefore = await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } })
    const keep = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 10 })
    const old = await reqOf(up.data?.id as string)
    assert(up.data?.status === 'PENDING' && keep.data?.status === 'APPROVED' && old.status === 'REJECTED' && old.reviewNote === 'Replaced by newer request'
      && (await itemOf(item.id)).price === 10 && (await pendingPrices(item.id)).length === 0,
    `$10 live, $13 waiting; saving $10 → applied, $13 REJECTED "Replaced by newer request", price 10, nothing pending (got ${keep.data?.status}, ${old.status})`)
    assert((await priceLog(item.id)).length === 0 && await prisma.menuChangeEvent.count({ where: { vendorId: A.vendor.id } }) === noticesBefore,
      'no price-log row (the price did not move) and no new notice')
  })

  // ── [4b]/[4c] every row written gets its activity-log entry (finding 2) ────────────────────
  console.log('\n[4b] a mixed edit writes an activity-log entry for both rows; [4c] a plain decrease writes one')
  await section(async () => {
    login(A.user.clerkId)
    type Entry = { requestId?: string; status?: string }
    const entriesFor = async (ids: string[]) => (await prisma.vendorAuditLog.findMany({ where: { vendorId: A.vendor.id, action: 'MENU_CHANGE_REQUESTED' } }))
      .map(r => r.metadata as Entry).filter(m => !!m.requestId && ids.includes(m.requestId))
    /** The activity log is written in the background (lib/vendor-audit.ts): wait up to 3 s. */
    const waitFor = async (ids: string[], n: number) => {
      for (let i = 0; i < 30; i++) { const e = await entriesFor(ids); if (e.length >= n) return e; await new Promise(r => setTimeout(r, 100)) }
      return entriesFor(ids)
    }
    const item = await mkItem(A.vendor.id, `${PFX}logged`, 10)
    const mixed = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12, name: `${PFX}logged v2` })
    const companion = await prisma.menuRequest.findFirstOrThrow({ where: { menuItemId: item.id, status: 'APPROVED', type: 'EDIT' } })
    const ids = [mixed.data?.id as string, companion.id]
    const e = await waitFor(ids, 2)
    assert(e.length === 2 && e.some(x => x.requestId === mixed.data?.id && x.status === 'PENDING') && e.some(x => x.requestId === companion.id && x.status === 'APPROVED'),
      `[4b] two MENU_CHANGE_REQUESTED entries: the PENDING price row and the APPROVED rename row (got ${JSON.stringify(e)})`)

    const plain = await mkItem(A.vendor.id, `${PFX}logged-plain`, 10)
    const down = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: plain.id, price: 9 })
    await waitFor([down.data?.id as string], 1)
    await new Promise(r => setTimeout(r, 500)) // and give a wrong second entry time to appear
    const rowsForPlain = await prisma.menuRequest.findMany({ where: { menuItemId: plain.id }, select: { id: true } })
    const e2 = await entriesFor(rowsForPlain.map(r => r.id))
    assert(rowsForPlain.length === 1 && e2.length === 1 && e2[0].status === 'APPROVED',
      `[4c] control: a plain decrease writes one row and one entry (got ${rowsForPlain.length} rows, ${e2.length} entries)`)
  })

  // ── [9b]–[9g] waiting new sizes when their item is removed (finding 1 + the safety net) ────
  console.log('\n[9b] removing the last live row of a size group closes its waiting new sizes')
  // Not "Burger": [1] already has a live "pia-burger", and the re-add name match ignores case.
  const burgerGroup = `${PFX}Cheeseburger`
  const burgerSizes: Record<string, string> = {}
  let burgerItemId = ''
  await section(async () => {
    login(A.user.clerkId)
    const burgerItem = await mkItem(A.vendor.id, burgerGroup, 9, { variantGroup: burgerGroup, variantLabel: 'Regular' })
    burgerItemId = burgerItem.id
    for (const [label, price] of [['Large', 11], ['XL', 13]] as const) {
      const b = await fileBody(A.vendor.id, { type: 'ADD', name: `${burgerGroup} ${label}`, price, category: 'Mains', variantGroup: burgerGroup, variantLabel: label })
      burgerSizes[label] = b.data?.id as string
    }
    assert(Object.values(burgerSizes).length === 2 && (await Promise.all(Object.values(burgerSizes).map(reqOf))).every(r => r.status === 'PENDING'),
      '[0] Large and XL are filed as new sizes of the live Burger and wait')
    const del = await fileBody(A.vendor.id, { type: 'DELETE', menuItemId: burgerItem.id })
    const closed = await Promise.all(Object.values(burgerSizes).map(reqOf))
    assert(del.data?.status === 'APPROVED' && closed.every(r => r.status === 'REJECTED' && r.reviewNote === 'Closed: the item was removed from the menu' && r.reviewedBy === A.user.id),
      `the vendor removes Burger (its only live row) → Large and XL are REJECTED "Closed: the item was removed from the menu", by the vendor (got ${closed.map(r => `${r.status}/${r.reviewNote}`).join(', ')})`)
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, burgerSizes.Large))
    const groupItems = await prisma.menuItem.findMany({ where: { vendorId: A.vendor.id, variantGroup: burgerGroup } })
    assert(ap.status === 409 && groupItems.length === 1 && groupItems[0].removedAt !== null,
      `approving Large afterwards → 409; no size was created and nothing in the group is live (got ${ap.status}, ${groupItems.length} row(s))`)
  })

  console.log('\n[9c] control: removing one size while another stays live closes nothing')
  await section(async () => {
    login(A.user.clerkId)
    const group = `${PFX}Shake`
    const small = await mkItem(A.vendor.id, `${group} Small`, 4, { variantGroup: group, variantLabel: 'Small' })
    await mkItem(A.vendor.id, `${group} Medium`, 5, { variantGroup: group, variantLabel: 'Medium' })
    const large = await fileBody(A.vendor.id, { type: 'ADD', name: `${group} Large`, price: 6, category: 'Drinks', variantGroup: group, variantLabel: 'Large' })
    await fileBody(A.vendor.id, { type: 'DELETE', menuItemId: small.id })
    assert((await reqOf(large.data?.id as string)).status === 'PENDING', 'removing Small (Medium still live) leaves the waiting Large PENDING')
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, large.data?.id as string))
    const created = await prisma.menuItem.findFirst({ where: { vendorId: A.vendor.id, variantGroup: group, variantLabel: 'Large' } })
    const log = created ? await priceLog(created.id) : []
    assert(ap.status === 200 && !!created && created.removedAt === null && log.length === 1 && log[0].meta.source === 'REQUEST_APPROVED_SIZE',
      `approving it creates only Large, logged REQUEST_APPROVED_SIZE (got ${ap.status}, ${log[0]?.meta.source})`)
  })

  console.log('\n[9d] re-adding the item by the same name restores it; the closed sizes stay closed')
  await section(async () => {
    login(A.user.clerkId)
    const readd = await fileBody(A.vendor.id, { type: 'ADD', name: burgerGroup, price: 9, category: 'Mains' })
    const back = await itemOf(burgerItemId)
    assert(readd.data?.type === 'RESTORE' && readd.data?.status === 'APPROVED' && readd.data?.menuItemId === burgerItemId && back.removedAt === null,
      `ADD "${burgerGroup}" → a RESTORE of the removed Burger, back on the menu (got ${String(readd.data?.type)} ${String(readd.data?.status)})`)
    const sizes = await Promise.all(Object.values(burgerSizes).map(reqOf))
    const sizeItems = await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: burgerGroup, variantLabel: { in: ['Large', 'XL'] } } })
    assert(sizes.every(r => r.status === 'REJECTED' && r.reviewNote === 'Closed: the item was removed from the menu') && sizeItems === 0,
      `Large and XL stay REJECTED and no Large/XL item exists (got ${sizes.map(r => r.status).join('/')}, ${sizeItems} items)`)
    const list = await asOrgA(async () => bodyOf(await orgLIST(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests?status=PENDING&take=100`, 'GET'),
      { params: Promise.resolve({ fairSlug: fair.urlSlug }) })))
    const listed = ((list.data?.requests ?? []) as Array<{ id: string }>).filter(r => Object.values(burgerSizes).includes(r.id))
    const apXL = await asOrgA(() => orgDecide(fair.urlSlug, burgerSizes.XL))
    assert(listed.length === 0 && apXL.status === 409 && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: burgerGroup, variantLabel: 'XL' } }) === 0,
      `the organizer's pending queue lists neither, and approving XL → 409 with nothing created (got ${listed.length} listed, ${apXL.status})`)
  })

  console.log('\n[9e] control: removing an unrelated item leaves a brand-new item\'s waiting sizes alone')
  await section(async () => {
    login(A.user.clerkId)
    const group = `${PFX}Taco`
    const sub = await fileBody(A.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 4, category: 'Mains', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Large`, price: 6, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
    ] })
    const ids = ((sub.data?.requests ?? []) as Array<{ id: string }>).map(r => r.id)
    const other = await mkItem(A.vendor.id, `${PFX}Nachos Regular`, 7, { variantGroup: `${PFX}Nachos`, variantLabel: 'Regular' })
    await fileBody(A.vendor.id, { type: 'DELETE', menuItemId: other.id })
    const after = await prisma.menuRequest.findMany({ where: { id: { in: ids } } })
    assert(ids.length === 2 && after.every(r => r.status === 'PENDING'),
      `the brand-new Taco's 2 sizes are still PENDING after another group's last row is removed (got ${after.map(r => r.status).join('/')})`)
  })

  console.log('\n[9f] the old pending-DELETE approval closes the group\'s waiting new sizes too')
  await section(async () => {
    login(A.user.clerkId)
    const group = `${PFX}Wrap`
    const wrap = await mkItem(A.vendor.id, `${group} Regular`, 8, { variantGroup: group, variantLabel: 'Regular' })
    const large = await fileBody(A.vendor.id, { type: 'ADD', name: `${group} Large`, price: 10, category: 'Mains', variantGroup: group, variantLabel: 'Large' })
    // A DELETE filed before 2g waits for the approver; seeded in that shape.
    const legacy = await prisma.menuRequest.create({ data: { vendorId: A.vendor.id, requestedBy: A.user.id, type: 'DELETE', menuItemId: wrap.id } })
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, legacy.id))
    const size = await reqOf(large.data?.id as string)
    assert(ap.status === 200 && (await itemOf(wrap.id)).removedAt !== null && size.status === 'REJECTED'
      && size.reviewNote === 'Closed: the item was removed from the menu' && size.reviewedBy === orgA.user.id,
    `approving the old DELETE removes Wrap and closes the waiting Large, by the organizer (got ${ap.status}, ${size.status})`)
  })

  console.log('\n[9g] safety net: a new size whose item is gone is refused at approval, never approved as a new item')
  await section(async () => {
    login(A.user.clerkId)
    const group = `${PFX}Pita`
    const pita = await mkItem(A.vendor.id, `${group} Regular`, 8, { variantGroup: group, variantLabel: 'Regular' })
    const large = await fileBody(A.vendor.id, { type: 'ADD', name: `${group} Large`, price: 10, category: 'Mains', variantGroup: group, variantLabel: 'Large' })
    // The item disappears WITHOUT the removal paths (as if a path were added later that forgot the
    // close): the waiting size is left PENDING with no live item in its group.
    await prisma.menuItem.update({ where: { id: pita.id }, data: { removedAt: new Date() } })
    const ap = await asOrgA(() => orgDecide(fair.urlSlug, large.data?.id as string))
    const apb = await bodyOf(ap)
    assert(ap.status === 409 && apb.error?.code === 'CONFLICT' && /no longer on the menu/.test(apb.error?.message ?? '')
      && (await reqOf(large.data?.id as string)).status === 'PENDING'
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: group, removedAt: null } }) === 0,
    `approving it → 409 "no longer on the menu", still PENDING, nothing created (got ${ap.status}: ${apb.error?.message})`)
    const rj = await asOrgA(() => orgDecide(fair.urlSlug, large.data?.id as string, 'REJECT'))
    assert(rj.status === 200 && (await reqOf(large.data?.id as string)).status === 'REJECTED', `[0] the approver can still reject it (got ${rj.status})`)

    // Control: a REAL brand-new item reusing a removed group's name is approved as a new item.
    const gyro = `${PFX}Gyro`
    await prisma.menuItem.create({ data: { vendorId: A.vendor.id, name: `${gyro} Classic`, price: 9, category: 'Mains', variantGroup: gyro, variantLabel: 'Classic', removedAt: new Date() } })
    const fresh = await fileBody(A.vendor.id, { type: 'ADD', name: `${gyro} Small`, price: 7, category: 'Mains', variantGroup: gyro, variantLabel: 'Small' })
    const freshNotices = await notices(fresh.data?.id as string)
    const ok = await asOrgA(() => orgDecide(fair.urlSlug, fresh.data?.id as string))
    const created = await prisma.menuItem.findFirst({ where: { vendorId: A.vendor.id, variantGroup: gyro, variantLabel: 'Small', removedAt: null } })
    const log = created ? await priceLog(created.id) : []
    assert(fresh.data?.status === 'PENDING' && freshNotices.length === 0 && ok.status === 200 && !!created && log[0]?.meta.source === 'REQUEST_APPROVED_ADD',
      `control: a brand-new item reusing a removed group's name (no NEW_SIZE notice) is approved and created as a new item (got ${ok.status}, ${log[0]?.meta.source})`)
  })

  const mkShop = async () => { const f = await mkFair(orgA.org.id); const v = await mkVendor(f.id); return { f, v } }
  const queue = (slug: string) => asOrgA(async () => ((await bodyOf(await orgLIST(
    jsonReq(`/api/organizer/fairs/${slug}/menu-requests?status=PENDING&take=100`, 'GET'), { params: Promise.resolve({ fairSlug: slug }) }))).data?.requests ?? []) as Array<Record<string, unknown>>)

  // ── [15] the vendor page: withdrawing is an explicit button; a normal save sends only what changed (P7 finding 1)
  console.log('\n[15] vendor page: the withdraw button, and a normal save sends only what changed')
  await section(async () => {
    const page = readFileSync('app/vendor/[fairSlug]/menu/page.tsx', 'utf8').replace(/\r\n/g, '\n')
    const BUTTON = /Withdraw the \$\{pendingPrice\.toFixed\(2\)\} increase \(keep \$\{item\.price\.toFixed\(2\)\}\)/
    const CALLS = /onClick=\{\(\) => \{ onWithdraw\(item\.id\); onClose\(\) \}\}/
    const WIRED = /onWithdraw=\{handleWithdrawIncrease\}/
    const PROP = /pendingPrice=\{pendingIncreaseByItem\.get\(editingItem\.id\)\?\.price \?\? null\}/
    const SENDS_LIVE = /async function handleWithdrawIncrease\(id: string\)[\s\S]{0,900}?body: JSON\.stringify\(\{ vendorId, type: 'EDIT', menuItemId: id, price: item\.price, withdrawsRequestId: waiting\.id \}\)/
    const TOAST = /\$\{waitingPrice\.toFixed\(2\)\} withdrawn — the price stays \$\$\{item\.price\.toFixed\(2\)\}\./
    const WITHDRAW_409 = /else if \(json\.error\?\.code === 'INCREASE_NOT_PENDING'\) \{[\s\S]{0,400}?toast\.error\('This increase was already decided or replaced by a newer one\. The menu now shows the current price\.'\)\s*loadMenu\(\)/
    const OLD_HINT = /Save \$\{item\.price\.toFixed\(2\)\} to keep the current price and withdraw it/
    const OLD_SEND = /updates\.price = form\.price/
    // The save's "send only what changed" lines, as written in handleSaveEdit: price is one of the
    // keys compared with the live item, and the body carries what changed.
    const SENDS_CHANGED = (s: string) =>
      /for \(const key of \['name', 'description', 'price', 'prepTime', 'category', 'imageUrl'\] as const\) \{/.test(s)
      && /if \(form\[key\] !== undefined && form\[key\] !== item\?\.\[key\]\) \(updates as Record<string, unknown>\)\[key\] = form\[key\]/.test(s)
      && /body: JSON\.stringify\(\{ vendorId, type: 'EDIT', menuItemId: id, \.\.\.updates \}\)/.test(s)
    const save = page.match(/async function handleSaveEdit[\s\S]*?\n  \}\n/)?.[0] ?? ''
    assert(BUTTON.test(page) && CALLS.test(page) && WIRED.test(page) && PROP.test(page),
      'the edit form gets the waiting price and has "Withdraw the $X increase (keep $Y)", which calls the withdraw handler and closes the form')
    assert(SENDS_LIVE.test(page) && TOAST.test(page), 'the withdraw handler sends an EDIT at the live price naming the waiting increase (withdrawsRequestId) and says "$X withdrawn — the price stays $Y."')
    assert(WITHDRAW_409.test(page), 'on 409 INCREASE_NOT_PENDING the withdraw shows fixed text (never the server\'s) and reloads the menu and requests (Step 12 finding 4)')
    const OLD_BODY = "async function handleWithdrawIncrease(id: string) {\n      body: JSON.stringify({ vendorId, type: 'EDIT', menuItemId: id, price: item.price }),"
    const ID_ONLY = "async function handleWithdrawIncrease(id: string) {\n      body: JSON.stringify({ vendorId, type: 'EDIT', menuItemId: id, withdrawsRequestId: waiting.id }),"
    const NEW_BODY = "async function handleWithdrawIncrease(id: string) {\n      body: JSON.stringify({ vendorId, type: 'EDIT', menuItemId: id, price: item.price, withdrawsRequestId: waiting.id }),"
    assert(SENDS_LIVE.test(NEW_BODY) && !SENDS_LIVE.test(OLD_BODY) && !SENDS_LIVE.test(ID_ONLY)
      && WITHDRAW_409.test("} else if (json.error?.code === 'INCREASE_NOT_PENDING') {\n        toast.error('This increase was already decided or replaced by a newer one. The menu now shows the current price.')\n        loadMenu()")
      && !WITHDRAW_409.test("} else if (json.error?.code === 'INCREASE_NOT_PENDING') {\n        toast.error(json.error.message)\n        loadMenu()")
      && !WITHDRAW_409.test("} else {\n        toast.error(json.error?.message ?? 'Failed to withdraw the increase')"),
    '[0] control: SENDS_LIVE accepts the body with the live price and the id, and rejects the old body without withdrawsRequestId and a body without the price; the 409 scan rejects a plain error toast and rejects the server\'s raw message')
    assert(SENDS_CHANGED(save), 'handleSaveEdit sends the price when it differs from the live price (price is compared with the live item and sent in the body)')
    assert(save.length > 0 && !OLD_SEND.test(save) && !/waitingPrice/.test(save) && !OLD_HINT.test(page),
      'handleSaveEdit no longer adds an unchanged price when an increase waits, and the old hint line is gone')
    const savedWithoutPrice = "for (const key of ['name', 'description', 'prepTime', 'category', 'imageUrl'] as const) {\n      if (form[key] !== undefined && form[key] !== item?.[key]) (updates as Record<string, unknown>)[key] = form[key]\n        body: JSON.stringify({ vendorId, type: 'EDIT', menuItemId: id, ...updates }),"
    assert(OLD_SEND.test('if (waitingPrice !== null && form.price !== undefined && form.price !== waitingPrice) updates.price = form.price')
      && BUTTON.test('Withdraw the ${pendingPrice.toFixed(2)} increase (keep ${item.price.toFixed(2)})')
      && !SENDS_CHANGED(savedWithoutPrice),
    '[0] control: the scans find a planted Step 10 send line and a planted button, and reject a save that never sends a price')
  })

  // ── [16] one live-group definition (built on ON_MENU), and the vendor lock in both transactions
  console.log('\n[16] filing, deciding, the cards and the removal close use liveSizeGroupWhere (built on ON_MENU); both transactions take the vendor lock')
  await section(async () => {
    const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const INLINE = /variantGroup[^\n;]{0,80}removedAt:\s*null|removedAt:\s*null[^\n;]{0,80}variantGroup/
    const files = ['lib/menu-requests/file-item.ts', 'lib/menu-requests/apply-decision.ts', 'lib/menu-requests/size-groups.ts', 'lib/menu-requests/supersede.ts']
    for (const f of files) {
      let src = strip(readFileSync(f, 'utf8'))
      if (f.endsWith('size-groups.ts')) src = src.replace(/export function liveSizeGroupWhere[\s\S]*?\n\}/, '')
      assert(/liveSizeGroupWhere\(/.test(src) && !INLINE.test(src), `${f}: uses liveSizeGroupWhere( and has no inline "variantGroup … removedAt: null" filter of its own`)
    }
    assert(INLINE.test("where: { vendorId, variantGroup: g, removedAt: null }") && !INLINE.test('where: liveSizeGroupWhere(vendorId, g)'),
      '[0] control: the scan catches a planted inline filter and passes the helper call')
    const sg = strip(readFileSync('lib/menu-requests/size-groups.ts', 'utf8'))
    assert(/export function liveSizeGroupWhere[^{]*\{\s*return \{ vendorId, variantGroup, \.\.\.ON_MENU \}/.test(sg) && /import \{ ON_MENU \} from '\.\.\/menu\/on-menu'/.test(sg),
      'liveSizeGroupWhere spreads ON_MENU (lib/menu/on-menu.ts), the single definition of "not removed" (P7 finding 8)')
    const route = strip(readFileSync('app/api/menu-requests/route.ts', 'utf8'))
    const decide = strip(readFileSync('lib/menu-requests/apply-decision.ts', 'utf8'))
    const LOCK_FIRST = /db\.\$transaction\(\s*async tx => \{\s*await lockVendorMenu\(tx, vendorId\)/
    assert(LOCK_FIRST.test(route) && LOCK_FIRST.test(decide), 'the filing route and the approval each take the vendor lock as the first thing in their transaction (P7 finding 4)')
    assert(!LOCK_FIRST.test('db.$transaction(async tx => {\n  const now = new Date()\n  await lockVendorMenu(tx, vendorId)'),
      '[0] control: the scan rejects a lock that is not the first thing in the transaction')
    // Step 12 (findings 2 and 5): the decision's reads come after the lock, through tx; the approval
    // allows 20 s; the lock wait is capped with the tagged set_config form.
    const AFTER = ['tx.menuItem.count({ where: liveSizeGroupWhere(', 'filedAsNewSize(tx, [requestId])', 'filedAsNewSize(tx, pending.map(', 'throw new ApiError(ORPHANED_NEW_SIZE_MESSAGE']
    const afterLock = (s: string) => { const at = s.indexOf('await lockVendorMenu(tx, vendorId)'); return at >= 0 && AFTER.every(x => s.indexOf(x) > at) }
    assert(afterLock(decide) && !/filedAsNewSize\(db\b/.test(decide) && !/db\.menuItem\.count\(/.test(decide) && !/db\.menuRequest\.findMany\(/.test(decide),
      'apply-decision.ts: the live-group count, both new-size lookups and the orphan 409 run after lockVendorMenu, through tx; none through db (Step 12 finding 5)')
    assert(!afterLock("await tx.menuItem.count({ where: liveSizeGroupWhere(v, g) })\nawait lockVendorMenu(tx, vendorId)\nfiledAsNewSize(tx, [requestId]) filedAsNewSize(tx, pending.map( throw new ApiError(ORPHANED_NEW_SIZE_MESSAGE"),
      '[0] control: the scan rejects a group read placed before the lock')
    assert(/\}, \{ timeout: 20_000 \}\)/.test(decide), 'the approval transaction allows 20 s (Step 12 finding 2)')
    const SET = /await tx\.\$executeRaw`SELECT set_config\('lock_timeout', '8s', true\)`\s*try \{\s*await tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(/
    assert(SET.test(sg), "lockVendorMenu caps the wait with tx.$executeRaw`SELECT set_config('lock_timeout', '8s', true)` right before the advisory lock (Step 12 finding 2)")
    assert(!SET.test("await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '8s'`)\n  try {\n    await tx.$executeRaw`SELECT pg_advisory_xact_lock(")
      && !SET.test("await tx.$executeRaw`SELECT set_config('lock_timeout', '8s', false)`\n  try {\n    await tx.$executeRaw`SELECT pg_advisory_xact_lock("),
      '[0] control: the scan rejects the unsafe form and a session-wide (false) setting')
  })

  // ── [18] one waiting-price lookup on the vendor page (P7 finding 6)
  console.log('\n[18] vendor page: the waiting increase comes from pendingIncreaseByItem only')
  await section(async () => {
    const page = readFileSync('app/vendor/[fairSlug]/menu/page.tsx', 'utf8').replace(/\r\n/g, '\n')
    const SECOND = /pendingRequests\.find\([^)]*r\.price/
    assert(/const waiting = pendingIncreaseByItem\.get\(id\) \?\? null/.test(page) && !SECOND.test(page) && !/pendingPriceByItem/.test(page)
      && (page.match(/\.filter\(r => r\.type === 'EDIT' && r\.menuItemId && r\.price != null\)/g) ?? []).length === 1,
    'the withdraw handler reads pendingIncreaseByItem, built by the one waiting-increase filter; the old map is gone; no second pendingRequests.find(… price …) lookup exists')
    assert(SECOND.test("pendingRequests.find(r => r.type === 'EDIT' && r.price != null)"), '[0] control: the scan finds a planted second lookup')
  })

  // ── [3c] a withdrawn increase leaves the organizer's queue; approving it afterwards → 409 (Jordan's addition 1)
  console.log('\n[3c] a withdrawn increase leaves the organizer\'s queue; approving it afterwards → 409')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const item = await mkItem(v.vendor.id, `${PFX}withdrawn-q`, 10)
    const up = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const before = (await queue(f.urlSlug)).some(r => r.id === up.data?.id)
    login(v.user.clerkId)
    const keep = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 10 }) // what the button sends
    const after = (await queue(f.urlSlug)).some(r => r.id === up.data?.id)
    const ap = await asOrgA(() => orgDecide(f.urlSlug, up.data?.id as string))
    const apb = await bodyOf(ap)
    assert(up.data?.status === 'PENDING' && keep.data?.status === 'APPROVED' && before && !after,
      `[0] the increase is in the organizer's pending queue; after the withdraw it is not (before ${before}, after ${after})`)
    assert(ap.status === 409 && /already reviewed/i.test(apb.error?.message ?? '') && (await itemOf(item.id)).price === 10 && (await priceLog(item.id)).length === 0,
      `approving the withdrawn request → 409 "Request already reviewed"; price still 10; no price-log row (got ${ap.status}: ${apb.error?.message})`)
  })

  // ── [4d] a description-only edit leaves a waiting increase alone (P7 finding 1, server side)
  console.log('\n[4d] a description-only edit leaves a waiting increase PENDING')
  await section(async () => {
    login(A.user.clerkId)
    const item = await mkItem(A.vendor.id, `${PFX}desc-only`, 10)
    const up = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 12 })
    const desc = await fileBody(A.vendor.id, { type: 'EDIT', menuItemId: item.id, description: 'New words' })
    const after = await itemOf(item.id)
    assert(desc.data?.status === 'APPROVED' && after.description === 'New words' && after.price === 10 && (await reqOf(up.data?.id as string)).status === 'PENDING',
      `the description is live; the $12 increase is still PENDING and the price still 10 (got ${(await reqOf(up.data?.id as string)).status}, ${after.price})`)
  })

  // ── [9h] the cards show orphaned new sizes as new sizes; rejecting one rejects only that one (P7 finding 2)
  console.log('\n[9h] orphaned new sizes on the review cards; rejecting one rejects only that one')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Falafel`
    const reg = await mkItem(v.vendor.id, `${group} Regular`, 8, { variantGroup: group, variantLabel: 'Regular' })
    const ids: string[] = []
    for (const label of ['Large', 'XL']) {
      ids.push((await fileBody(v.vendor.id, { type: 'ADD', name: `${group} ${label}`, price: 10, category: 'Mains', variantGroup: group, variantLabel: label })).data?.id as string)
    }
    await prisma.menuItem.update({ where: { id: reg.id }, data: { removedAt: new Date() } }) // outside the removal paths: both stay PENDING
    const cards = (await queue(f.urlSlug)).filter(r => ids.includes(r.id as string))
    assert(cards.length === 2 && cards.every(c => c.newSizeOf === group && c.newSizeOrphaned === true && c.sizesInGroup === null),
      `both cards: new size of ${group}, newSizeOrphaned, no "decides all" count (got ${JSON.stringify(cards.map(c => [c.newSizeOf, c.newSizeOrphaned, c.sizesInGroup]))})`)
    const rj = await asOrgA(() => orgDecide(f.urlSlug, ids[0], 'REJECT'))
    assert(rj.status === 200 && (await reqOf(ids[0])).status === 'REJECTED' && (await reqOf(ids[1])).status === 'PENDING',
      `rejecting Large rejects only Large; XL stays PENDING (got ${rj.status}, ${(await reqOf(ids[1])).status})`)
  })

  // ── [9i] approving a brand-new item never creates an orphaned new size sharing its group (P7 finding 5)
  console.log('\n[9i] approving a brand-new item leaves an orphaned new size of the same group alone')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Kebab`
    const classic = await mkItem(v.vendor.id, `${group} Classic`, 9, { variantGroup: group, variantLabel: 'Classic' })
    const xl = await fileBody(v.vendor.id, { type: 'ADD', name: `${group} XL`, price: 12, category: 'Mains', variantGroup: group, variantLabel: 'XL' })
    await prisma.menuItem.update({ where: { id: classic.id }, data: { removedAt: new Date() } }) // XL is now an orphaned new size
    const sub = await fileBody(v.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 7, category: 'Mains', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Large`, price: 10, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
    ] })
    const brandNew = ((sub.data?.requests ?? []) as Array<{ id: string; status: string }>)
    const ap = await asOrgA(() => orgDecide(f.urlSlug, brandNew[0]?.id as string))
    const labels = (await prisma.menuItem.findMany({ where: { vendorId: v.vendor.id, variantGroup: group, removedAt: null } })).map(i => i.variantLabel).sort()
    assert(brandNew.length === 2 && ap.status === 200 && labels.join(',') === 'Large,Small' && (await reqOf(xl.data?.id as string)).status === 'PENDING',
      `approving Small creates Small and Large only; XL stays PENDING and is not created (got ${ap.status}, live: ${labels.join(',')})`)
  })

  // ── [9j] a removal closes only real new sizes, not a brand-new item's sizes sharing the group (P7 finding 9)
  console.log('\n[9j] removing the last live row closes its new sizes but not a brand-new item\'s sizes in the same group')
  await section(async () => {
    const { v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Bowl`
    const classic = await prisma.menuItem.create({ data: { vendorId: v.vendor.id, name: `${group} Classic`, price: 9, category: 'Mains', variantGroup: group, variantLabel: 'Classic', removedAt: new Date() } })
    const sub = await fileBody(v.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 7, category: 'Mains', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Large`, price: 11, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
    ] })
    const brandNewIds = ((sub.data?.requests ?? []) as Array<{ id: string }>).map(r => r.id)
    const restored = await fileBody(v.vendor.id, { type: 'RESTORE', menuItemId: classic.id }) // the group is live again
    const m = await fileBody(v.vendor.id, { type: 'ADD', name: `${group} Medium`, price: 10, category: 'Mains', variantGroup: group, variantLabel: 'Medium' })
    const del = await fileBody(v.vendor.id, { type: 'DELETE', menuItemId: classic.id })
    assert(restored.data?.status === 'APPROVED' && del.data?.status === 'APPROVED' && (await itemOf(classic.id)).removedAt !== null,
      `[0] Classic is restored, then removed again by the vendor's DELETE (got restore ${String(restored.data?.status)}, delete ${String(del.data?.status)})`)
    const mRow = await reqOf(m.data?.id as string)
    const brandNew = await prisma.menuRequest.findMany({ where: { id: { in: brandNewIds } } })
    assert(mRow.status === 'REJECTED' && mRow.reviewNote === 'Closed: the item was removed from the menu',
      `the new size Medium is closed when Classic is removed again (got ${mRow.status})`)
    assert(brandNew.length === 2 && brandNew.every(r => r.status === 'PENDING'),
      `the brand-new item's Small and Large stay PENDING (got ${brandNew.map(r => r.status).join('/')})`)
  })

  // ── [9k] a batch answers, and logs, each row's final status (P7 finding 3)
  console.log('\n[9k] add a size and remove the last row in one batch: the size is answered and logged REJECTED')
  await section(async () => {
    const { v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Wings`
    const regular = await mkItem(v.vendor.id, `${group} Regular`, 9, { variantGroup: group, variantLabel: 'Regular' })
    const sub = await fileBody(v.vendor.id, { items: [
      { type: 'ADD', name: `${group} Large`, price: 12, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
      { type: 'DELETE', menuItemId: regular.id },
    ] })
    const rows = (sub.data?.requests ?? []) as Array<{ id: string; status: string; reviewNote: string | null }>
    let entry: { status?: string } | undefined
    for (let i = 0; i < 30 && !entry; i++) {
      entry = (await prisma.vendorAuditLog.findMany({ where: { vendorId: v.vendor.id, action: 'MENU_CHANGE_REQUESTED' } }))
        .map(r => r.metadata as { requestId?: string; status?: string }).find(m => m.requestId === rows[0]?.id)
      if (!entry) await new Promise(r => setTimeout(r, 100))
    }
    assert(rows.length === 2 && rows[0].status === 'REJECTED' && rows[0].reviewNote === 'Closed: the item was removed from the menu' && (await reqOf(rows[0].id)).status === 'REJECTED',
      `the answer's Large row says REJECTED "Closed: the item was removed from the menu", as stored (got ${rows[0]?.status})`)
    assert(entry?.status === 'REJECTED', `its activity-log entry says REJECTED (got ${entry?.status})`)
  })

  // ── [9l] two simultaneous removals of a group's last two rows still close its new sizes (P7 finding 4)
  console.log('\n[9l] two simultaneous removals: the waiting new size is closed every time (5 rounds)')
  await section(async () => {
    const { v } = await mkShop()
    login(v.user.clerkId)
    const closedEachRound: string[] = []
    for (let round = 1; round <= 5; round++) {
      const group = `${PFX}Race${round}`
      const s = await mkItem(v.vendor.id, `${group} Small`, 4, { variantGroup: group, variantLabel: 'Small' })
      const mdm = await mkItem(v.vendor.id, `${group} Medium`, 5, { variantGroup: group, variantLabel: 'Medium' })
      const l = await fileBody(v.vendor.id, { type: 'ADD', name: `${group} Large`, price: 6, category: 'Drinks', variantGroup: group, variantLabel: 'Large' })
      const [d1, d2] = await Promise.all([file(v.vendor.id, { type: 'DELETE', menuItemId: s.id }), file(v.vendor.id, { type: 'DELETE', menuItemId: mdm.id })])
      closedEachRound.push(`${d1.status}/${d2.status}:${(await reqOf(l.data?.id as string)).status}`)
    }
    assert(closedEachRound.every(x => x === '201/201:REJECTED'), `both removals succeed and Large is closed in every round (got ${closedEachRound.join(', ')})`)
  })

  // ── [9m] the lock: transaction-scoped, released on error, and it really blocks (Jordan's addition 2)
  console.log('\n[9m] the vendor lock: released after a failed request and a refused approval; it blocks the same vendor only')
  await section(async () => {
    const { lockVendorMenu } = await import('../lib/menu-requests/size-groups')
    const { f, v } = await mkShop()
    const w = await mkVendor(f.id)
    login(v.user.clerkId)
    const timed = async <T>(run: () => Promise<T>) => { const t0 = Date.now(); const r = await run(); return { r, ms: Date.now() - t0 } }
    // (a) a request that fails INSIDE its transaction, then a normal one at once
    const x = await mkItem(v.vendor.id, `${PFX}lock-x`, 10)
    const y = await mkItem(v.vendor.id, `${PFX}lock-y`, 5)
    const failed = await file(v.vendor.id, { items: [{ type: 'EDIT', menuItemId: x.id, price: 20 }, { type: 'DELETE', menuItemId: y.id }, { type: 'DELETE', menuItemId: y.id }] })
    const next = await timed(() => file(v.vendor.id, { type: 'EDIT', menuItemId: x.id, description: 'after a failure' }))
    assert(failed.status === 409 && next.r.status === 201 && next.ms < 5000, `after a request fails inside its transaction (409), the next one completes at once: 201 in ${next.ms} ms`)
    // (b) an approval refused INSIDE its transaction, after the lock (apply-decision.ts: a pre-2g DELETE
    // of an item already removed is refused within the transaction), then a filing at once
    const gone = await prisma.menuItem.create({ data: { vendorId: v.vendor.id, name: `${PFX}lock-gone`, price: 6, category: 'Mains', removedAt: new Date() } })
    const legacy = await prisma.menuRequest.create({ data: { vendorId: v.vendor.id, requestedBy: v.user.id, type: 'DELETE', menuItemId: gone.id } })
    const refused = await asOrgA(() => orgDecide(f.urlSlug, legacy.id))
    login(v.user.clerkId)
    const next2 = await timed(() => file(v.vendor.id, { type: 'EDIT', menuItemId: x.id, description: 'after a refused approval' }))
    assert(refused.status === 409 && next2.r.status === 201 && next2.ms < 5000, `after an approval is refused inside its transaction (409), the next filing completes at once: 201 in ${next2.ms} ms`)
    // (c) while the vendor's lock is held, a filing for that vendor waits; another vendor's does not
    // Each holder's outcome is captured as soon as it starts (null = ran without error), so a broken
    // lock shows as one failed check below instead of an unhandled rejection that ends the whole run.
    const hold = (vendorId: string): Promise<unknown> => prisma.$transaction(async tx => { await lockVendorMenu(tx, vendorId); await new Promise(r => setTimeout(r, 1500)) }, { timeout: 10_000 })
      .then(() => null, (e: unknown) => e)
    const h1 = hold(v.vendor.id); await new Promise(r => setTimeout(r, 200))
    const blocked = await timed(() => file(v.vendor.id, { type: 'EDIT', menuItemId: x.id, description: 'waited' }))
    const h1Error = await h1
    const wItem = await mkItem(w.vendor.id, `${PFX}lock-w`, 10)
    const h2 = hold(v.vendor.id); await new Promise(r => setTimeout(r, 200))
    login(w.user.clerkId)
    const free = await timed(() => file(w.vendor.id, { type: 'EDIT', menuItemId: wItem.id, description: 'not blocked' }))
    const h2Error = await h2
    assert(h1Error === null && h2Error === null, `the lock holder ran without error both times (got ${String(h1Error ?? h2Error)})`)
    assert(blocked.r.status === 201 && blocked.ms >= 1000, `a filing for the locked vendor waits for the holder: 201 after ${blocked.ms} ms (≥ 1000)`)
    assert(free.r.status === 201 && free.ms < 1000, `[0] control: another vendor's filing is not blocked: 201 in ${free.ms} ms (< 1000)`)
    // source: transaction-scoped only
    const libSrc = ['lib/menu-requests/size-groups.ts', 'lib/menu-requests/apply-decision.ts', 'app/api/menu-requests/route.ts'].map(p => readFileSync(p, 'utf8')).join('\n')
    const SESSION = /pg_advisory_lock\s*\(/
    assert(/pg_advisory_xact_lock\(/.test(libSrc) && !SESSION.test(libSrc), 'the lock is pg_advisory_xact_lock (released at COMMIT or ROLLBACK); the session-level pg_advisory_lock is never used')
    assert(SESSION.test('SELECT pg_advisory_lock(42)') && !SESSION.test('SELECT pg_advisory_xact_lock(42)'), '[0] control: the scan tells the two apart')
  })

  // ══ Step 12: ultrareview of 748bf2f, findings 2, 4 and 5 (Jordan, 2026-11-22) ══════════════════
  const { lockVendorMenu } = await import('../lib/menu-requests/size-groups')
  type TxClient = Parameters<typeof lockVendorMenu>[0]
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const timedRun = async <T>(run: () => Promise<T>) => { const t0 = Date.now(); const r = await run(); return { r, ms: Date.now() - t0 } }
  /** Hold a vendor's menu lock for `ms`, then (if given) make a change in the same transaction and
   *  commit. The outcome is captured at once (null = ran without error), as in [9m], so a failure on
   *  old code is one failed check, never an unhandled rejection that ends the run. */
  const holdLock = (vendorId: string, ms: number, then?: (tx: TxClient) => Promise<unknown>): Promise<unknown> =>
    prisma.$transaction(async tx => { await lockVendorMenu(tx, vendorId); await sleep(ms); if (then) await then(tx) }, { timeout: ms + 10_000 })
      .then(() => null, (e: unknown) => e)

  // ── [9n] the lock wait, both directions (finding 2)
  console.log('\n[9n] the lock wait: completes within 8 s; past 8 s a named 503 MENU_BUSY, for an approval and a filing')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    // (a) held 6 s: beyond Prisma's default 5 s transaction limit, within the 8 s lock wait
    const a1 = await mkItem(v.vendor.id, `${PFX}wait-a`, 10)
    const up1 = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: a1.id, price: 12 })
    let h = holdLock(v.vendor.id, 6000); await sleep(200)
    const ap = await asOrgA(() => timedRun(() => orgDecide(f.urlSlug, up1.data?.id as string)))
    let hErr = await h
    assert(hErr === null && ap.r.status === 200 && ap.ms >= 5000 && (await itemOf(a1.id)).price === 12,
      `(a) an approval that waits ~6 s for the lock completes: 200 after ${ap.ms} ms, price 12 (got ${ap.r.status})`)
    login(v.user.clerkId)
    h = holdLock(v.vendor.id, 6000); await sleep(200)
    const fl = await timedRun(() => file(v.vendor.id, { type: 'EDIT', menuItemId: a1.id, description: 'waited 6 s' }))
    hErr = await h
    assert(hErr === null && fl.r.status === 201 && fl.ms >= 5000, `(a) a filing that waits ~6 s completes: 201 after ${fl.ms} ms (got ${fl.r.status})`)
    // (b) held 10 s: beyond the 8 s lock wait
    const b1 = await mkItem(v.vendor.id, `${PFX}wait-b`, 10)
    const up2 = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: b1.id, price: 12 })
    h = holdLock(v.vendor.id, 10_000); await sleep(200)
    const busy = await asOrgA(async () => { const t = await timedRun(() => orgDecide(f.urlSlug, up2.data?.id as string)); return { ...t, b: await bodyOf(t.r) } })
    hErr = await h
    assert(hErr === null && busy.r.status === 503 && busy.b.error?.code === 'MENU_BUSY' && /busy right now/.test(busy.b.error?.message ?? '')
      && (await reqOf(up2.data?.id as string)).status === 'PENDING' && (await itemOf(b1.id)).price === 10 && (await priceLog(b1.id)).length === 0,
    `(b) an approval still waiting after 8 s → 503 MENU_BUSY "busy right now"; still PENDING, price 10, no price-log row (got ${busy.r.status} ${busy.b.error?.code} after ${busy.ms} ms)`)
    login(v.user.clerkId)
    const rowsBefore = await prisma.menuRequest.count({ where: { vendorId: v.vendor.id } })
    h = holdLock(v.vendor.id, 10_000); await sleep(200)
    const fbusy = await timedRun(() => file(v.vendor.id, { type: 'EDIT', menuItemId: b1.id, description: 'should not land' }))
    const fb = await bodyOf(fbusy.r)
    hErr = await h
    assert(hErr === null && fbusy.r.status === 503 && fb.error?.code === 'MENU_BUSY'
      && await prisma.menuRequest.count({ where: { vendorId: v.vendor.id } }) === rowsBefore && (await itemOf(b1.id)).description !== 'should not land',
    `(b) a filing still waiting after 8 s → 503 MENU_BUSY; no request row, nothing applied (got ${fbusy.r.status} ${fb.error?.code} after ${fbusy.ms} ms)`)
    // (c) the safety net in handleApiError
    const { handleApiError } = await import('../lib/api-error')
    const timedOut = handleApiError({ code: 'P2028' })
    const timedOutBody = await bodyOf(timedOut)
    assert(timedOut.status === 503 && timedOutBody.error?.code === 'TX_TIMEOUT', `(c) a Prisma transaction timeout (P2028) → 503 TX_TIMEOUT, not 500 (got ${timedOut.status} ${timedOutBody.error?.code})`)
    assert(handleApiError({ code: 'P9999' }).status === 500, '[0] control: any other error code (P9999) is still 500')
  })

  // ── [3d] a withdraw only withdraws the increase the vendor saw (finding 4)
  console.log('\n[3d] the withdraw names its increase: refused (409) once that increase was decided or replaced')
  await section(async () => {
    const { f, v } = await mkShop()
    const w = await mkVendor(f.id)
    login(v.user.clerkId)
    const withdraw = async (itemId: string, price: unknown, withdrawsRequestId: unknown) => {
      const r = await file(v.vendor.id, { type: 'EDIT', menuItemId: itemId, price, withdrawsRequestId })
      return { status: r.status, b: await bodyOf(r) }
    }
    const rowsOf = (itemId: string) => prisma.menuRequest.count({ where: { menuItemId: itemId } })
    // still waiting → the withdraw works
    const i1 = await mkItem(v.vendor.id, `${PFX}wd-waiting`, 10)
    const up1 = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: i1.id, price: 12 })
    const ok = await withdraw(i1.id, 10, up1.data?.id)
    const old1 = await reqOf(up1.data?.id as string)
    assert(ok.status === 201 && ok.b.data?.status === 'APPROVED' && old1.status === 'REJECTED' && old1.reviewNote === 'Replaced by newer request' && (await itemOf(i1.id)).price === 10,
      `still waiting: the withdraw naming it is applied; the $12 is REJECTED "Replaced by newer request"; price 10 (got ${ok.status} ${String(ok.b.data?.status)}, ${old1.status})`)
    // already approved → 409, the approved price stays
    const i2 = await mkItem(v.vendor.id, `${PFX}wd-approved`, 10)
    const up2 = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: i2.id, price: 12 })
    const ap2 = await asOrgA(() => orgDecide(f.urlSlug, up2.data?.id as string))
    login(v.user.clerkId)
    const rows2 = await rowsOf(i2.id)
    const late = await withdraw(i2.id, 10, up2.data?.id)
    assert(ap2.status === 200 && late.status === 409 && late.b.error?.code === 'INCREASE_NOT_PENDING' && /already decided or replaced/.test(late.b.error?.message ?? '')
      && (await itemOf(i2.id)).price === 12 && await rowsOf(i2.id) === rows2,
    `already approved at $12: the withdraw → 409 INCREASE_NOT_PENDING; price stays 12; no new row (got ${late.status} ${late.b.error?.code}, price ${(await itemOf(i2.id)).price})`)
    // replaced by a newer increase → 409, the newer one stays
    const i3 = await mkItem(v.vendor.id, `${PFX}wd-replaced`, 10)
    const a = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: i3.id, price: 12 })
    const b = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: i3.id, price: 13 })
    const stale = await withdraw(i3.id, 10, a.data?.id)
    assert(stale.status === 409 && stale.b.error?.code === 'INCREASE_NOT_PENDING' && (await reqOf(b.data?.id as string)).status === 'PENDING' && (await itemOf(i3.id)).price === 10,
      `replaced by a newer $13: the withdraw naming the $12 → 409; the $13 stays PENDING; price 10 (got ${stale.status}, ${(await reqOf(b.data?.id as string)).status})`)
    // another vendor's increase → 409, nothing changes
    const i4 = await mkItem(v.vendor.id, `${PFX}wd-mine`, 10)
    const mine = await fileBody(v.vendor.id, { type: 'EDIT', menuItemId: i4.id, price: 12 })
    login(w.user.clerkId)
    const wi = await mkItem(w.vendor.id, `${PFX}wd-theirs`, 10)
    const theirs = await fileBody(w.vendor.id, { type: 'EDIT', menuItemId: wi.id, price: 12 })
    login(v.user.clerkId)
    const foreign = await withdraw(i4.id, 10, theirs.data?.id)
    assert(foreign.status === 409 && foreign.b.error?.code === 'INCREASE_NOT_PENDING' && (await reqOf(mine.data?.id as string)).status === 'PENDING'
      && (await reqOf(theirs.data?.id as string)).status === 'PENDING' && (await itemOf(i4.id)).price === 10,
    `naming another vendor's increase → 409; both increases stay PENDING; price 10 (got ${foreign.status})`)
    // the 400s: nothing written
    const rowsV = () => prisma.menuRequest.count({ where: { vendorId: v.vendor.id } })
    const n0 = await rowsV()
    const onAdd = await file(v.vendor.id, { type: 'ADD', name: `${PFX}wd-add`, price: 5, category: 'Mains', withdrawsRequestId: mine.data?.id })
    const noPrice = await file(v.vendor.id, { type: 'EDIT', menuItemId: i4.id, description: 'x', withdrawsRequestId: mine.data?.id })
    const nullPrice = await file(v.vendor.id, { type: 'EDIT', menuItemId: i4.id, price: null, withdrawsRequestId: mine.data?.id })
    const blank = await file(v.vendor.id, { type: 'EDIT', menuItemId: i4.id, price: 10, withdrawsRequestId: '  ' })
    assert(onAdd.status === 400 && noPrice.status === 400 && nullPrice.status === 400 && blank.status === 400
      && await rowsV() === n0 && (await reqOf(mine.data?.id as string)).status === 'PENDING',
    `withdrawsRequestId on an ADD, on an EDIT without a price, with price null, or blank → 400 each; no row written; the increase stays PENDING (got ${onAdd.status}/${noPrice.status}/${nullPrice.status}/${blank.status})`)
  })

  // ── [9o] the approval reads the size group under the lock (finding 5)
  console.log('\n[9o] the approval reads the size group under the lock: a group that came back while it waited is seen')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Pho`
    const classic = await prisma.menuItem.create({ data: { vendorId: v.vendor.id, name: `${group} Classic`, price: 9, category: 'Mains', variantGroup: group, variantLabel: 'Classic', removedAt: new Date() } })
    const sub = await fileBody(v.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 7, category: 'Mains', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Large`, price: 11, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
    ] })
    const [sA, sB] = ((sub.data?.requests ?? []) as Array<{ id: string }>).map(r => r.id)
    // The holder takes the lock, waits 1.5 s (the approval starts meanwhile), then brings Classic back and commits.
    const h = holdLock(v.vendor.id, 1500, tx => tx.menuItem.update({ where: { id: classic.id }, data: { removedAt: null } }))
    await sleep(200)
    const ap = await asOrgA(() => orgDecide(f.urlSlug, sA))
    const hErr = await h
    const live = (await prisma.menuItem.findMany({ where: { vendorId: v.vendor.id, variantGroup: group, removedAt: null } })).map(i => i.variantLabel).sort()
    const small = await prisma.menuItem.findFirst({ where: { vendorId: v.vendor.id, variantGroup: group, variantLabel: 'Small' } })
    const log = small ? await priceLog(small.id) : []
    assert(hErr === null && ap.status === 200 && live.join(',') === 'Classic,Small' && log[0]?.meta.source === 'REQUEST_APPROVED_SIZE' && (await reqOf(sB)).status === 'PENDING',
      `approving Small while Classic came back: only Small is created (REQUEST_APPROVED_SIZE), Large stays PENDING (got ${ap.status}, live: ${live.join(',')}, ${String(log[0]?.meta.source)}, Large ${(await reqOf(sB)).status})`)
  })

  // ── [9p] the orphan 409 is decided under the lock (finding 5)
  console.log('\n[9p] the "no longer on the menu" refusal is decided under the lock')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Ramen`
    const reg = await mkItem(v.vendor.id, `${group} Regular`, 9, { variantGroup: group, variantLabel: 'Regular' })
    const large = await fileBody(v.vendor.id, { type: 'ADD', name: `${group} Large`, price: 12, category: 'Mains', variantGroup: group, variantLabel: 'Large' })
    // The holder takes the lock, waits 1.5 s, then removes Regular directly (bypassing the close) and commits.
    const h = holdLock(v.vendor.id, 1500, tx => tx.menuItem.update({ where: { id: reg.id }, data: { removedAt: new Date() } }))
    await sleep(200)
    const ap = await asOrgA(() => orgDecide(f.urlSlug, large.data?.id as string))
    const apb = await bodyOf(ap)
    const hErr = await h
    assert(hErr === null && large.data?.status === 'PENDING' && ap.status === 409 && /no longer on the menu/.test(apb.error?.message ?? '')
      && (await reqOf(large.data?.id as string)).status === 'PENDING'
      && await prisma.menuItem.count({ where: { vendorId: v.vendor.id, variantGroup: group, variantLabel: 'Large' } }) === 0,
    `Regular removed while the approval waited → 409 "no longer on the menu"; Large still PENDING, not created (got ${ap.status}: ${apb.error?.message})`)
  })

  // ── [9q] two approvals of one brand-new item at once (Jordan, 2026-11-22)
  console.log('\n[9q] two approvals of one brand-new item at once: one decides it, the other is told it was already reviewed')
  await section(async () => {
    const { f, v } = await mkShop()
    login(v.user.clerkId)
    const group = `${PFX}Curry`
    const sub = await fileBody(v.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 8, category: 'Mains', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Large`, price: 12, category: 'Mains', variantGroup: group, variantLabel: 'Large' },
    ] })
    const ids = ((sub.data?.requests ?? []) as Array<{ id: string }>).map(r => r.id)
    const answers = await asOrgA(() => Promise.all(ids.map(id => orgDecide(f.urlSlug, id))))
    const bodies = await Promise.all(answers.map(bodyOf))
    const statuses = answers.map(r => r.status).sort()
    const refused = bodies.find((_, i) => answers[i].status === 409)
    assert(ids.length === 2 && statuses.join(',') === '200,409' && /already reviewed/i.test(refused?.error?.message ?? ''),
      `exactly one 200 and one 409 "Request already reviewed" (got ${statuses.join(',')}: ${refused?.error?.message})`)
    const items = await prisma.menuItem.findMany({ where: { vendorId: v.vendor.id, variantGroup: group } })
    const logs = await Promise.all(items.map(i => priceLog(i.id)))
    assert(items.length === 2 && items.map(i => i.variantLabel).sort().join(',') === 'Large,Small'
      && logs.every(l => l.length === 1 && l[0].meta.source === 'REQUEST_APPROVED_ADD')
      && (await prisma.menuRequest.findMany({ where: { id: { in: ids } } })).every(r => r.status === 'APPROVED'),
    `one item per size (Small, Large), each with one REQUEST_APPROVED_ADD row; both requests APPROVED (got ${items.length} items, ${logs.map(l => l.length).join('/')} rows)`)
    // One MENU_CHANGE_REVIEWED entry per size. Written in the background: wait up to 3 s, then 0.5 s more for a wrong extra one.
    const reviewed = async () => (await prisma.vendorAuditLog.findMany({ where: { vendorId: v.vendor.id, action: 'MENU_CHANGE_REVIEWED' } }))
      .map(r => (r.metadata as { requestId?: string }).requestId).filter((id): id is string => !!id && ids.includes(id))
    for (let i = 0; i < 30 && (await reviewed()).length < 2; i++) await sleep(100)
    await sleep(500)
    const entries = await reviewed()
    assert(entries.length === 2 && ids.every(id => entries.filter(e => e === id).length === 1),
      `one MENU_CHANGE_REVIEWED entry per size, none extra (got ${entries.length})`)
    // source: the guard
    const decideSrc = readFileSync('lib/menu-requests/apply-decision.ts', 'utf8').replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '')
    const GUARD = /const groupIds = group\.map\(r => r\.id\)\s*if \(!groupIds\.includes\(requestId\)\) throw new ApiError\('Request already reviewed', 409, 'CONFLICT'\)/
    const guardAt = decideSrc.search(GUARD)
    assert(guardAt >= 0 && decideSrc.indexOf("case 'ADD':") > guardAt,
      'apply-decision.ts: right after groupIds, a request that is not in it → 409 "Request already reviewed", before the ADD apply (source)')
    assert(GUARD.test("const groupIds = group.map(r => r.id)\n    if (!groupIds.includes(requestId)) throw new ApiError('Request already reviewed', 409, 'CONFLICT')")
      && !GUARD.test("const groupIds = group.map(r => r.id)\n\n    let approvedPrice: number | null = null"),
    '[0] control: the scan finds a planted guard and rejects code without it')
  })

  // ── [16b] no unsafe raw SQL in lib/menu-requests (Jordan): the raw text, comments included
  console.log('\n[16b] no $executeRawUnsafe or $queryRawUnsafe anywhere in lib/menu-requests (raw text)')
  await section(async () => {
    const UNSAFE = /\$(executeRawUnsafe|queryRawUnsafe)\b/
    const dir = 'lib/menu-requests'
    const files = readdirSync(dir).filter(n => n.endsWith('.ts'))
    const hits = files.filter(n => UNSAFE.test(readFileSync(`${dir}/${n}`, 'utf8')))
    assert(files.length >= 10 && hits.length === 0, `none of the ${files.length} files in ${dir} contains $executeRawUnsafe or $queryRawUnsafe (found in: ${hits.join(', ') || 'none'})`)
    assert(UNSAFE.test("await tx.$executeRawUnsafe(`SET lock_timeout = '8s'`)") && UNSAFE.test('await db.$queryRawUnsafe(sql)')
      && !UNSAFE.test("await tx.$executeRaw`SELECT set_config('lock_timeout', '8s', true)`"),
    '[0] control: the scan finds a planted $executeRawUnsafe( and $queryRawUnsafe(, and passes the tagged $executeRaw` form')
  })

  // ── [16c] the platform time limit on the lock-taking routes (Jordan)
  console.log('\n[16c] the three routes that take the vendor lock set maxDuration = 30')
  await section(async () => {
    const MAX = /^export const maxDuration = 30$/m
    const routes = ['app/api/menu-requests/route.ts', 'app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts', 'app/api/admin/events/[id]/menu-requests/[requestId]/route.ts']
    const missing = routes.filter(p => !MAX.test(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')))
    assert(missing.length === 0, `each lock-taking route exports maxDuration = 30 (missing in: ${missing.join(', ') || 'none'})`)
    assert(MAX.test("import x from 'y'\n\nexport const maxDuration = 30\n") && !MAX.test("import x from 'y'\n") && !MAX.test('export const maxDuration = 10\n'),
      '[0] control: the scan finds a planted maxDuration = 30 and rejects a file without one and one set to 10')
  })

  // Organizer B's fair is only there so "another organizer" has a fair of its own.
  assert(fairB.organizerId === orgB.org.id, '[0] fixture: organizer B owns a different fair')
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
