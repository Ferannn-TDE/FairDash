/**
 * MENU OWNERSHIP BOUNDARY PROOF — a vendor can change only their own booth's menu, and only
 * through organizer review (or the sold-out toggle).
 *
 * The hole this closes (2026-11-14): PATCH and DELETE /api/menu/[id] called requireVendorAuth()
 * only, which proves membership of SOME booth, so any signed-in vendor (even a fresh applicant)
 * could reprice or delete another booth's item. Checkout charges the stored price, so this was
 * money-adjacent. POST /api/menu created items live with no review. And /api/menu-requests
 * never checked that an EDIT/DELETE/RESTORE target belonged to the requesting booth, while the
 * organizer approval applied it blindly.
 *
 *  [0] baseline + probe controls: the mocked identity and fixtures work (owner's sold-out
 *      toggle → 200 and the row changes), anonymous → 401
 *  [1] removed routes: app/api/menu/[id] is gone, app/api/menu/route.ts exports GET only
 *      (read from source: that module's unstable_cache require can't load outside Next; the
 *      export check is proven on a planted PATCH export first), and the two customer menu
 *      pages still fetch GET /api/menu
 *  [2] sold-out toggle: another booth's item → 404 NOT_FOUND (audit C1: refused looks like
 *      missing, so item ids can't be probed), unchanged
 *  [3] vendor request path: an EDIT/DELETE/RESTORE on another booth's item (same fair or
 *      another fair) → 404 NOT_FOUND, 0 rows; a mixed batch lands 0 rows; filing as another
 *      booth → 404 NOT_FOUND; positive: own-item EDIT → 201
 *      (codes: merge decisions D2 and D6, 2026-11-21 — the same 404 as every other C1 refusal)
 *  [4] organizer approval: a planted request pointing at another vendor's item → 409
 *      ITEM_VENDOR_MISMATCH, still PENDING, item unchanged; another fair's organizer → 404 (fair
 *      resolver, existence not revealed), nothing changed;
 *      positive: a legitimate EDIT approved → 200 and the price changes
 *  [5] who may write menu items (static): direct writes only in the sold-out toggle and the
 *      reviewed request path (lib/menu-requests/file-item.ts files a vendor's request,
 *      lib/menu-requests/apply-decision.ts applies an organizer's or admin's decision; the
 *      organizer route calls it since audit H5 2g); Event/Vendor deletes (they cascade to menu
 *      items) only in the draft-fair delete; each list proven on a planted bad file
 *  [6] the cascade chain into MenuItem, read from prisma/schema.prisma, is exactly
 *      {Vendor, Event}; proven on a planted schema copy with an extra cascade into Vendor
 *
 * Run: ./scripts/with-test-db.sh npx tsx scripts/menu-ownership-boundary-proof.ts
 * Self-cleaning, prefix mob-.
 */
import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''                 // vendor-auth cache → straight to the DB
delete process.env.FIREBASE_PROJECT_ID     // approval notifications become no-ops: never touch real Firebase
delete process.env.FIREBASE_CLIENT_EMAIL
delete process.env.FIREBASE_PRIVATE_KEY

import { register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)  // Clerk identity + next/cache no-op, before any handler import

import { NextRequest } from 'next/server'
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const prisma = testPrisma()
const PFX = 'mob-'
const MAIL = '@mob.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
type Res = { status: number; json: any }
/** A refusal must be for the RIGHT reason: status AND code (a 403 for some other reason is not this boundary). */
function assertRefused(res: Res, status: number, code: string, label: string) {
  const got = res.json?.error?.code ?? '(none)'
  assert(res.status === status && got === code, `${label} → ${status} ${code} (got ${res.status} ${got})`)
}
const login = (clerkId: string | null) => { (globalThis as any).__MOCK_CLERK = clerkId ? { userId: clerkId } : undefined }
const body = async (r: Response): Promise<Res> => ({ status: r.status, json: await r.json().catch(() => ({})) })

