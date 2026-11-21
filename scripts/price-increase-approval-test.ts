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

    const totalAt = (dollars: number) => checkoutTotals({
      lines: [{ inPersonCents: toCents(dollars), quantity: 1 }], markupBps: 0, deliveryFeeCents: 0, serviceChargeCents: 0, tipCents: 0,
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
