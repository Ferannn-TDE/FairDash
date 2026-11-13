/**
 * MENU PRICE AUDIT — audit H5, Step 2f.
 *
 * Every menu-item price write now leaves a MENU_PRICE_CHANGED row in VendorAuditLog, written in
 * the SAME transaction as the price (lib/menu/price-audit.ts), so a price change that cannot be
 * recorded does not happen. The organizer approval route also re-checks the request's price
 * against the $1.00–$10,000 rule (2a) and applies the change and the review in one transaction.
 *
 *   [1] the helper: priceChanged in cents; a failing audit write rolls the price back (real
 *       transaction), with a positive control that the same write commits with a real user
 *   [2] POST /api/menu (since H5 Fix B): a brand-new item writes no item and no row until it is
 *       approved; a new size of a live item writes one REQUEST_APPLIED_SIZE row, previous null
 *   [3] PATCH /api/menu/[id]: one row on a real change; none for the same price, no price, or a
 *       description-only edit; none for a refused price
 *   [4] organizer approval: ADD and price-changing EDIT write REQUEST_APPROVED_* rows with the
 *       organizer as the user and the requestId; same-price and price-less EDITs write none;
 *       DELETE and RESTORE still apply
 *   [5] (a) a request priced under $1.00 (filed before 2a) is refused 422 on approval: request
 *       stays PENDING, item untouched, no audit row; REJECT still clears it
 *   [6] source: each route writes through `tx` inside db.$transaction; the approval route's item
 *       writes AND its status update are inside that one transaction (b); the price re-check runs
 *       before it
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-price-audit-test.ts
 * Self-cleaning, prefix mpat-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)
// TEST-ONLY SHIM, as in scripts/menu-price-rules-test.ts: app/api/menu/route.ts imports
// lib/menu/getGroupedMenuItems.ts, which uses a bare `require('next/cache')` that does not exist
// in an ES-module script. Only the import needs it; the POST path never calls unstable_cache.
;(globalThis as unknown as { require?: NodeRequire }).require = createRequire(import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { priceChanged, recordMenuPriceChange } from '../lib/menu/price-audit'

const prisma = testPrisma()
const PFX = 'mpat-'
const MAIL = '@mpat.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

/** Reads a source file as text with LF endings, so the scans behave the same on a CRLF checkout. */
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function login(clerkId: string) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
}
function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
async function bodyOf(res: Response): Promise<{ data?: Record<string, unknown>; error?: { code?: string; message?: string } } | null> {
  try { return await res.json() } catch { return null }
}

