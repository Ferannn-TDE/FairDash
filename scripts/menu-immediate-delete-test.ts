/**
 * IMMEDIATE DELETE AND RESTORE THROUGH MENU REQUESTS — audit H5, Step 2g.
 *
 * Vendor menu requests now split into "applied now" and "waits for the approver" (Nov 12 rules:
 * vendors set their own prices; only brand-new items and higher-priced restores wait):
 *   - DELETE applies immediately (request written APPROVED, MENU_ITEM_REMOVED audit row);
 *   - EDIT of a live item applies immediately, every field, price up or down (audited); EDIT of a
 *     removed item is refused, on the request path and on PATCH /api/menu/[id];
 *   - RESTORE at no price, the same price or a lower one applies immediately; a HIGHER price than
 *     the item's last recorded price waits, and the item stays removed at its old price;
 *   - an ADD whose name matches a removed item (exact full name, trimmed, any case) is a RESTORE of
 *     that row, under the same rule, however long ago it was removed;
 *   - one PENDING price change per item: a newer one replaces the older (REJECTED, "Replaced by
 *     newer request");
 *   - approval compares against the CURRENT price, and the approver sees current → requested;
 *   - the approver is the event's organizer, or a strict admin only when there is no organizer;
 *     everyone else gets 404;
 *   - checkout refuses an item removed while it sat in a cart.
 *
 *   [1]  pure: priceNeedsApproval, priceChangeSummary/formatPriceChange, mayApproveForEvent
 *   [2]  DELETE: applied at once, APPROVED row, one MENU_ITEM_REMOVED row; 409 again; 404 foreign
 *   [3]  RESTORE by id: none/same/lower applied at once; higher PENDING; approve/reject
 *   [4]  ADD name match: "  cannoli " restores "Cannoli" removed a year ago, carrying the typed
 *        description/category/prep time/photo and keeping the stored name; higher is PENDING and
 *        approval applies the same fields; a non-matching ADD and an ADD matching a LIVE name stay
 *        PENDING ADDs
 *   [5]  mixed batch (DELETE + brand-new ADD) in one transaction; a failing audit write rolls the
 *        whole batch back
 *   [6]  one PENDING price change per item: a vendor price EDIT replaces an older pending one, a
 *        name-only EDIT does not; a restore replaces an older pending restore
 *   [7]  live price drops while an older increase waits: list shows current → requested;
 *        approval's audit row starts from the current price
 *   [10] EDIT of a live item: applied at once, every field, one REQUEST_APPLIED_EDIT row per price
 *        move; EDIT or PATCH of a removed item → 409
 *   [11] the vendor is told who a pending request waits for: every POST / GET ?vendorId= row says
 *        approver "organizer" or "FairSynq"; rowsFromSubmitResponse keeps price and approver; the
 *        page words its toast, banner and chip with waitingFor() and opens Removed when a restore
 *        is pending (source checks: the repo has no React test framework)
 *   [12] H5 Fix B: POST /api/menu sends a brand-new item for approval (202) and follows the
 *        restore rule for a removed item's name; a brand-new item's sizes wait together and
 *        approving or rejecting one decides all; a new size of a live item applies at once with a
 *        REQUEST_APPLIED_SIZE row in VendorAuditLog; size renames and price edits are live; the
 *        price rule applies per size
 *   [8]  approver rule: organizer / other organizer / strict admin / event_operator, with and
 *        without an organizer; GET ?eventId= on an organizer-less fair; simultaneous approvals
 *   [9]  checkout refuses an item removed while in the cart (409 ITEM_REMOVED, no order)
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs); the order route's rate limiter is set to allow-all, as in
 * scripts/checkout-floor-test.ts.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-immediate-delete-test.ts
 * Self-cleaning, prefix mid-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''
delete process.env.RATE_LIMIT_TEST
// Accepted orders stop at the Stripe key check: no key, no Stripe call possible.
delete process.env.STRIPE_SECRET_KEY
process.env.ENFORCE_VENDOR_READINESS = 'false'

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
// TEST-ONLY SHIM, as in scripts/menu-price-rules-test.ts: app/api/menu/route.ts imports
// lib/menu/getGroupedMenuItems.ts, which uses a bare `require('next/cache')` that does not exist in
// an ES-module script. Only the import needs it; the POST path never calls unstable_cache.
;(globalThis as unknown as { require?: NodeRequire }).require = createRequire(import.meta.url)

import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'mid-'
const MAIL = '@mid.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
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

/**
 * Import a module the test needs, or record ONE failed check and return null. Lets this test run
 * against a commit from before 2g (where the module does not exist) and report what fails there,
 * instead of crashing at the first import.
 */