// ── Real handlers ─────────────────────────────────────────────────────────────
let availabilityPATCH: any, menuRequestPOST: any, approvalPATCH: any
async function loadHandlers() {
  availabilityPATCH = (await import('../app/api/menu-items/[id]/availability/route')).PATCH
  menuRequestPOST   = (await import('../app/api/menu-requests/route')).POST
  approvalPATCH     = (await import('../app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route')).PATCH
}
const json = (url: string, method: string, b: object) =>
  new NextRequest(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
async function toggle(clerkId: string | null, itemId: string, isAvailable: boolean) {
  login(clerkId)
  return body(await availabilityPATCH(json('http://t/api/menu-items/x/availability', 'PATCH', { isAvailable }), { params: Promise.resolve({ id: itemId }) }))
}
async function fileRequest(clerkId: string, b: object) {
  login(clerkId)
  return body(await menuRequestPOST(json('http://t/api/menu-requests', 'POST', b)))
}
async function review(clerkId: string, fairSlug: string, id: string, action: 'APPROVE' | 'REJECT') {
  login(clerkId)
  return body(await approvalPATCH(json('http://t/api/organizer/x', 'PATCH', { action }), { params: Promise.resolve({ fairSlug, id }) }))
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vids = (await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })).map(v => v.id)
    await prisma.vendorAuditLog.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  const orgs = await prisma.fairOrganizer.findMany({ where: { name: { startsWith: PFX } }, select: { id: true } })
  await prisma.orgMember.deleteMany({ where: { organizerId: { in: orgs.map(o => o.id) } } })
  await prisma.fairOrganizer.deleteMany({ where: { id: { in: orgs.map(o => o.id) } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}
async function mkUser(tag: string) {
  return prisma.user.create({ data: { clerkId: `${PFX}clerk-${tag}-${rand()}`, email: `${PFX}${tag}-${rand()}${MAIL}`, name: `MOB ${tag}` } })
}
async function mkFair(tag: string) {
  const org = await prisma.fairOrganizer.create({ data: { name: `${PFX}org-${tag}`, contactEmail: `org-${tag}${MAIL}`, approvalStatus: 'APPROVED' } })
  const orgUser = await mkUser(`org${tag}`)
  await prisma.orgMember.create({ data: { organizerId: org.id, userId: orgUser.id, role: 'owner' } })
  const event = await prisma.event.create({
    data: { name: `${PFX}fair-${tag}`, urlSlug: `${PFX}${tag}-${rand()}`, status: 'ACTIVE', organizerId: org.id,
            startDate: new Date(), endDate: new Date(Date.now() + 864e5) },
  })
  return { org, orgUser, event }
}
async function mkBooth(eventId: string, tag: string) {
  const vendor = await prisma.vendor.create({ data: { eventId, name: `${PFX}booth-${tag}`, slug: `${PFX}v-${tag}-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' } })
  const owner = await mkUser(`v${tag}`)
  await prisma.vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: 'owner', approvalStatus: 'APPROVED' } })
  const item = await prisma.menuItem.create({ data: { vendorId: vendor.id, name: `${PFX}item-${tag}`, price: 10, category: 'Mains' } })
  return { vendor, owner, item }
}

// ── Static scanners (used by [1], [5], [6]) ───────────────────────────────────
const WRITE_OPS = '(?:update|updateMany|create|createMany|delete|deleteMany|upsert)'
const DIRECT_MENU_WRITE = new RegExp(`\\.\\s*menuItem\\s*\\.\\s*${WRITE_OPS}\\b|\\bmenuItems\\s*:\\s*\\{\\s*${WRITE_OPS}\\b`, 'g')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}
/** Every file under `roots` that matches `re`, as repo-relative (or absolute, outside the repo) paths. */
function filesMatching(roots: string[], re: RegExp): string[] {
  const hits = new Set<string>()
  for (const root of roots) for (const f of walk(root)) {
    re.lastIndex = 0
    if (re.test(readFileSync(f, 'utf8'))) hits.add(f.startsWith(process.cwd()) || !f.startsWith('/') ? relative(process.cwd(), f) || f : f)
  }
  return [...hits].sort()
}
/** Prisma models whose onDelete: Cascade chain reaches `target`. */
function cascadeChain(schema: string, target: string): string[] {
  const edges: { child: string; parent: string; cascade: boolean }[] = []
  for (const [, model, bodyText] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const raw of bodyText.split('\n')) {
      const line = raw.split('//')[0]
      const m = line.match(/^\s*\w+\s+(\w+)\??\s+@relation\(([^)]*)\)/)
      if (m && m[2].includes('fields:')) edges.push({ child: model, parent: m[1], cascade: /onDelete:\s*Cascade/.test(m[2]) })
    }
  }
  const seen = new Set<string>(); const todo = [target]
  while (todo.length) {
    const c = todo.pop()!
    for (const e of edges) if (e.child === c && e.cascade && !seen.has(e.parent)) { seen.add(e.parent); todo.push(e.parent) }
  }
  return [...seen].sort()
}
/** HTTP-method exports declared in a route's source (export async function X / export const X). */
const exportedMethods = (src: string) =>
  [...src.matchAll(/^export\s+(?:async\s+function|function|const|let)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)].map(m => m[1]).sort()

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await loadHandlers()
  await cleanup()

  const X = await mkFair('x')
  const Y = await mkFair('y')
  const A = await mkBooth(X.event.id, 'a')
  const B = await mkBooth(X.event.id, 'b')
  const C = await mkBooth(Y.event.id, 'c')
  const priceOf = async (id: string) => (await prisma.menuItem.findUniqueOrThrow({ where: { id } })).price
  const requestsOf = (vendorId: string) => prisma.menuRequest.count({ where: { vendorId } })

  console.log('[0] baseline and probe controls')
  const own = await toggle(A.owner.clerkId, A.item.id, false)
  assert(own.status === 200 && (await prisma.menuItem.findUniqueOrThrow({ where: { id: A.item.id } })).isAvailable === false,
    `owner marks their own item sold out → 200 and the row changes (got ${own.status}): identity mock + fixtures work`)
  await toggle(A.owner.clerkId, A.item.id, true)
  assertRefused(await toggle(null, A.item.id, false), 401, 'UNAUTHORIZED', 'anonymous sold-out toggle')

  console.log('[1] the removed routes')
  assert(JSON.stringify(exportedMethods('export async function GET() {}\nexport async function PATCH() {}\n')) === '["GET","PATCH"]', '[1] probe control: the export reader finds a planted PATCH export')
  assert(JSON.stringify(exportedMethods('export async function GET() {}\n// export async function POST\n')) === '["GET"]', '[1] probe baseline: a commented-out POST is not an export')
  assert(!existsSync('app/api/menu/[id]'), 'app/api/menu/[id] (direct PATCH/DELETE/GET of any item) is gone')
  const menuMethods = exportedMethods(readFileSync('app/api/menu/route.ts', 'utf8'))
  assert(JSON.stringify(menuMethods) === '["GET"]', `app/api/menu/route.ts exports GET only, no direct POST (got ${menuMethods.join(', ')})`)
  for (const page of ['app/fair/[fairSlug]/browse/page.tsx', 'app/fair/[fairSlug]/menu/page.tsx']) {
    assert(readFileSync(page, 'utf8').includes('fetch(`/api/menu?eventSlug='), `the customer menu still reads GET /api/menu: ${page}`)
  }

  console.log('[2] sold-out toggle')
  assertRefused(await toggle(A.owner.clerkId, B.item.id, false), 404, 'NOT_FOUND', "vendor A marks booth B's item sold out")
  assert((await prisma.menuItem.findUniqueOrThrow({ where: { id: B.item.id } })).isAvailable === true, "booth B's item is unchanged")

  console.log('[3] vendor request path')
  for (const type of ['EDIT', 'DELETE', 'RESTORE'] as const) {
    const r = await fileRequest(A.owner.clerkId, { vendorId: A.vendor.id, type, menuItemId: B.item.id, ...(type === 'EDIT' && { price: 1 }) })
    assertRefused(r, 404, 'NOT_FOUND', `vendor A files ${type} on booth B's item (same fair)`)
  }
  assertRefused(await fileRequest(A.owner.clerkId, { vendorId: A.vendor.id, type: 'EDIT', menuItemId: C.item.id, price: 1 }), 404, 'NOT_FOUND', "vendor A files EDIT on booth C's item (another fair)")
  assert(await requestsOf(A.vendor.id) === 0, 'none of those refusals wrote a request row')
  const mixed = await fileRequest(A.owner.clerkId, { vendorId: A.vendor.id, items: [
    { type: 'EDIT', menuItemId: A.item.id, price: 12 },
    { type: 'EDIT', menuItemId: B.item.id, price: 1 },
  ] })
  assertRefused(mixed, 404, 'NOT_FOUND', "a batch of [own edit, booth B's item]")
  assert(await requestsOf(A.vendor.id) === 0, 'the mixed batch landed 0 rows (all or nothing)')
  assertRefused(await fileRequest(A.owner.clerkId, { vendorId: B.vendor.id, type: 'EDIT', menuItemId: B.item.id, price: 1 }), 404, 'NOT_FOUND', 'vendor A files a request as booth B')
  const legit = await fileRequest(A.owner.clerkId, { vendorId: A.vendor.id, type: 'EDIT', menuItemId: A.item.id, price: 12.5 })
  assert(legit.status === 201 && await requestsOf(A.vendor.id) === 1, `POSITIVE: vendor A files EDIT on their own item → 201, 1 row (got ${legit.status})`)

  console.log('[4] organizer approval')
  // A row pointing at another booth's item, planted the way a pre-fix request would have landed.
  const planted = await prisma.menuRequest.create({ data: { vendorId: A.vendor.id, requestedBy: A.owner.id, type: 'EDIT', menuItemId: B.item.id, price: 1 } })
  const mismatch = await review(X.orgUser.clerkId, X.event.urlSlug, planted.id, 'APPROVE')
  assertRefused(mismatch, 409, 'ITEM_VENDOR_MISMATCH', "organizer X approves A's request that targets booth B's item")
  assert(mismatch.json?.error?.message === "This change no longer matches the vendor's menu and can't be applied.", `the organizer sees the plain message (got "${mismatch.json?.error?.message}")`)
  assert((await prisma.menuRequest.findUniqueOrThrow({ where: { id: planted.id } })).status === 'PENDING', 'the refused request stays PENDING')
  assert(await priceOf(B.item.id) === 10, "booth B's item price is unchanged")
  const legitId = legit.json?.data?.id as string
  // resolveOwnedFair matches the fair on the session's organizer, so another organizer's fair is
  // "not found" (404, existence not revealed) before any per-request check runs.
  const yTry = await review(Y.orgUser.clerkId, X.event.urlSlug, legitId, 'APPROVE')
  assert(yTry.status === 404 && yTry.json?.error?.code === 'NOT_FOUND' && yTry.json?.error?.message === 'Fair not found or access denied',
    `organizer Y approves a request at fair X → 404 "Fair not found or access denied" (got ${yTry.status} ${yTry.json?.error?.message})`)
  assert((await prisma.menuRequest.findUniqueOrThrow({ where: { id: legitId } })).status === 'PENDING' && await priceOf(A.item.id) === 10, "organizer Y's attempt changed nothing")
  const ok = await review(X.orgUser.clerkId, X.event.urlSlug, legitId, 'APPROVE')
  assert(ok.status === 200 && await priceOf(A.item.id) === 12.5, `POSITIVE: organizer X approves A's own-item EDIT → 200 and the price is now 12.5 (got ${ok.status}, ${await priceOf(A.item.id)})`)

  console.log('[5] who may write menu items (static)')
  const ROOTS = ['app', 'lib', 'workers']
  // The sold-out toggle stays first: the isAvailable-only check below reads DIRECT_ALLOWED[0].
  const DIRECT_ALLOWED = ['app/api/menu-items/[id]/availability/route.ts', 'lib/menu-requests/apply-decision.ts', 'lib/menu-requests/file-item.ts']
  const CASCADE_DELETE = /\.\s*(?:event|vendor)\s*\.\s*(?:delete|deleteMany)\b/g
  const CASCADE_ALLOWED = ['app/api/organizer/fairs/drafts/[fairSlug]/route.ts']
  const tmp = mkdtempSync(join(tmpdir(), 'mob-guard-'))
  try {
    writeFileSync(join(tmp, 'rogue-writer.ts'), 'export const x = () => db.menuItem.update({ where: { id: "1" }, data: { price: 0 } })\n')
    writeFileSync(join(tmp, 'rogue-delete.ts'), 'export const y = () => tx.vendor.delete({ where: { id: "1" } })\n')
    const plantedDirect = filesMatching([tmp], DIRECT_MENU_WRITE)
    assert(plantedDirect.length === 1 && plantedDirect[0].endsWith('rogue-writer.ts'), `[5] probe control: a planted db.menuItem.update is caught and named (${plantedDirect.join(', ') || 'nothing'})`)
    const plantedCascade = filesMatching([tmp], CASCADE_DELETE)
    assert(plantedCascade.length === 1 && plantedCascade[0].endsWith('rogue-delete.ts'), `[5] probe control: a planted tx.vendor.delete is caught and named (${plantedCascade.join(', ') || 'nothing'})`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  const direct = filesMatching(ROOTS, DIRECT_MENU_WRITE)
  assert(DIRECT_ALLOWED.every(f => direct.includes(f)), '[5] baseline: the scan finds all three allowed direct writers')
  const extraDirect = direct.filter(f => !DIRECT_ALLOWED.includes(f))
  assert(extraDirect.length === 0, `no other file writes menu items directly${extraDirect.length ? `: ${extraDirect.join(', ')}` : ''}`)
  const toggleSrc = readFileSync(DIRECT_ALLOWED[0], 'utf8')
  assert(/menuItem\.update\(\{\s*where: \{ id \},\s*data: \{ isAvailable \},?\s*\}\)/.test(toggleSrc) && (toggleSrc.match(DIRECT_MENU_WRITE) ?? []).length === 1, 'the sold-out toggle writes isAvailable and nothing else')
  const cascade = filesMatching(ROOTS, CASCADE_DELETE)
  assert(CASCADE_ALLOWED.every(f => cascade.includes(f)), '[5] baseline: the scan finds the draft-fair delete')
  const extraCascade = cascade.filter(f => !CASCADE_ALLOWED.includes(f))
  assert(extraCascade.length === 0, `no other file deletes an Event or Vendor (cascades to menu items)${extraCascade.length ? `: ${extraCascade.join(', ')}` : ''}`)

  console.log('[6] cascade chain into MenuItem (schema)')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const extraCascadeIntoVendor = schema.replace(/^model Vendor \{\n/m, 'model Vendor {\n  mobProbeUser   User   @relation("mobProbe", fields: [mobProbeUserId], references: [id], onDelete: Cascade)\n  mobProbeUserId String\n')
  const tmp2 = mkdtempSync(join(tmpdir(), 'mob-schema-'))
  try {
    writeFileSync(join(tmp2, 'schema.prisma'), extraCascadeIntoVendor)
    const plantedChain = cascadeChain(readFileSync(join(tmp2, 'schema.prisma'), 'utf8'), 'MenuItem')
    const added = plantedChain.filter(m => !['Event', 'Vendor'].includes(m))
    assert(extraCascadeIntoVendor !== schema && added.length === 1 && added[0] === 'User', `[6] probe control: a planted cascade into Vendor changes the chain and names the model (added: ${added.join(', ') || 'none'})`)
  } finally { rmSync(tmp2, { recursive: true, force: true }) }
  const chain = cascadeChain(schema, 'MenuItem')
  assert(JSON.stringify(chain) === '["Event","Vendor"]', `the live schema's cascade chain into MenuItem is exactly Event, Vendor (got ${chain.join(', ')})`)
}

main()
  .catch(e => { fail++; console.error('  ❌ suite crashed:', e) })
  .finally(async () => {
    await new Promise(r => setTimeout(r, 400)) // fire-and-forget audit writes land before cleanup
    await cleanup().catch(e => console.error('cleanup failed', e))
    await prisma.$disconnect()
    console.log(`\n  ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