type AuditMeta = {
  menuItemId?: string; name?: string; previousPrice?: number | null; newPrice?: number
  previousCents?: number | null; newCents?: number; source?: string; requestId?: string | null
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
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
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  console.log('\n══ MENU PRICE AUDIT (H5, Step 2f) ══')
  await cleanup()

  // ── fixture: an approved organizer's live fair, one vendor with an operator ───────────────────
  const org = await prisma.fairOrganizer.create({
    data: { name: `${PFX}org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
  })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: `ou-${rand()}${MAIL}`, name: 'Organizer' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: org.id,
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })
  const vendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const vUser = await prisma.user.create({ data: { clerkId: `${PFX}v-${rand()}`, email: `vu-${rand()}${MAIL}`, name: 'Operator', role: 'vendor' } })
  await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: vUser.id, role: 'owner', approvalStatus: 'APPROVED' } })

  const auditRows = async () => (await prisma.vendorAuditLog.findMany({
    where: { vendorId: vendor.id, action: 'MENU_PRICE_CHANGED' }, orderBy: { createdAt: 'asc' },
  })).map(r => ({ userId: r.userId, meta: r.metadata as AuditMeta }))
  const priceOf = async (id: string) => (await prisma.menuItem.findUnique({ where: { id }, select: { price: true } }))!.price

  // ── [1] the helper ──────────────────────────────────────────────────────────────────────────
  console.log('\n[1] priceChanged, and a failing audit write rolls the price back')
  assert(priceChanged(null, 5) && priceChanged(5, 5.01) && !priceChanged(5, 5) && !priceChanged(1.29, 1.29),
    'priceChanged: new item and a 1¢ change count; the same price (float-safe, 1.29) does not')
  {
    const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}tx`, price: 8, category: 'Mains' } })
    let threw = false
    try {
      await prisma.$transaction(async tx => {
        await tx.menuItem.update({ where: { id: item.id }, data: { price: 9 } })
        await recordMenuPriceChange(tx, {
          vendorId: vendor.id, userId: 'no-such-user', menuItemId: item.id, name: item.name,
          previousPrice: 8, newPrice: 9, source: 'DIRECT_EDIT',
        })
      })
    } catch { threw = true }
    assert(threw, 'an audit write that fails (unknown user, foreign key) throws out of the transaction')
    assert(await priceOf(item.id) === 8, `the price write in the same transaction rolled back (price ${await priceOf(item.id)})`)
    assert((await auditRows()).length === 0, 'and no audit row exists')
    await prisma.$transaction(async tx => {
      await tx.menuItem.update({ where: { id: item.id }, data: { price: 9 } })
      await recordMenuPriceChange(tx, {
        vendorId: vendor.id, userId: vUser.id, menuItemId: item.id, name: item.name,
        previousPrice: 8, newPrice: 9, source: 'DIRECT_EDIT',
      })
    })
    assert(await priceOf(item.id) === 9 && (await auditRows()).length === 1,
      '[0] positive control: the same transaction with a real user commits the price AND one row')
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: vendor.id } })
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const menuPOST = (await import('../app/api/menu/route')).POST as unknown as (r: NextRequest) => Promise<Response>
  const menuPATCH = (await import('../app/api/menu/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>
  const approvePATCH = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: { params: Promise<{ fairSlug: string; id: string }> }) => Promise<Response>

  // ── [2] direct create ───────────────────────────────────────────────────────────────────────
  // Since H5 Fix B, POST /api/menu sends a brand-new item for approval: no item and no price row
  // until it is approved (approval writes REQUEST_APPROVED_ADD, section [4]). A new SIZE of an item
  // that is already live is a live edit: created at once with one REQUEST_APPLIED_SIZE row.
  console.log('\n[2] POST /api/menu: a brand-new item writes nothing yet; a new size of a live item writes one row')
  login(vUser.clerkId)
  {
    const fresh = await menuPOST(jsonReq('/api/menu', 'POST', { vendorId: vendor.id, name: `${PFX}fresh`, price: 12.5, category: 'Mains' }))
    const items = await prisma.menuItem.count({ where: { vendorId: vendor.id, name: `${PFX}fresh` } })
    assert(fresh.status === 202 && items === 0 && (await auditRows()).length === 0,
      `brand-new item → 202, no item, no MENU_PRICE_CHANGED row (got ${fresh.status}, ${items} items)`)

    await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}soda Small`, price: 2, category: 'Drinks', variantGroup: `${PFX}soda`, variantLabel: 'Small' } })
    const size = await menuPOST(jsonReq('/api/menu', 'POST', {
      vendorId: vendor.id, name: `${PFX}soda Large`, price: 3.5, category: 'Drinks', variantGroup: `${PFX}soda`, variantLabel: 'Large',
    }))
    const sizeBody = await bodyOf(size)
    const rows = await auditRows()
    const m = rows[0]?.meta
    assert(size.status === 201 && sizeBody?.data?.variantLabel === 'Large' && rows.length === 1,
      `new size of a live item → 201, created, one MENU_PRICE_CHANGED row (got ${size.status}, ${rows.length})`)
    assert(m?.source === 'REQUEST_APPLIED_SIZE' && m.previousPrice === null && m.newPrice === 3.5 && m.newCents === 350
      && rows[0]?.userId === vUser.id && m.menuItemId === sizeBody?.data?.id,
    `row: REQUEST_APPLIED_SIZE, previous null, new 3.50 / 350¢, by the operator, naming the new size (got ${JSON.stringify(m)})`)
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: vendor.id } })
  }
  const itemId = (await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}taco`, price: 12.5, category: 'Mains' } })).id

  // ── [3] direct edit ─────────────────────────────────────────────────────────────────────────
  console.log('\n[3] PATCH /api/menu/[id] writes a row only for a real price change')
  const patch = (body: Record<string, unknown>) =>
    menuPATCH(jsonReq(`/api/menu/${itemId}`, 'PATCH', body), { params: Promise.resolve({ id: itemId }) })
  {
    const p1 = await patch({ price: 9.5 })
    let rows = await auditRows()
    const m = rows[0]?.meta
    assert(p1.status === 200 && rows.length === 1, `12.50 → 9.50: 200 and one new row (got ${p1.status}, ${rows.length} rows)`)
    assert(m?.source === 'DIRECT_EDIT' && m.previousPrice === 12.5 && m.newPrice === 9.5 && m.previousCents === 1250 && m.newCents === 950 && rows[0]?.userId === vUser.id,
      `row: DIRECT_EDIT, 12.5 → 9.5, by the operator (got ${JSON.stringify(m)})`)

    const same = await patch({ price: '9.50' })
    const noPrice = await patch({ isAvailable: false })
    const descOnly = await patch({ description: 'spicy' })
    rows = await auditRows()
    assert(same.status === 200 && noPrice.status === 200 && descOnly.status === 200 && rows.length === 1,
      `the same price ("9.50"), no price, and a description-only edit add no row (statuses ${same.status}/${noPrice.status}/${descOnly.status}, ${rows.length} rows)`)

    const refusedPatch = await patch({ price: -1 })
    const refusedPost = await menuPOST(jsonReq('/api/menu', 'POST', { vendorId: vendor.id, name: `${PFX}cheap`, price: 0.5, category: 'Mains' }))
    rows = await auditRows()
    assert(refusedPatch.status === 400 && refusedPost.status === 400 && rows.length === 1,
      `a refused price (PATCH -1, POST 0.50) writes no row (got ${refusedPatch.status}/${refusedPost.status}, ${rows.length} rows)`)
    assert(await priceOf(itemId) === 9.5, 'and the stored price is still 9.5')
  }

  // ── [4] organizer approval ──────────────────────────────────────────────────────────────────
  console.log('\n[4] organizer approval writes REQUEST_APPROVED_* rows inside the same transaction')
  login(orgUser.clerkId)
  const approve = (id: string, action: 'APPROVE' | 'REJECT' = 'APPROVE') =>
    approvePATCH(jsonReq(`/api/organizer/fairs/${event.urlSlug}/menu-requests/${id}`, 'PATCH', { action }),
      { params: Promise.resolve({ fairSlug: event.urlSlug, id }) })
  const mkRequest = (data: Record<string, unknown>) =>
    prisma.menuRequest.create({ data: { vendorId: vendor.id, requestedBy: vUser.id, status: 'PENDING', ...data } as never })
  const statusOf = async (id: string) => (await prisma.menuRequest.findUnique({ where: { id }, select: { status: true } }))!.status
  {
    const before = (await auditRows()).length
    const addReq = await mkRequest({ type: 'ADD', name: `${PFX}nachos`, price: 7.25, category: 'Snacks' })
    const r = await approve(addReq.id)
    const rows = await auditRows()
    const m = rows[rows.length - 1]?.meta
    const newItem = await prisma.menuItem.findFirst({ where: { vendorId: vendor.id, name: `${PFX}nachos` } })
    assert(r.status === 200 && await statusOf(addReq.id) === 'APPROVED' && !!newItem && newItem.price === 7.25,
      `ADD approved: 200, request APPROVED, item created at 7.25 (got ${r.status})`)
    assert(rows.length === before + 1 && m?.source === 'REQUEST_APPROVED_ADD' && m.previousPrice === null && m.newPrice === 7.25
      && m.requestId === addReq.id && m.menuItemId === newItem?.id && rows[rows.length - 1]?.userId === orgUser.id,
      `one REQUEST_APPROVED_ADD row: previous null, new 7.25, the requestId, the new item, the organizer as user (got ${JSON.stringify(m)})`)
  }
  {
    const before = (await auditRows()).length
    const editReq = await mkRequest({ type: 'EDIT', menuItemId: itemId, price: 11 })
    const r = await approve(editReq.id)
    const rows = await auditRows()
    const m = rows[rows.length - 1]?.meta
    assert(r.status === 200 && await priceOf(itemId) === 11 && rows.length === before + 1 && m?.source === 'REQUEST_APPROVED_EDIT'
      && m.previousPrice === 9.5 && m.newPrice === 11 && m.requestId === editReq.id && rows[rows.length - 1]?.userId === orgUser.id,
      `EDIT 9.50 → 11.00 approved: one REQUEST_APPROVED_EDIT row by the organizer (got ${r.status}, ${JSON.stringify(m)})`)

    const sameReq = await mkRequest({ type: 'EDIT', menuItemId: itemId, price: 11 })
    const nameReq = await mkRequest({ type: 'EDIT', menuItemId: itemId, name: `${PFX}taco deluxe` })
    const r2 = await approve(sameReq.id)
    const r3 = await approve(nameReq.id)
    assert(r2.status === 200 && r3.status === 200 && (await auditRows()).length === before + 1,
      `a same-price EDIT and a name-only EDIT are approved and add no row (got ${r2.status}/${r3.status})`)
  }
  {
    const delReq = await mkRequest({ type: 'DELETE', menuItemId: itemId })
    const d = await approve(delReq.id)
    const removed = (await prisma.menuItem.findUnique({ where: { id: itemId }, select: { removedAt: true } }))!.removedAt
    const resReq = await mkRequest({ type: 'RESTORE', menuItemId: itemId })
    const rs = await approve(resReq.id)
    const restored = (await prisma.menuItem.findUnique({ where: { id: itemId }, select: { removedAt: true } }))!.removedAt
    assert(d.status === 200 && removed !== null && await statusOf(delReq.id) === 'APPROVED',
      `DELETE still applies inside the transaction: removedAt set, request APPROVED (got ${d.status})`)
    assert(rs.status === 200 && restored === null && await statusOf(resReq.id) === 'APPROVED',
      `RESTORE still applies inside the transaction: removedAt cleared, request APPROVED (got ${rs.status})`)
  }

  // ── [5] (a) price re-check on approval ──────────────────────────────────────────────────────
  console.log('\n[5] a request priced under $1.00 (filed before 2a) cannot be approved')
  {
    const before = (await auditRows()).length
    const itemsBefore = await prisma.menuItem.count({ where: { vendorId: vendor.id } })
    const cheapAdd = await mkRequest({ type: 'ADD', name: `${PFX}cheap add`, price: 0.5, category: 'Snacks' })
    const a = await approve(cheapAdd.id)
    const ab = await bodyOf(a)
    assert(a.status === 422 && ab?.error?.code === 'UNPROCESSABLE' && /Price must be between \$1\.00 and \$10,000/.test(ab?.error?.message ?? ''),
      `ADD at $0.50 → 422 naming the price rule (got ${a.status} ${ab?.error?.code}: ${ab?.error?.message})`)
    assert(await statusOf(cheapAdd.id) === 'PENDING' && await prisma.menuItem.count({ where: { vendorId: vendor.id } }) === itemsBefore,
      'the request stays PENDING and no item was created')

    const cheapEdit = await mkRequest({ type: 'EDIT', menuItemId: itemId, price: 0.5 })
    const e = await approve(cheapEdit.id)
    assert(e.status === 422 && await statusOf(cheapEdit.id) === 'PENDING' && await priceOf(itemId) === 11,
      `EDIT to $0.50 → 422, request PENDING, item price still 11 (got ${e.status}, ${await priceOf(itemId)})`)
    assert((await auditRows()).length === before, 'no audit row from either refused approval')

    const rej = await approve(cheapAdd.id, 'REJECT')
    assert(rej.status === 200 && await statusOf(cheapAdd.id) === 'REJECTED',
      `[0] positive control: the organizer can still REJECT it (got ${rej.status})`)
  }

  // ── [6] source ──────────────────────────────────────────────────────────────────────────────
  console.log('\n[6] source: writes go through tx inside db.$transaction')
  // The approval logic moved into the shared decision both approver routes call (H5 2g).
  // POST /api/menu files through lib/menu-requests/file-item.ts since H5 Fix B; that module is
  // handed the caller's transaction, so its calls must all pass that `tx`, and the route must call
  // it inside db.$transaction.
  {
    const fileItem = strip(readSource('lib/menu-requests/file-item.ts'))
    const calls = [...fileItem.matchAll(/record(?:MenuPriceChange|MenuItemRemoved)\((\w+),/g)]
    assert(calls.length >= 4 && calls.every(c => c[1] === 'tx'),
      `lib/menu-requests/file-item.ts: every audit write passes the caller's tx (${calls.length} call(s))`)
    const menuRoute = strip(readSource('app/api/menu/route.ts'))
    assert(/db\.\$transaction\(tx =>\s*\n?\s*fileMenuRequestItem\(tx,/.test(menuRoute),
      'app/api/menu/route.ts: POST files the item inside db.$transaction, passing its tx')
  }
  const routes = ['app/api/menu/[id]/route.ts', 'lib/menu-requests/apply-decision.ts']
  for (const f of routes) {
    const src = strip(readSource(f))
    const txAt = src.indexOf('db.$transaction(async tx =>')
    const calls = [...src.matchAll(/recordMenuPriceChange\((\w+),/g)]
    assert(txAt > 0 && calls.length > 0 && calls.every(c => c[1] === 'tx' && (c.index ?? -1) > txAt),
      `${f}: every recordMenuPriceChange( passes tx, after db.$transaction(async tx => (${calls.length} call(s))`)
  }
  const approval = strip(readSource('lib/menu-requests/apply-decision.ts'))
  const txAt = approval.indexOf('db.$transaction(async tx =>')
  assert(!/db\.menuItem\.(create|update)\(/.test(approval), 'approval route: no menu-item write outside the transaction (no db.menuItem.create/update)')
  assert(!/db\.menuRequest\.update(Many)?\(/.test(approval) && approval.indexOf('tx.menuRequest.updateMany(') > txAt,
    '(b) approval: the status update is tx.menuRequest.updateMany (PENDING only) inside the same transaction')
  const recheckAt = approval.indexOf('parseInPersonPrice(menuRequest.price)')
  assert(recheckAt > 0 && txAt > 0 && recheckAt < txAt, '(a) approval route: the price re-check runs before the transaction')
  const plantedArg = [...'await recordMenuPriceChange(db, {'.matchAll(/recordMenuPriceChange\((\w+),/g)][0]?.[1]
  assert(plantedArg === 'db', `[0] control: the call scan reads the client argument, so a planted db call would fail the tx check (read "${plantedArg}")`)
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