async function importOrFail<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try { return await load() } catch (e) {
    assert(false, `${label} loads (${String(e).split('\n')[0]})`)
    return null
  }
}
type Handler<C> = (r: NextRequest, c: C) => Promise<Response>
/** A route that failed to load answers 501, so every check that calls it fails visibly. */
const missingRoute = (async () => new Response(null, { status: 501 })) as Handler<never>

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const orders = await prisma.order.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const oids = orders.map(o => o.id)
    if (oids.length) {
      await prisma.vendorOrderStatus.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: oids } } })
      await prisma.order.deleteMany({ where: { id: { in: oids } } })
    }
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
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
  console.log('\n══ IMMEDIATE DELETE AND RESTORE (H5, Step 2g) ══')
  await cleanup()

  // ── [1] pure ────────────────────────────────────────────────────────────────────────────────
  console.log('\n[1] the price gate, the summary and the approver rule')
  const gate = await importOrFail('lib/menu/price-gate', () => import('../lib/menu/price-gate'))
  const decision = await importOrFail('lib/menu-requests/apply-decision', () => import('../lib/menu-requests/apply-decision'))
  if (gate && decision) {
  const { priceNeedsApproval, priceChangeSummary, formatPriceChange } = gate
  const { mayApproveForEvent } = decision
  assert(priceNeedsApproval(8, 8.01) && !priceNeedsApproval(8, 8) && !priceNeedsApproval(8, 7.5) && !priceNeedsApproval(1.29, 1.29),
    'only a higher price (by a cent) needs approval; same (float-safe) and lower do not')
  const s = priceChangeSummary(8, 9.5)
  assert(s.deltaCents === 150 && s.pct === 18.8 && s.direction === 'up' && formatPriceChange(s) === '$8.00 → $9.50 (+$1.50, +18.8%)',
    `summary 8 → 9.50: +150¢, +18.8%, "${formatPriceChange(s)}"`)
  const d = priceChangeSummary(6, 10)
  assert(d.direction === 'up' && formatPriceChange(d) === '$6.00 → $10.00 (+$4.00, +66.7%)', `summary 6 → 10: "${formatPriceChange(d)}"`)
  assert(priceChangeSummary(0, 2).pct === null, 'from $0 (a legacy row) the percentage is null, not Infinity')
  assert(mayApproveForEvent({ organizerId: 'o1' }, { kind: 'organizer', organizerId: 'o1' })
    && !mayApproveForEvent({ organizerId: 'o1' }, { kind: 'organizer', organizerId: 'o2' })
    && !mayApproveForEvent({ organizerId: 'o1' }, { kind: 'admin' })
    && mayApproveForEvent({ organizerId: null }, { kind: 'admin' })
    && !mayApproveForEvent({ organizerId: null }, { kind: 'organizer', organizerId: 'o1' }),
  'approver rule: own organizer yes; other organizer no; admin only when there is no organizer')
  }

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
  await mkFair(orgB.org.id) // organizer B owns a different fair
  const open = await mkFair(null) // no organizer: admins decide
  const A = await mkVendor(fair.id)
  const B = await mkVendor(fair.id)
  const O = await mkVendor(open.id)
  const admin = await prisma.user.create({ data: { clerkId: `${PFX}admin-${rand()}`, email: `adm-${rand()}${MAIL}`, name: 'Admin' } })
  const eventOperatorClerk = `${PFX}evop-${rand()}`

  const mkItem = (vendorId: string, name: string, price: number, removedAt: Date | null = null) =>
    prisma.menuItem.create({ data: { vendorId, name, price, category: 'Mains', removedAt } })
  const itemOf = async (id: string) => (await prisma.menuItem.findUnique({ where: { id } }))!
  const reqOf = async (id: string) => (await prisma.menuRequest.findUnique({ where: { id } }))!
  const audit = async (vendorId: string, action: string) => (await prisma.vendorAuditLog.findMany({
    where: { vendorId, action }, orderBy: { createdAt: 'asc' },
  })).map(r => ({ userId: r.userId, meta: r.metadata as Record<string, unknown> }))

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const mr = await import('../app/api/menu-requests/route')
  const reqPOST = mr.POST as unknown as (r: NextRequest) => Promise<Response>
  const reqGET = mr.GET as unknown as (r: NextRequest) => Promise<Response>
  const orgPATCH = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string; id: string }> }) => Promise<Response>
  const orgLIST = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/route')).GET as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string }> }) => Promise<Response>
  const adminPATCH = ((await importOrFail('admin decision route', () => import('../app/api/admin/events/[id]/menu-requests/[requestId]/route')))?.PATCH
    ?? missingRoute) as unknown as Handler<{ params: Promise<{ id: string; requestId: string }> }>
  const adminLIST = ((await importOrFail('admin list route', () => import('../app/api/admin/events/[id]/menu-requests/route')))?.GET
    ?? missingRoute) as unknown as Handler<{ params: Promise<{ id: string }> }>
  const menuPATCH = (await import('../app/api/menu/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>

  const file = (vendorId: string, body: Record<string, unknown>) =>
    reqPOST(jsonReq('/api/menu-requests', 'POST', { vendorId, ...body }))
  const orgDecide = (fairSlug: string, id: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') =>
    orgPATCH(jsonReq(`/api/organizer/fairs/${fairSlug}/menu-requests/${id}`, 'PATCH', { action }),
      { params: Promise.resolve({ fairSlug, id }) })
  const adminDecide = (eventId: string, requestId: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') =>
    adminPATCH(jsonReq(`/api/admin/events/${eventId}/menu-requests/${requestId}`, 'PATCH', { action }),
      { params: Promise.resolve({ id: eventId, requestId }) })

  // ── [2] DELETE ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[2] a vendor DELETE takes the item off the menu at once')
  login(A.user.clerkId)
  {
    const item = await mkItem(A.vendor.id, `${PFX}fries`, 6)
    const r = await file(A.vendor.id, { type: 'DELETE', menuItemId: item.id })
    const b = await bodyOf(r)
    const after = await itemOf(item.id)
    const row = await reqOf(b.data?.id as string)
    const removedRows = await audit(A.vendor.id, 'MENU_ITEM_REMOVED')
    assert(r.status === 201 && after.removedAt !== null, `201 and the item is removed in the same request (got ${r.status}, removedAt ${after.removedAt})`)
    assert(row.status === 'APPROVED' && row.reviewedBy === A.user.id && row.reviewNote === 'Removed immediately by vendor' && row.reviewedAt !== null,
      `the request row is APPROVED, reviewed by the vendor, "Removed immediately by vendor" (got ${row.status}, ${row.reviewNote})`)
    assert(removedRows.length === 1 && removedRows[0].meta.menuItemId === item.id && removedRows[0].meta.price === 6
      && removedRows[0].meta.requestId === row.id && removedRows[0].userId === A.user.id,
    `one MENU_ITEM_REMOVED row with the item, its price 6 and the request (got ${removedRows.length})`)

    const again = await file(A.vendor.id, { type: 'DELETE', menuItemId: item.id })
    assert(again.status === 409, `a second DELETE of the removed item → 409 (got ${again.status})`)

    const foreign = await mkItem(B.vendor.id, `${PFX}b-item`, 7)
    const f = await file(A.vendor.id, { type: 'DELETE', menuItemId: foreign.id })
    assert(f.status === 404 && (await itemOf(foreign.id)).removedAt === null,
      `another vendor's item → 404 and it stays on B's menu (got ${f.status})`)
  }

  // ── [3] RESTORE by id ───────────────────────────────────────────────────────────────────────
  console.log('\n[3] RESTORE: same or lower applies at once, higher waits')
  {
    const priceRows = async () => (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).length
    const same = await mkItem(A.vendor.id, `${PFX}same`, 8, new Date())
    const before = await priceRows()
    const r1 = await file(A.vendor.id, { type: 'RESTORE', menuItemId: same.id })
    const r1b = await bodyOf(r1)
    const r2item = await mkItem(A.vendor.id, `${PFX}same2`, 8, new Date())
    const r2 = await file(A.vendor.id, { type: 'RESTORE', menuItemId: r2item.id, price: 8 })
    assert(r1.status === 201 && r1b.data?.status === 'APPROVED' && (await itemOf(same.id)).removedAt === null,
      `no price → back on the menu at once, request APPROVED (got ${r1.status} ${r1b.data?.status})`)
    assert(r2.status === 201 && (await itemOf(r2item.id)).removedAt === null && await priceRows() === before,
      'same price (8 → 8) → back at once, and no price audit row for either')

    const lower = await mkItem(A.vendor.id, `${PFX}lower`, 8, new Date())
    const r3 = await file(A.vendor.id, { type: 'RESTORE', menuItemId: lower.id, price: 7.5 })
    const lowerRows = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === lower.id)
    assert(r3.status === 201 && (await itemOf(lower.id)).removedAt === null && (await itemOf(lower.id)).price === 7.5,
      `lower price (8 → 7.50) → back at once at 7.50 (got ${r3.status})`)
    assert(lowerRows.length === 1 && lowerRows[0].meta.source === 'REQUEST_APPLIED_RESTORE' && lowerRows[0].meta.previousPrice === 8
      && lowerRows[0].meta.newPrice === 7.5 && lowerRows[0].userId === A.user.id,
    `one REQUEST_APPLIED_RESTORE row 8 → 7.50 by the vendor (got ${JSON.stringify(lowerRows[0]?.meta)})`)

    const higher = await mkItem(A.vendor.id, `${PFX}higher`, 8, new Date())
    const r4 = await file(A.vendor.id, { type: 'RESTORE', menuItemId: higher.id, price: 9.5 })
    const r4b = await bodyOf(r4)
    assert(r4.status === 201 && r4b.data?.status === 'PENDING' && (await itemOf(higher.id)).removedAt !== null && (await itemOf(higher.id)).price === 8,
      `higher price (8 → 9.50) → PENDING, item still removed at 8 (got ${r4b.data?.status})`)

    login(orgA.user.clerkId)
    const ap = await orgDecide(fair.urlSlug, r4b.data?.id as string)
    const higherRows = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === higher.id)
    assert(ap.status === 200 && (await itemOf(higher.id)).removedAt === null && (await itemOf(higher.id)).price === 9.5,
      `organizer approval → back on the menu at 9.50 (got ${ap.status})`)
    assert(higherRows.length === 1 && higherRows[0].meta.source === 'REQUEST_APPROVED_RESTORE' && higherRows[0].meta.previousPrice === 8
      && higherRows[0].meta.newPrice === 9.5 && higherRows[0].userId === orgA.user.id,
    'one REQUEST_APPROVED_RESTORE row 8 → 9.50 by the organizer')

    login(A.user.clerkId)
    const rejected = await mkItem(A.vendor.id, `${PFX}rej`, 8, new Date())
    const r5 = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: rejected.id, price: 12 }))
    login(orgA.user.clerkId)
    const rj = await orgDecide(fair.urlSlug, r5.data?.id as string, 'REJECT')
    assert(rj.status === 200 && (await itemOf(rejected.id)).removedAt !== null && (await itemOf(rejected.id)).price === 8,
      `rejection → still removed, still 8 (got ${rj.status})`)
  }

  // ── [4] ADD name match ──────────────────────────────────────────────────────────────────────
  console.log('\n[4] an ADD naming a removed item is that item coming back')
  login(A.user.clerkId)
  {
    const yearAgo = new Date(now - 365 * 864e5)
    const cannoli = await mkItem(A.vendor.id, 'Cannoli', 8, yearAgo)
    const r = await file(A.vendor.id, {
      type: 'ADD', name: '  cannoli ', price: 8, category: 'Dessert',
      description: 'Ricotta, pistachio', prepTime: 4, imageUrl: 'https://example.com/cannoli.jpg',
    })
    const b = await bodyOf(r)
    const count = await prisma.menuItem.count({ where: { vendorId: A.vendor.id, name: { equals: 'cannoli', mode: 'insensitive' } } })
    assert(r.status === 201 && b.data?.type === 'RESTORE' && b.data?.menuItemId === cannoli.id && b.data?.status === 'APPROVED',
      `"  cannoli " at the same price → RESTORE of "Cannoli" (removed a year ago), APPROVED (got ${b.data?.type} ${b.data?.status})`)
    assert((await itemOf(cannoli.id)).removedAt === null && count === 1, 'the same row is back on the menu; no second Cannoli was created')
    const c = await itemOf(cannoli.id)
    assert(c.name === 'Cannoli' && c.description === 'Ricotta, pistachio' && c.category === 'Dessert' && c.prepTime === 4
      && c.imageUrl === 'https://example.com/cannoli.jpg',
    `the typed description, category, prep time and photo arrive; the stored name "Cannoli" is kept (got ${c.name}, ${c.description}, ${c.category}, ${c.prepTime}, ${c.imageUrl})`)

    const tiramisu = await mkItem(A.vendor.id, 'Tiramisu', 9, yearAgo)
    const h = await bodyOf(await file(A.vendor.id, {
      type: 'ADD', name: 'TIRAMISU', price: 9.01, category: 'Dolci', description: 'Mascarpone', prepTime: 6,
      imageUrl: 'https://example.com/tiramisu.jpg',
    }))
    const tWaiting = await itemOf(tiramisu.id)
    assert(h.data?.type === 'RESTORE' && h.data?.status === 'PENDING' && h.data?.menuItemId === tiramisu.id && tWaiting.removedAt !== null
      && tWaiting.category === 'Mains' && tWaiting.description === null,
    `"TIRAMISU" at 9.01 vs its last price 9 (a year ago) → PENDING RESTORE; item still removed and untouched (got ${h.data?.type} ${h.data?.status})`)
    login(orgA.user.clerkId)
    const tAp = await orgDecide(fair.urlSlug, h.data?.id as string)
    const t = await itemOf(tiramisu.id)
    assert(tAp.status === 200 && t.removedAt === null && t.price === 9.01 && t.name === 'Tiramisu' && t.category === 'Dolci'
      && t.description === 'Mascarpone' && t.prepTime === 6 && t.imageUrl === 'https://example.com/tiramisu.jpg',
    `approval restores it at 9.01 with the typed fields, keeping the stored name (got ${tAp.status}, ${t.name}, ${t.category}, ${t.prepTime})`)
    login(A.user.clerkId)

    const fresh = await bodyOf(await file(A.vendor.id, { type: 'ADD', name: `${PFX}brand new`, price: 5, category: 'Mains' }))
    assert(fresh.data?.type === 'ADD' && fresh.data?.status === 'PENDING', `a name matching nothing → PENDING ADD (got ${fresh.data?.type} ${fresh.data?.status})`)

    await mkItem(A.vendor.id, `${PFX}dup`, 4)
    await mkItem(A.vendor.id, `${PFX}dup`, 4, new Date())
    const dup = await bodyOf(await file(A.vendor.id, { type: 'ADD', name: `${PFX}dup`, price: 4, category: 'Mains' }))
    assert(dup.data?.type === 'ADD' && dup.data?.status === 'PENDING',
      `a name also carried by a LIVE item → PENDING ADD, not a restore (got ${dup.data?.type} ${dup.data?.status})`)

    const variant = await mkItem(A.vendor.id, 'Bagna Cauda Small', 6, new Date())
    const v = await bodyOf(await file(A.vendor.id, { type: 'ADD', name: 'Bagna Cauda', price: 6, category: 'Mains' }))
    assert(v.data?.type === 'ADD' && (await itemOf(variant.id)).removedAt !== null,
      'exact full name only: "Bagna Cauda" does not restore "Bagna Cauda Small"')
  }

  // ── [5] mixed batch and rollback ────────────────────────────────────────────────────────────
  console.log('\n[5] a mixed batch, and a failing audit write rolls the batch back')
  {
    const del = await mkItem(A.vendor.id, `${PFX}batch-del`, 5)
    const r = await file(A.vendor.id, { items: [
      { type: 'DELETE', menuItemId: del.id },
      { type: 'ADD', name: `${PFX}batch-new`, price: 6, category: 'Mains' },
    ] })
    const b = await bodyOf(r)
    const rows = (b.data?.requests ?? []) as Array<{ status: string; batchId: string }>
    assert(r.status === 201 && rows.length === 2 && rows[0].status === 'APPROVED' && rows[1].status === 'PENDING'
      && rows[0].batchId === rows[1].batchId && rows[0].batchId === b.data?.batchId,
    `DELETE applied (APPROVED) and a brand-new ADD PENDING, one batchId (got ${rows.map(x => x.status).join('/')})`)
    assert((await itemOf(del.id)).removedAt !== null
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, name: `${PFX}batch-new` } }) === 0,
    'the deleted item is off the menu; the brand-new item does not exist until approved')

    const fileItem = await importOrFail('lib/menu-requests/file-item', () => import('../lib/menu-requests/file-item'))
    if (fileItem) {
    const { fileMenuRequestItem } = fileItem
    const x1 = await mkItem(A.vendor.id, `${PFX}rb1`, 5)
    const x2 = await mkItem(A.vendor.id, `${PFX}rb2`, 5)
    const reqsBefore = await prisma.menuRequest.count({ where: { vendorId: A.vendor.id } })
    let threw = false
    try {
      await prisma.$transaction(async tx => {
        const ctx = { vendorId: A.vendor.id, requestedBy: 'no-such-user', batchId: 'mrb_test' }
        await fileMenuRequestItem(tx, { type: 'DELETE', menuItemId: x1.id }, ctx)
        await fileMenuRequestItem(tx, { type: 'DELETE', menuItemId: x2.id }, ctx)
      })
    } catch { threw = true }
    assert(threw && (await itemOf(x1.id)).removedAt === null && (await itemOf(x2.id)).removedAt === null
      && await prisma.menuRequest.count({ where: { vendorId: A.vendor.id } }) === reqsBefore,
    'an audit write that fails (unknown user, foreign key) rolls back both removals and both request rows')
    }
  }

  // ── [6] one PENDING price change per item ───────────────────────────────────────────────────
  console.log('\n[6] a newer price change replaces the older PENDING one')
  {
    // An EDIT filed before 2g can still be PENDING; vendors' EDITs now apply at once.
    const item = await mkItem(A.vendor.id, `${PFX}one-pending`, 8)
    const legacy = await prisma.menuRequest.create({
      data: { vendorId: A.vendor.id, requestedBy: A.user.id, type: 'EDIT', menuItemId: item.id, price: 10 },
    })
    const nameOnly = await bodyOf(await file(A.vendor.id, { type: 'EDIT', menuItemId: item.id, name: `${PFX}renamed` }))
    assert((await reqOf(legacy.id)).status === 'PENDING' && nameOnly.data?.status === 'APPROVED',
      'a name-only EDIT (not a price change) applies and leaves the older pending price EDIT alone')
    const newer = await bodyOf(await file(A.vendor.id, { type: 'EDIT', menuItemId: item.id, price: 9 }))
    const f = await reqOf(legacy.id)
    assert(f.status === 'REJECTED' && f.reviewNote === 'Replaced by newer request' && f.reviewedBy === A.user.id,
      `the older pending price EDIT is REJECTED "Replaced by newer request" (got ${f.status}, ${f.reviewNote})`)
    assert(newer.data?.status === 'APPROVED' && (await itemOf(item.id)).price === 9,
      `the newer price EDIT applied at once: price 9 (got ${newer.data?.status}, ${(await itemOf(item.id)).price})`)
    const pending = await prisma.menuRequest.count({ where: { menuItemId: item.id, status: 'PENDING', price: { not: null } } })
    assert(pending === 0, `no PENDING price change is left for the item (got ${pending})`)

    const removed = await mkItem(A.vendor.id, `${PFX}one-pending-r`, 8, new Date())
    const high = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: removed.id, price: 11 }))
    const back = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: removed.id }))
    const h = await reqOf(high.data?.id as string)
    assert(h.status === 'REJECTED' && h.reviewNote === 'Replaced by newer request' && back.data?.status === 'APPROVED'
      && (await itemOf(removed.id)).removedAt === null && (await itemOf(removed.id)).price === 8,
    `a same-price restore replaces the pending higher one and applies at once at 8 (got ${h.status}, ${back.data?.status})`)
  }

  // ── [7] live price drops while an increase waits ────────────────────────────────────────────
  console.log('\n[7] approval compares against the CURRENT live price')
  {
    // A pending price increase can only be an EDIT filed before 2g (seeded here) or a higher
    // restore; the live price can still move through the direct API while it waits.
    const item = await mkItem(A.vendor.id, `${PFX}moving`, 8)
    const inc = { data: { id: (await prisma.menuRequest.create({
      data: { vendorId: A.vendor.id, requestedBy: A.user.id, type: 'EDIT', menuItemId: item.id, price: 10 },
    })).id } }
    const drop = await menuPATCH(jsonReq(`/api/menu/${item.id}`, 'PATCH', { price: 6 }), { params: Promise.resolve({ id: item.id }) })
    assert(drop.status === 200 && (await itemOf(item.id)).price === 6, `the live price drops 8 → 6 while the increase waits (got ${drop.status})`)

    login(orgA.user.clerkId)
    const list = await bodyOf(await orgLIST(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests?status=PENDING&take=100`, 'GET'),
      { params: Promise.resolve({ fairSlug: fair.urlSlug }) }))
    const row = ((list.data?.requests ?? []) as Array<{ id: string; priceChange: { current: number; requested: number; direction: string } | null }>)
      .find(x => x.id === inc.data?.id)
    assert(row?.priceChange?.current === 6 && row.priceChange.requested === 10 && row.priceChange.direction === 'up',
      `the organizer sees current 6 → requested 10, not the 8 it was filed against (got ${JSON.stringify(row?.priceChange)})`)

    const ap = await orgDecide(fair.urlSlug, inc.data?.id as string)
    const rows = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === item.id && x.meta.source === 'REQUEST_APPROVED_EDIT')
    assert(ap.status === 200 && (await itemOf(item.id)).price === 10 && rows.length === 1 && rows[0].meta.previousPrice === 6 && rows[0].meta.newPrice === 10,
      `approval sets 10 and its audit row records 6 → 10 (got ${JSON.stringify(rows[0]?.meta)})`)
  }

  // ── [8] approver rule ───────────────────────────────────────────────────────────────────────
  console.log('\n[8] the organizer approves; an admin only when there is no organizer')
  {
    // Organizer fair: an admin is refused, the organizer is allowed.
    login(A.user.clerkId)
    const onOrgFair = await mkItem(A.vendor.id, `${PFX}approver-a`, 8, new Date())
    const p1 = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: onOrgFair.id, price: 9 }))
    login(admin.clerkId, ['admin'])
    const a1 = await adminDecide(fair.id, p1.data?.id as string)
    const l1 = await adminLIST(jsonReq(`/api/admin/events/${fair.id}/menu-requests`, 'GET'), { params: Promise.resolve({ id: fair.id }) })
    assert(a1.status === 404 && l1.status === 404 && (await reqOf(p1.data?.id as string)).status === 'PENDING',
      `strict admin on a fair WITH an organizer → 404 (PATCH ${a1.status}, list ${l1.status}), request still PENDING`)
    login(orgB.user.clerkId)
    const b1 = await orgDecide(fair.urlSlug, p1.data?.id as string)
    assert(b1.status === 404, `another fair's organizer → 404 (got ${b1.status})`)
    login(orgA.user.clerkId)
    const o1 = await orgDecide(fair.urlSlug, p1.data?.id as string)
    assert(o1.status === 200 && (await itemOf(onOrgFair.id)).price === 9, `the fair's organizer → 200, restored at 9 (got ${o1.status})`)

    // Organizer-less fair: organizers are refused, a strict admin is allowed, event_operator is not.
    login(O.user.clerkId)
    const onOpen = await mkItem(O.vendor.id, `${PFX}approver-o`, 8, new Date())
    const p2 = await bodyOf(await file(O.vendor.id, { type: 'RESTORE', menuItemId: onOpen.id, price: 9.5 }))
    const g = await reqGET(jsonReq(`/api/menu-requests?eventId=${open.id}`, 'GET'))
    assert(g.status === 404, `GET ?eventId= on an organizer-less fair → 404 for a vendor (got ${g.status})`)
    login(orgA.user.clerkId)
    const oa = await orgDecide(open.urlSlug, p2.data?.id as string)
    assert(oa.status === 404, `an organizer on a fair with no organizer → 404 (got ${oa.status})`)
    login(eventOperatorClerk, ['event_operator'])
    const eo = await adminDecide(open.id, p2.data?.id as string)
    const eol = await adminLIST(jsonReq(`/api/admin/events/${open.id}/menu-requests`, 'GET'), { params: Promise.resolve({ id: open.id }) })
    assert(eo.status === 404 && eol.status === 404, `event_operator → 404 (PATCH ${eo.status}, list ${eol.status})`)
    login(admin.clerkId, ['admin'])
    const al = await bodyOf(await adminLIST(jsonReq(`/api/admin/events/${open.id}/menu-requests`, 'GET'), { params: Promise.resolve({ id: open.id }) }))
    const listed = ((al.data?.requests ?? []) as Array<{ id: string; priceChange: { current: number; requested: number } | null }>).find(x => x.id === p2.data?.id)
    assert(listed?.priceChange?.current === 8 && listed.priceChange.requested === 9.5, `the admin list shows it, 8 → 9.50 (got ${JSON.stringify(listed?.priceChange)})`)
    const aa = await adminDecide(open.id, p2.data?.id as string)
    const adminRows = (await audit(O.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === onOpen.id)
    assert(aa.status === 200 && (await itemOf(onOpen.id)).removedAt === null && adminRows.length === 1 && adminRows[0].userId === admin.id,
      `strict admin on a fair with NO organizer → 200, restored, audit row by the admin (got ${aa.status})`)

    // Simultaneous approvals apply exactly once.
    login(A.user.clerkId)
    const race = await mkItem(A.vendor.id, `${PFX}race`, 8, new Date())
    const p3 = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: race.id, price: 12 }))
    login(orgA.user.clerkId)
    const [x, y] = await Promise.all([orgDecide(fair.urlSlug, p3.data?.id as string), orgDecide(fair.urlSlug, p3.data?.id as string)])
    const statuses = [x.status, y.status].sort()
    const raceRows = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(r => r.meta.menuItemId === race.id)
    assert(statuses[0] === 200 && statuses[1] === 409 && raceRows.length === 1,
      `two approvals at once: one 200, one 409, one audit row (got ${statuses.join('/')}, ${raceRows.length} rows)`)
  }

  // ── [10] EDIT of a live item applies at once; a removed item cannot be edited ───────────────
  console.log('\n[10] a vendor EDIT of a live item goes live at once; a removed item must be restored first')
  login(A.user.clerkId)
  {
    const live = await mkItem(A.vendor.id, `${PFX}edit-live`, 8)
    const r = await file(A.vendor.id, {
      type: 'EDIT', menuItemId: live.id, price: 11, name: `${PFX}edit-live v2`, description: 'New recipe',
      category: 'Specials', prepTime: 12, imageUrl: 'https://example.com/v2.jpg',
    })
    const b = await bodyOf(r)
    const after = await itemOf(live.id)
    const row = await reqOf(b.data?.id as string)
    assert(r.status === 201 && row.status === 'APPROVED' && row.reviewNote === 'Applied immediately by vendor' && row.reviewedBy === A.user.id,
      `the EDIT is written APPROVED, "Applied immediately by vendor" (got ${r.status} ${row.status})`)
    assert(after.price === 11 && after.name === `${PFX}edit-live v2` && after.description === 'New recipe' && after.category === 'Specials'
      && after.prepTime === 12 && after.imageUrl === 'https://example.com/v2.jpg',
    'price UP (8 → 11), name, description, category, prep time and photo are all live at once')
    const rows = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === live.id)
    assert(rows.length === 1 && rows[0].meta.source === 'REQUEST_APPLIED_EDIT' && rows[0].meta.previousPrice === 8 && rows[0].meta.newPrice === 11
      && rows[0].meta.requestId === row.id && rows[0].userId === A.user.id,
    `one REQUEST_APPLIED_EDIT row 8 → 11 by the vendor (got ${JSON.stringify(rows[0]?.meta)})`)

    const down = await bodyOf(await file(A.vendor.id, { type: 'EDIT', menuItemId: live.id, price: 7 }))
    const descOnly = await bodyOf(await file(A.vendor.id, { type: 'EDIT', menuItemId: live.id, description: 'Tweaked' }))
    const rows2 = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === live.id)
    assert(down.data?.status === 'APPROVED' && descOnly.data?.status === 'APPROVED' && (await itemOf(live.id)).price === 7 && rows2.length === 2,
      `price DOWN (11 → 7) applies with a second row; a description-only EDIT applies with no price row (got ${rows2.length} rows)`)

    const removed = await mkItem(A.vendor.id, `${PFX}edit-removed`, 8, new Date())
    const e = await file(A.vendor.id, { type: 'EDIT', menuItemId: removed.id, price: 20 })
    const eb = await bodyOf(e)
    assert(e.status === 409 && /Restore it first/.test(eb.error?.message ?? '') && (await itemOf(removed.id)).price === 8,
      `EDIT of a removed item → 409 "Restore it first", price still 8 (got ${e.status}: ${eb.error?.message})`)
    const p = await menuPATCH(jsonReq(`/api/menu/${removed.id}`, 'PATCH', { price: 20 }), { params: Promise.resolve({ id: removed.id }) })
    assert(p.status === 409 && (await itemOf(removed.id)).price === 8,
      `PATCH /api/menu/[id] of a removed item → 409, price still 8 (got ${p.status})`)
  }

  // ── [11] the vendor is told who a pending request waits for ─────────────────────────────────
  console.log('\n[11] "Waiting for the organizer" / "Waiting for FairSynq" reaches the vendor screen')
  {
    const label = await importOrFail('lib/menu-requests/approver-label', () => import('../lib/menu-requests/approver-label'))
    if (label) {
      assert(label.menuApproverLabel('org_1') === 'organizer' && label.menuApproverLabel(null) === 'FairSynq'
        && label.waitingFor('organizer') === 'Waiting for the organizer' && label.waitingFor('FairSynq') === 'Waiting for FairSynq'
        && label.waitingFor(undefined) === 'Waiting for the organizer',
      'label: a fair with an organizer → "Waiting for the organizer"; none → "Waiting for FairSynq"')
    }

    login(A.user.clerkId)
    const onOrg = await mkItem(A.vendor.id, `${PFX}who-a`, 8, new Date())
    const a = await bodyOf(await file(A.vendor.id, { type: 'RESTORE', menuItemId: onOrg.id, price: 9 }))
    const aBatch = await bodyOf(await file(A.vendor.id, { items: [{ type: 'ADD', name: `${PFX}who-new`, price: 5, category: 'Mains' }] }))
    const aGet = await bodyOf(await reqGET(jsonReq(`/api/menu-requests?vendorId=${A.vendor.id}`, 'GET')))
    const aRows = (aGet.data as unknown as Array<{ approver?: string }>) ?? []
    assert(a.data?.status === 'PENDING' && a.data?.approver === 'organizer'
      && ((aBatch.data?.requests ?? []) as Array<{ approver?: string }>).every(r => r.approver === 'organizer'),
    `organizer fair: the pending restore and the batch rows say approver "organizer" (got ${a.data?.approver})`)
    assert(Array.isArray(aRows) && aRows.length > 0 && aRows.every(r => r.approver === 'organizer'),
      'organizer fair: GET ?vendorId= stamps "organizer" on every row, and stays a flat array')

    login(O.user.clerkId)
    const onOpen = await mkItem(O.vendor.id, `${PFX}who-o`, 8, new Date())
    const o = await bodyOf(await file(O.vendor.id, { type: 'RESTORE', menuItemId: onOpen.id, price: 9 }))
    const oGet = await bodyOf(await reqGET(jsonReq(`/api/menu-requests?vendorId=${O.vendor.id}`, 'GET')))
    const oRows = (oGet.data as unknown as Array<{ approver?: string }>) ?? []
    assert(o.data?.status === 'PENDING' && o.data?.approver === 'FairSynq' && oRows.every(r => r.approver === 'FairSynq'),
      `fair with NO organizer: POST and GET say approver "FairSynq" (got ${o.data?.approver})`)

    const { rowsFromSubmitResponse } = await import('../lib/menu-requests/staging')
    const single = rowsFromSubmitResponse({ id: 'r1', type: 'RESTORE', status: 'PENDING', menuItemId: 'm1', price: 9.5, approver: 'FairSynq' })
    const batch = rowsFromSubmitResponse({ batchId: 'mrb_1', requests: [{ id: 'r2', type: 'RESTORE', status: 'PENDING', price: 12, approver: 'organizer', batchId: 'mrb_1' }] })
    assert(single[0]?.price === 9.5 && single[0]?.approver === 'FairSynq' && batch[0]?.price === 12 && batch[0]?.approver === 'organizer',
      'rowsFromSubmitResponse keeps price and approver, single and batch form, so "Was / now" shows without a reload')
    const bare = rowsFromSubmitResponse({ id: 'r3' })
    assert(bare[0]?.price === null && !('approver' in (bare[0] ?? {})),
      '[0] control: a row without them gets price null and no approver key')

    const { readFileSync } = await import('node:fs')
    const page = readFileSync('app/vendor/[fairSlug]/menu/page.tsx', 'utf8').replace(/\r\n/g, '\n')
    assert(/toast\.success\(`\$\{waitingFor\(json\.data\.approver\)\}/.test(page),
      'page: the higher-price restore toast is worded by waitingFor(the row\'s approver)')
    assert(/const who = waitingFor\(rows\[0\]\?\.approver\)/.test(page) && /`Request submitted — \$\{who\}`/.test(page),
      'page: the submit toast says who the request is waiting for')
    assert(/\{' · '\}\{waitingFor\(pendingRequests\[0\]\?\.approver\)\}/.test(page),
      'page: the pending banner says who the requests are waiting for')
    assert(/\{waitingFor\(pendingRestore\.approver\)\}/.test(page) && /Was \$\{item\.price\.toFixed\(2\)\}, now \$\{pendingRestore\.price\.toFixed\(2\)\}/.test(page),
      'page: the removed item\'s chip says who it is waiting for, with "Was / now"')
    const opens = page.match(/setShowRemoved\(true\)/g) ?? []
    const loadAt = page.indexOf('const loadMenu = useCallback(')
    const firstOpen = page.indexOf('setShowRemoved(true)')
    assert(opens.length >= 2 && loadAt > 0 && firstOpen > loadAt && /r\.type === 'RESTORE' && r\.menuItemId && removedIds\.has\(r\.menuItemId\)/.test(page),
      'page: the Removed section opens itself when a restore is pending, on load and after a submit')
    assert(!/awaiting organizer approval/.test(page),
      'page: no hard-coded "awaiting organizer approval" is left (it would be wrong on a fair with no organizer)')
    assert(/awaiting organizer approval/.test("toast.success('Request submitted — awaiting organizer approval')"),
      '[0] control: that scan does match the old wording when present')
  }

  // ── [12] POST /api/menu and sizes (H5 Fix B) ────────────────────────────────────────────────
  console.log('\n[12] brand-new items wait (with all their sizes); a new size of a live item is a live edit')
  login(A.user.clerkId)
  {
    const menuPOST = ((await importOrFail('POST /api/menu', () => import('../app/api/menu/route')))?.POST
      ?? missingRoute) as unknown as (r: NextRequest) => Promise<Response>
    const post = (body: Record<string, unknown>) => menuPOST(jsonReq('/api/menu', 'POST', { vendorId: A.vendor.id, category: 'Mains', ...body }))
    const sizeRows = async (menuItemId: string) => (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).filter(x => x.meta.menuItemId === menuItemId)

    // POST /api/menu, brand-new → waits.
    const fresh = await post({ name: `${PFX}direct-new`, price: 7 })
    const fb = await bodyOf(fresh)
    assert(fresh.status === 202 && fb.data?.requiresApproval === true && fb.data?.approver === 'organizer'
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, name: `${PFX}direct-new` } }) === 0,
    `POST /api/menu brand-new → 202 requiresApproval, approver "organizer", no item created (got ${fresh.status})`)

    // POST /api/menu, name of a removed item → restore rule.
    const lowItem = await mkItem(A.vendor.id, `${PFX}direct-low`, 8, new Date())
    const low = await post({ name: `${PFX}direct-low`, price: 7 })
    assert(low.status === 201 && (await itemOf(lowItem.id)).removedAt === null && (await itemOf(lowItem.id)).price === 7,
      `POST /api/menu with a removed item's name at a lower price → 201, restored at 7 (got ${low.status})`)
    const highItem = await mkItem(A.vendor.id, `${PFX}direct-high`, 8, new Date())
    const high = await post({ name: `${PFX}direct-high`, price: 9 })
    assert(high.status === 202 && (await itemOf(highItem.id)).removedAt !== null,
      `POST /api/menu with a removed item's name at a higher price → 202, still removed (got ${high.status})`)

    // A brand-new item with 3 sizes, submitted together → 3 PENDING; approving one approves all 3.
    const group = `${PFX}Lemonade`
    const sub = await bodyOf(await file(A.vendor.id, { items: [
      { type: 'ADD', name: `${group} Small`, price: 3, category: 'Drinks', variantGroup: group, variantLabel: 'Small' },
      { type: 'ADD', name: `${group} Medium`, price: 4, category: 'Drinks', variantGroup: group, variantLabel: 'Medium' },
      { type: 'ADD', name: `${group} Large`, price: 5, category: 'Drinks', variantGroup: group, variantLabel: 'Large' },
    ] }))
    const subRows = (sub.data?.requests ?? []) as Array<{ id: string; status: string; variantGroup?: string; variantLabel?: string }>
    assert(subRows.length === 3 && subRows.every(r => r.status === 'PENDING' && r.variantGroup === group),
      `3 sizes of a brand-new item → 3 PENDING requests keeping their group (got ${subRows.map(r => r.status).join('/')})`)
    login(orgA.user.clerkId)
    const list = await bodyOf(await orgLIST(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests?status=PENDING&take=100`, 'GET'),
      { params: Promise.resolve({ fairSlug: fair.urlSlug }) }))
    const listed = ((list.data?.requests ?? []) as Array<{ id: string; sizesInGroup?: number | null; variantLabel?: string | null }>)
      .filter(r => subRows.some(s => s.id === r.id))
    assert(listed.length === 3 && listed.every(r => r.sizesInGroup === 3) && listed.some(r => r.variantLabel === 'Medium'),
      'the organizer queue shows each size with "3 sizes" and its label')
    const before = (await audit(A.vendor.id, 'MENU_PRICE_CHANGED')).length
    const ap = await orgDecide(fair.urlSlug, subRows[1].id)
    const created = await prisma.menuItem.findMany({ where: { vendorId: A.vendor.id, variantGroup: group }, orderBy: { price: 'asc' } })
    const statuses = await prisma.menuRequest.findMany({ where: { id: { in: subRows.map(r => r.id) } }, select: { status: true } })
    const after = await audit(A.vendor.id, 'MENU_PRICE_CHANGED')
    assert(ap.status === 200 && created.length === 3 && created.map(c => c.variantLabel).join(',') === 'Small,Medium,Large'
      && created.map(c => c.price).join(',') === '3,4,5' && statuses.every(s => s.status === 'APPROVED'),
    `approving ONE size approves all 3: created with their labels and prices, all requests APPROVED (got ${ap.status}, ${created.length} items)`)
    assert(after.length === before + 3 && after.slice(before).every(r => r.meta.source === 'REQUEST_APPROVED_ADD' && r.userId === orgA.user.id),
      'three REQUEST_APPROVED_ADD rows, one per size, by the organizer')

    // Rejecting one size rejects every size; nothing is created.
    login(A.user.clerkId)
    const rgroup = `${PFX}Fries`
    const rsub = await bodyOf(await file(A.vendor.id, { items: [
      { type: 'ADD', name: `${rgroup} Small`, price: 3, category: 'Sides', variantGroup: rgroup, variantLabel: 'Small' },
      { type: 'ADD', name: `${rgroup} Large`, price: 5, category: 'Sides', variantGroup: rgroup, variantLabel: 'Large' },
    ] }))
    const rIds = ((rsub.data?.requests ?? []) as Array<{ id: string }>).map(r => r.id)
    login(orgA.user.clerkId)
    const rj = await orgDecide(fair.urlSlug, rIds[0], 'REJECT')
    const rStatuses = await prisma.menuRequest.findMany({ where: { id: { in: rIds } }, select: { status: true } })
    assert(rj.status === 200 && rStatuses.every(s => s.status === 'REJECTED')
      && await prisma.menuItem.count({ where: { vendorId: A.vendor.id, variantGroup: rgroup } }) === 0,
    'rejecting one size rejects both, and no item is created')

    // A new size of an item that is now live → applied at once, audited for the price-change log.
    login(A.user.clerkId)
    const xl = await bodyOf(await file(A.vendor.id, { type: 'ADD', name: `${group} XL`, price: 6, category: 'Drinks', variantGroup: group, variantLabel: 'XL' }))
    const xlItem = await prisma.menuItem.findFirst({ where: { vendorId: A.vendor.id, variantGroup: group, variantLabel: 'XL' } })
    const xlRows = xlItem ? await sizeRows(xlItem.id) : []
    assert(xl.data?.status === 'APPROVED' && !!xlItem && xlItem.price === 6 && xlItem.removedAt === null,
      `a new size (XL) of the live Lemonade → applied at once, request APPROVED (got ${xl.data?.status})`)
    assert(xlRows.length === 1 && xlRows[0].meta.source === 'REQUEST_APPLIED_SIZE' && xlRows[0].meta.previousPrice === null
      && xlRows[0].meta.newPrice === 6 && xlRows[0].userId === A.user.id,
    `it writes one MENU_PRICE_CHANGED row in VendorAuditLog, source REQUEST_APPLIED_SIZE, null → 6 (what the organizer price-change log will read) (got ${JSON.stringify(xlRows[0]?.meta)})`)
    const viaPost = await post({ name: `${group} Kids`, price: 2.5, category: 'Drinks', variantGroup: group, variantLabel: 'Kids' })
    assert(viaPost.status === 201, `the same through POST /api/menu → 201 (got ${viaPost.status})`)

    // Size edits are live edits.
    const medium = created.find(c => c.variantLabel === 'Medium')!
    const repriced = await bodyOf(await file(A.vendor.id, { type: 'EDIT', menuItemId: medium.id, price: 4.5, variantLabel: 'Regular' }))
    const m2 = await itemOf(medium.id)
    const mRows = (await sizeRows(medium.id)).filter(r => r.meta.source === 'REQUEST_APPLIED_EDIT')
    assert(repriced.data?.status === 'APPROVED' && m2.price === 4.5 && m2.variantLabel === 'Regular' && mRows.length === 1,
      'renaming a size and changing its price → live at once, one REQUEST_APPLIED_EDIT row')

    // Rules: the price rule per size, and sizes need both fields.
    const badBatch = await file(A.vendor.id, { items: [
      { type: 'ADD', name: `${PFX}Tea Small`, price: 2, category: 'Drinks', variantGroup: `${PFX}Tea`, variantLabel: 'Small' },
      { type: 'ADD', name: `${PFX}Tea Large`, price: 0.5, category: 'Drinks', variantGroup: `${PFX}Tea`, variantLabel: 'Large' },
    ] })
    assert(badBatch.status === 400 && await prisma.menuRequest.count({ where: { vendorId: A.vendor.id, variantGroup: `${PFX}Tea` } }) === 0,
      `one size priced $0.50 → 400 and nothing is written for any size (got ${badBatch.status})`)
    const halfSize = await file(A.vendor.id, { type: 'ADD', name: `${PFX}Half`, price: 2, category: 'Drinks', variantGroup: `${PFX}Half` })
    const moveSize = await file(A.vendor.id, { type: 'EDIT', menuItemId: medium.id, variantGroup: `${PFX}Other` })
    assert(halfSize.status === 400 && moveSize.status === 400,
      `a size without its size name → 400; moving a size to another item → 400 (got ${halfSize.status}/${moveSize.status})`)
  }

  // ── [9] checkout refuses an item removed while in the cart ──────────────────────────────────
  console.log('\n[9] checkout refuses an item removed while it sat in a cart')
  {
    const rl = await import('../lib/ratelimit')
    const allowAll = { limit: async () => ({ success: true, limit: 99, remaining: 99, reset: Date.now() + 3600e3 }) }
    rl.__setStateForTest({ type: 'ready', limiters: new Proxy({}, { get: () => allowAll }) as never })
    const { POST: orderPOST } = await import('../app/api/orders/route')

    const pizza = await mkItem(A.vendor.id, `${PFX}pizza`, 12)
    const customer = `${PFX}cust-${rand()}`
    const place = async () => {
      login(customer)
      const res = await orderPOST(jsonReq('/api/orders', 'POST', {
        eventId: fair.id, fulfillmentType: 'BOOTH_PICKUP', customerName: 'C', customerPhone: '6185550100',
        items: [{ menuItemId: pizza.id, vendorId: A.vendor.id, quantity: 1 }],
        // The total shown to the customer (audit H5, 2h): $12 + 10% fee = 1320¢ at the 0% default.
        expectedTotalCents: 1320,
      }))
      const j = await bodyOf(res)
      return { status: res.status, code: j.error?.code, message: j.error?.message }
    }
    const beforeRemoval = await place()
    assert(beforeRemoval.status === 503 && beforeRemoval.code === 'STRIPE_NOT_CONFIGURED',
      `[0] positive control: while on the menu, the cart passes every item check and stops at the Stripe key (got ${beforeRemoval.status} ${beforeRemoval.code})`)

    login(A.user.clerkId)
    const del = await file(A.vendor.id, { type: 'DELETE', menuItemId: pizza.id })
    assert(del.status === 201, `the vendor removes it through a menu request (got ${del.status})`)

    const afterRemoval = await place()
    assert(afterRemoval.status === 409 && afterRemoval.code === 'ITEM_REMOVED' && afterRemoval.message === `${PFX}pizza is no longer on the menu`,
      `the same cart → 409 ITEM_REMOVED "${PFX}pizza is no longer on the menu" (got ${afterRemoval.status} ${afterRemoval.code}: ${afterRemoval.message})`)
    assert(await prisma.order.count({ where: { eventId: fair.id } }) === 0, 'and no order was written')
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
