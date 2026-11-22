/**
 * VENDOR MENU CACHE — every vendor-menu write EXPIRES the vendor's menu cache, so the very next
 * load is fresh (local dev DB check D.4, 2026-11-16).
 *
 * THE BUG: the vendor deleted an item; it showed under "Removed from menu" AND stayed in the
 * active list until a second page reload. The active list is served from unstable_cache
 * (lib/menu/getGroupedMenuItems.ts, tag `vendor-menu-{vendorId}`), and every write cleared it with
 * revalidateTag(tag, 'default'). In Next 16 a profile only marks the data stale: the NEXT request
 * is still served the old copy while it refreshes in the background. The menu page reloads straight
 * after each change, so it got the old list. `{ expire: 0 }` makes that next request wait for fresh
 * data (Next's documented choice for a Route Handler; updateTag exists only in Server Actions).
 *
 *   [1] each real write route, one change at a time, records exactly one `vendor-menu-{vendorId}`
 *       entry, with { expire: 0 } and never a string profile:
 *         POST /api/menu-requests: a DELETE (the D.4 case), an EDIT and a same-price RESTORE (each
 *         applied at once), and a rename riding on a price increase (the rename is live, the price
 *         waits, F2); PATCH /api/menu-items/[id]/availability; and organizer approvals
 *         (lib/menu-requests/apply-decision.ts) of a new size of a live item (which waits, F4) and
 *         of a brand-new item. A price-only increase and a new size clear nothing when filed
 *       (the EDIT, RESTORE, new-size and refusal rows first ran on the direct PATCH/DELETE
 *        /api/menu/[id] and POST /api/menu, removed in the Batch 1 merge, 2026-11-21, D1)
 *       and a refused request (another vendor's item → 404) records nothing for the tag
 *   [2] source guard: no revalidateTag( names a vendor-menu- tag in app/ or lib/; the helper uses
 *       { expire: 0 }; each write site calls expireVendorMenu( — with positive controls
 *
 * Display only: checkout never reads this cache (app/api/orders/route.ts re-reads items and prices
 * from the database and refuses removed or sold-out items).
 *
 * Real route handlers on the test DB; Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs, scripts/_next-cache-mock.mjs). .env.local is NOT loaded, and the
 * Redis and Upstash variables are emptied, so this suite reaches no Redis at all (the vendor auth
 * cache falls back to the database).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/vendor-menu-cache-test.ts
 * Self-cleaning, prefix vmc-.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { testPrisma } from '../lib/test-db'
process.env.REDIS_URL = ''
process.env.UPSTASH_REDIS_REST_URL = ''
process.env.UPSTASH_REDIS_REST_TOKEN = ''

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

import { NextRequest } from 'next/server'

const prisma = testPrisma()
const PFX = 'vmc-'
const MAIL = '@vmc.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

function login(clerkId: string) {
  ;(globalThis as unknown as { __MOCK_CLERK?: { userId: string } }).__MOCK_CLERK = { userId: clerkId }
}
function jsonReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}
type Body = { success?: boolean; data?: Record<string, unknown> }
async function bodyOf(res: Response): Promise<Body> {
  try { return await res.json() as Body } catch { return {} }
}

type Call = { tag: string; profile: unknown }
type CacheMock = { revalidated: string[]; revalidatedWith: Call[] }

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.menuChangeEvent.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  // A whole-account delete cascades to VendorMember and OrgMember (the delete
  // scripts/membership-delete-guard.ts allows); membership rows are never deleted directly.
  await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: MAIL } }, { clerkId: { startsWith: PFX } }] } })
  await prisma.fairOrganizer.deleteMany({ where: { contactEmail: { endsWith: MAIL } } })
}

async function main() {
  console.log('\n══ VENDOR MENU CACHE: writes expire the vendor menu at once ══')
  await cleanup()

  const cache = await import('next/cache') as unknown as CacheMock
  // Every call across the whole run, kept before each reset — so the closing "never a string
  // profile" check sees all of them, not just the last step's.
  const allCalls: Call[] = []
  const reset = () => {
    allCalls.push(...cache.revalidatedWith)
    cache.revalidated.length = 0
    cache.revalidatedWith.length = 0
  }
  const isExpireNow = (p: unknown) =>
    typeof p === 'object' && p !== null && (p as { expire?: unknown }).expire === 0
  /** Exactly one entry for this vendor's tag, and it expires at once. */
  const expiredOnce = (vendorId: string) => {
    const mine = cache.revalidatedWith.filter(c => c.tag === `vendor-menu-${vendorId}`)
    return { ok: mine.length === 1 && isExpireNow(mine[0].profile), seen: JSON.stringify(mine) }
  }

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  const now = Date.now()
  const org = await prisma.fairOrganizer.create({
    data: { name: `${PFX}org`, contactEmail: `org-${rand()}${MAIL}`, approvalStatus: 'APPROVED' },
  })
  const orgUser = await prisma.user.create({ data: { clerkId: `${PFX}org-${rand()}`, email: `orgu-${rand()}${MAIL}`, name: 'Organizer' } })
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const fair = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE', organizerId: org.id,
      startDate: new Date(now - 864e5), endDate: new Date(now + 864e5),
    },
  })
  const mkVendor = async (tag: string) => {
    const vendor = await prisma.vendor.create({
      data: { eventId: fair.id, name: `${PFX}${tag}`, slug: `${PFX}${tag}-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
    })
    const user = await prisma.user.create({ data: { clerkId: `${PFX}${tag}-${rand()}`, email: `${tag}-${rand()}${MAIL}`, name: tag, role: 'vendor' } })
    await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'APPROVED' } })
    return { vendor, user }
  }
  const A = await mkVendor('a')
  const B = await mkVendor('b')
  const mkItem = (vendorId: string, name: string, price: number, extra: { variantGroup?: string; variantLabel?: string } = {}) =>
    prisma.menuItem.create({ data: { vendorId, name, price, category: 'Mains', ...extra } })

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  type Ctx<P> = { params: Promise<P> }
  const reqPOST = (await import('../app/api/menu-requests/route')).POST as unknown as (r: NextRequest) => Promise<Response>
  /** File one menu request as the logged-in vendor (the only vendor write path since 2026-11-21, D1). */
  const file = (body: Record<string, unknown>) => reqPOST(jsonReq('/api/menu-requests', 'POST', body))
  const availPATCH = (await import('../app/api/menu-items/[id]/availability/route')).PATCH as unknown as
    (r: NextRequest, c: Ctx<{ id: string }>) => Promise<Response>
  const orgPATCH = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH as unknown as
    (r: NextRequest, c: Ctx<{ fairSlug: string; id: string }>) => Promise<Response>

  // ── [1] each write route ────────────────────────────────────────────────────────────────────
  console.log('\n[1] each vendor-menu write expires the vendor menu at once ({ expire: 0 }), exactly once')
  login(A.user.clerkId)

  {
    const soda = await mkItem(A.vendor.id, `${PFX}soda`, 2)
    reset()
    const res = await reqPOST(jsonReq('/api/menu-requests', 'POST', { vendorId: A.vendor.id, type: 'DELETE', menuItemId: soda.id }))
    const r = expiredOnce(A.vendor.id)
    assert(res.status === 200 || res.status === 201, `POST /api/menu-requests DELETE answers 2xx (got ${res.status})`)
    assert(r.ok, `the D.4 case: a request-path DELETE expires vendor-menu at once (seen ${r.seen})`)
  }
  {
    const burger = await mkItem(A.vendor.id, `${PFX}burger`, 9)
    reset()
    const res = await file({ vendorId: A.vendor.id, type: 'EDIT', menuItemId: burger.id, name: `${PFX}burger-deluxe` })
    const r = expiredOnce(A.vendor.id)
    assert(res.status === 201 && r.ok, `EDIT request of a live item (name) → 201, applied, expires at once (got ${res.status}, seen ${r.seen})`)
  }
  {
    // A removed item put back at no new price is applied at once, so the menu changes and must expire.
    const fries = await prisma.menuItem.create({ data: { vendorId: A.vendor.id, name: `${PFX}fries`, price: 4.5, category: 'Mains', removedAt: new Date() } })
    reset()
    const res = await file({ vendorId: A.vendor.id, type: 'RESTORE', menuItemId: fries.id })
    const rb = await bodyOf(res)
    const r = expiredOnce(A.vendor.id)
    assert(res.status === 201 && (rb.data as { status?: string } | undefined)?.status === 'APPROVED' && r.ok,
      `same-price RESTORE request → 201 APPROVED, expires at once (got ${res.status}, seen ${r.seen})`)
  }
  {
    const tea = await mkItem(A.vendor.id, `${PFX}tea`, 3)
    for (const isAvailable of [false, true]) {
      reset()
      const res = await availPATCH(jsonReq(`/api/menu-items/${tea.id}/availability`, 'PATCH', { isAvailable }),
        { params: Promise.resolve({ id: tea.id }) })
      const r = expiredOnce(A.vendor.id)
      assert(res.status === 200 && r.ok,
        `PATCH availability → ${isAvailable ? 'available' : 'sold out'}: 200, expires at once (got ${res.status}, seen ${r.seen})`)
    }
  }
  {
    const group = `${PFX}Lemonade`
    await mkItem(A.vendor.id, `${group} Small`, 3, { variantGroup: group, variantLabel: 'Small' })
    reset()
    const res = await file({
      vendorId: A.vendor.id, type: 'ADD', name: `${group} Large`, price: 5, category: 'Drinks', variantGroup: group, variantLabel: 'Large',
    })
    const sb = await bodyOf(res)
    const sizeReq = sb.data as { id?: string; status?: string } | undefined
    // A new size of a live item waits (F4): nothing is on the menu yet, so filing it clears nothing.
    assert(res.status === 201 && sizeReq?.status === 'PENDING' && cache.revalidatedWith.every(c => c.tag !== `vendor-menu-${A.vendor.id}`),
      `ADD request, a new size of a live item → 201 PENDING, clears nothing yet (got ${res.status} ${sizeReq?.status})`)
    login(orgUser.clerkId)
    reset()
    const ap = await orgPATCH(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests/${sizeReq?.id}`, 'PATCH', { action: 'APPROVE' }),
      { params: Promise.resolve({ fairSlug: fair.urlSlug, id: sizeReq?.id ?? '' }) })
    const r = expiredOnce(A.vendor.id)
    assert(ap.status === 200 && r.ok, `approving the new size → 200, expires at once (got ${ap.status}, seen ${r.seen})`)
    login(A.user.clerkId)
  }
  {
    // F2: a price-only increase waits, so the live menu is unchanged and nothing is cleared; an
    // increase that also renames the item changes the menu now (the rename is live), so it clears.
    const wrap = await mkItem(A.vendor.id, `${PFX}wrap`, 7)
    reset()
    const up = await bodyOf(await file({ vendorId: A.vendor.id, type: 'EDIT', menuItemId: wrap.id, price: 8 }))
    assert((up.data as { status?: string } | undefined)?.status === 'PENDING' && cache.revalidatedWith.every(c => c.tag !== `vendor-menu-${A.vendor.id}`),
      `a price-only increase is PENDING and clears nothing (got ${(up.data as { status?: string } | undefined)?.status})`)
    reset()
    const mixed = await bodyOf(await file({ vendorId: A.vendor.id, type: 'EDIT', menuItemId: wrap.id, price: 9, name: `${PFX}wrap-xl` }))
    const r = expiredOnce(A.vendor.id)
    assert((mixed.data as { status?: string } | undefined)?.status === 'PENDING' && r.ok,
      `an increase plus a rename answers PENDING but expires at once for the live rename (got ${(mixed.data as { status?: string } | undefined)?.status}, seen ${r.seen})`)
  }
  {
    // A brand-new item waits for the organizer; nothing is on the menu yet, so filing it clears nothing.
    reset()
    const filed = await bodyOf(await reqPOST(jsonReq('/api/menu-requests', 'POST', {
      vendorId: A.vendor.id, type: 'ADD', name: `${PFX}nachos`, price: 8, category: 'Mains',
    })))
    // A single-item request answers with its row as `data` (scripts/menu-immediate-delete-test.ts reads
    // `data.status`); a batch answers with `data.requests`.
    const requestId = ((filed.data?.requests as unknown[] | undefined)?.[0] ?? filed.data) as { id?: string; status?: string } | undefined
    assert(requestId?.status === 'PENDING' && cache.revalidatedWith.every(c => c.tag !== `vendor-menu-${A.vendor.id}`),
      `a brand-new ADD is PENDING and clears nothing yet (got ${requestId?.status})`)

    login(orgUser.clerkId)
    reset()
    const res = await orgPATCH(jsonReq(`/api/organizer/fairs/${fair.urlSlug}/menu-requests/${requestId?.id}`, 'PATCH', { action: 'APPROVE' }),
      { params: Promise.resolve({ fairSlug: fair.urlSlug, id: requestId?.id ?? '' }) })
    const r = expiredOnce(A.vendor.id)
    assert(res.status === 200 && r.ok, `organizer approval (apply-decision) → 200, expires at once (got ${res.status}, seen ${r.seen})`)
    login(A.user.clerkId)
  }
  {
    // Refused: vendor A deleting vendor B's item gets the same 404 as a missing item, and clears nothing.
    const bItem = await mkItem(B.vendor.id, `${PFX}b-item`, 5)
    reset()
    const res = await file({ vendorId: A.vendor.id, type: 'DELETE', menuItemId: bItem.id })
    const touched = cache.revalidatedWith.filter(c => c.tag.startsWith('vendor-menu'))
    assert(res.status === 404 && touched.length === 0,
      `a refused write (another vendor's item → 404) clears no vendor-menu cache (got ${res.status}, ${JSON.stringify(touched)})`)
  }
  reset()
  const vendorMenuCalls = allCalls.filter(c => c.tag.startsWith('vendor-menu-'))
  // 8 recorded writes: request DELETE, EDIT, RESTORE, availability ×2, the new size's approval, the
  // live rename riding on a waiting increase, and the brand-new item's organizer approval.
  assert(vendorMenuCalls.length === 8 && !vendorMenuCalls.some(c => typeof c.profile === 'string'),
    `across the whole run (${vendorMenuCalls.length} vendor-menu-{id} entries), none used a string (stale-while-revalidate) profile`)

  // ── [2] source guard ────────────────────────────────────────────────────────────────────────
  console.log('\n[2] source: vendor-menu caches are expired only through expireVendorMenu')
  const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // A revalidateTag( call whose first argument names a vendor-menu- tag (template or string literal).
  const BARE = /revalidateTag\(\s*[`'"]vendor-menu-/
  const offenders = (src: string) => BARE.test(strip(src))
  assert(offenders("revalidateTag(`vendor-menu-${id}`, 'default')") && offenders("revalidateTag('vendor-menu-' + id, 'max')"),
    'control: the scanner flags a direct revalidateTag on a vendor-menu- tag')
  assert(!offenders('expireVendorMenu(id)') && !offenders("// revalidateTag(`vendor-menu-${id}`, 'default')\r\n")
    && !offenders("revalidateTag('vendor-menu', 'default')"),
  'control: it ignores the helper, comments (CRLF included) and the general vendor-menu tag')

  const walk = (dir: string): string[] => readdirSync(dir).flatMap(e => {
    const p = join(dir, e)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e) ? [p] : []
  })
  const files = [...walk('app'), ...walk('lib')].map(f => f.replace(/\\/g, '/'))
  assert(files.length > 200, `scanned a real corpus (${files.length} files)`)
  const bare = files.filter(f => f !== 'lib/menu/menu-cache.ts' && offenders(readFileSync(f, 'utf8')))
  assert(bare.length === 0, `no direct revalidateTag on a vendor-menu- tag outside lib/menu/menu-cache.ts (offenders: ${bare.join(', ') || 'none'})`)

  let helper = ''
  try { helper = strip(readFileSync('lib/menu/menu-cache.ts', 'utf8')) } catch { /* reported below */ }
  assert(/export function expireVendorMenu\(/.test(helper)
    && /revalidateTag\(\s*`vendor-menu-\$\{vendorId\}`\s*,\s*\{\s*expire:\s*0\s*\}\s*\)/.test(helper),
  'lib/menu/menu-cache.ts: expireVendorMenu calls revalidateTag(`vendor-menu-${vendorId}`, { expire: 0 })')

  // The direct POST /api/menu and PATCH/DELETE /api/menu/[id] were write sites until they were
  // removed in the Batch 1 merge (2026-11-21, D1); /api/menu is now GET only and writes nothing.
  const SITES = [
    'app/api/menu-requests/route.ts',
    'app/api/menu-items/[id]/availability/route.ts',
    'lib/menu-requests/apply-decision.ts',
  ]
  for (const f of SITES) {
    const src = strip(readFileSync(f, 'utf8'))
    assert(/expireVendorMenu\(/.test(src) && /from '@\/lib\/menu\/menu-cache'/.test(src), `${f} expires through expireVendorMenu`)
  }
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
