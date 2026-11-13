/**
 * MENU PRICE RULES — audit H5, Step 2a.
 *
 * Before this, POST /api/menu and PATCH /api/menu/[id] stored `Number(price)` with no bounds, so a
 * negative, NaN or $1,000,000 price went straight onto a live menu, and the menu-request path had
 * its own looser rule ($0.01–$10,000, any number of decimals). Now all three paths share
 * lib/menu/price.ts: at least $1.00, at most $10,000, at most 2 decimals.
 *
 *   [1] the rule itself (pure), including the inputs JSON cannot carry (NaN, Infinity)
 *   [2] POST /api/menu          — each bad price is refused with 400 and NO row is created
 *   [3] PATCH /api/menu/[id]    — each bad price is refused with 400 and the stored price is unchanged
 *   [4] POST /api/menu-requests — ADD and EDIT, each bad price refused with 400 and NO request row
 *   [5] accepted prices land on every path, stored as the parsed value ("12.50" → 12.5)
 *   [6] source: no write path still stores a raw Number(price)
 *
 * Every refusal section has a positive control on the same fixture, so "refused" cannot pass on a
 * route that refuses everything.
 *
 * Real route handlers on the test DB; only Clerk identity and next/cache are mocked
 * (scripts/_route-loader.mjs).
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-price-rules-test.ts
 * Self-cleaning, prefix mprt-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })
process.env.REDIS_URL = ''

import { createRequire, register } from 'node:module'
register('./_route-loader.mjs', import.meta.url)

// TEST-ONLY SHIM. app/api/menu/route.ts imports lib/menu/getGroupedMenuItems.ts (for its GET),
// which reaches next/cache through a bare `require(...)` (see the note in lib/menu/on-menu.ts).
// `require` does not exist in an ES-module script, so importing the route throws before any test
// runs, which is why no script has ever called POST /api/menu end to end. A bare `require` in an
// ES module falls through to the global object, so providing one here lets the import succeed.
// Only the import needs it: the POST path never calls unstable_cache.
;(globalThis as unknown as { require?: NodeRequire }).require = createRequire(import.meta.url)

import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import {
  MAX_PRICE_CENTS, MIN_PRICE_CENTS, PRICE_DECIMALS_MESSAGE, PRICE_NUMBER_MESSAGE, PRICE_RANGE_MESSAGE,
  parseInPersonPrice,
} from '../lib/menu/price'

const prisma = testPrisma()
const PFX = 'mprt-'
const MAIL = '@mprt.test'
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

/** The refused prices from the 2a spec, as they can arrive in a JSON body. */
const REFUSED_JSON: Array<[string, unknown]> = [
  ['0.99', 0.99],
  ['0', 0],
  ['-1', -1],
  ['"abc"', 'abc'],
  ['10000.01', 10000.01],
  ['1.234', 1.234],
  // NaN and Infinity cannot travel in JSON (JSON.stringify turns both into null), so a client
  // can only send them as strings or as null. Both must be refused.
  ['"NaN"', 'NaN'],
  ['"Infinity"', 'Infinity'],
  ['null (what NaN/Infinity become in JSON)', null],
]

/** The accepted prices from the 2a spec, with the value that must be stored. */
const ACCEPTED: Array<[string, unknown, number]> = [
  ['1.00', 1.0, 1],
  ['12.5', 12.5, 12.5],
  ['"12.50"', '12.50', 12.5],
  ['10000', 10000, 10000],
]

type Handler = (req: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>
let menuPOST: Handler
let menuPATCH: Handler
let requestsPOST: Handler

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
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

async function main() {
  console.log('\n══ MENU PRICE RULES (H5, Step 2a) ══')

  // ── [1] the rule itself ─────────────────────────────────────────────────────────────────────
  console.log('\n[1] parseInPersonPrice: $1.00–$10,000, at most 2 decimals')
  assert(MIN_PRICE_CENTS === 100 && MAX_PRICE_CENTS === 1_000_000, 'bounds are 100 and 1,000,000 cents')
  const pureRefused: Array<[string, unknown, string]> = [
    ['0.99', 0.99, PRICE_RANGE_MESSAGE],
    ['0', 0, PRICE_RANGE_MESSAGE],
    ['-1', -1, PRICE_RANGE_MESSAGE],
    ['"-1"', '-1', PRICE_RANGE_MESSAGE],
    ['NaN', NaN, PRICE_NUMBER_MESSAGE],
    ['Infinity', Infinity, PRICE_NUMBER_MESSAGE],
    ['-Infinity', -Infinity, PRICE_NUMBER_MESSAGE],
    ['"abc"', 'abc', PRICE_NUMBER_MESSAGE],
    ['10000.01', 10000.01, PRICE_RANGE_MESSAGE],
    ['1.234', 1.234, PRICE_DECIMALS_MESSAGE],
    ['"1.234"', '1.234', PRICE_NUMBER_MESSAGE],
    ['"1e3"', '1e3', PRICE_NUMBER_MESSAGE],
    ['" 12"', ' 12', PRICE_NUMBER_MESSAGE],
    ['""', '', PRICE_NUMBER_MESSAGE],
    ['true (Number(true) would be 1)', true, PRICE_NUMBER_MESSAGE],
    ['null (Number(null) would be 0)', null, PRICE_NUMBER_MESSAGE],
    ['undefined', undefined, PRICE_NUMBER_MESSAGE],
  ]
  for (const [label, input, message] of pureRefused) {
    const r = parseInPersonPrice(input)
    assert(!r.ok && r.message === message, `refused: ${label} → "${message}" (got ${JSON.stringify(r)})`)
  }
  const pureAccepted: Array<[string, unknown, number, number]> = [
    ['1.00', 1.0, 1, 100],
    ['12.5', 12.5, 12.5, 1250],
    ['"12.50"', '12.50', 12.5, 1250],
    ['10000', 10000, 10000, 1_000_000],
    ['1.29 (binary float: 1.29 * 100 = 128.99999999999997)', 1.29, 1.29, 129],
    ['0.1 + 0.2 + 1 (= 1.3000000000000003)', 0.1 + 0.2 + 1, 1.3, 130],
  ]
  for (const [label, input, value, cents] of pureAccepted) {
    const r = parseInPersonPrice(input)
    assert(r.ok && r.value === value && r.cents === cents, `accepted: ${label} → ${value} / ${cents}¢ (got ${JSON.stringify(r)})`)
  }

  // ── fixture ─────────────────────────────────────────────────────────────────────────────────
  menuPOST = (await import('../app/api/menu/route')).POST as unknown as Handler
  menuPATCH = (await import('../app/api/menu/[id]/route')).PATCH as unknown as Handler
  requestsPOST = (await import('../app/api/menu-requests/route')).POST as unknown as Handler
  await cleanup()

  const event = await prisma.event.create({
    data: {
      name: `${PFX}fair`, urlSlug: `${PFX}${rand()}`, status: 'ACTIVE',
      startDate: new Date(), endDate: new Date(Date.now() + 864e5),
    },
  })
  const vendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}booth`, slug: `${PFX}v-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const user = await prisma.user.create({
    data: { clerkId: `${PFX}u-${rand()}`, email: `${PFX}u-${rand()}${MAIL}`, name: 'Booth Owner', role: 'vendor' },
  })
  await prisma.vendorMember.create({
    data: { vendorId: vendor.id, userId: user.id, role: 'owner', approvalStatus: 'APPROVED' },
  })
  const existing = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}existing`, price: 8, category: 'Mains' },
  })
  login(user.clerkId)

  const itemCount = () => prisma.menuItem.count({ where: { vendorId: vendor.id } })
  const requestCount = () => prisma.menuRequest.count({ where: { vendorId: vendor.id } })
  const storedPrice = async () => (await prisma.menuItem.findUnique({ where: { id: existing.id }, select: { price: true } }))!.price

  const create = (price: unknown) =>
    menuPOST(jsonReq('/api/menu', 'POST', { vendorId: vendor.id, name: `${PFX}new-${rand()}`, price, category: 'Mains' }))
  const patch = (price: unknown) =>
    menuPATCH(jsonReq(`/api/menu/${existing.id}`, 'PATCH', { price }), { params: Promise.resolve({ id: existing.id }) })
  const requestAdd = (price: unknown) =>
    requestsPOST(jsonReq('/api/menu-requests', 'POST', { vendorId: vendor.id, type: 'ADD', name: `${PFX}req-${rand()}`, price, category: 'Mains' }))
  const requestEdit = (price: unknown) =>
    requestsPOST(jsonReq('/api/menu-requests', 'POST', { vendorId: vendor.id, type: 'EDIT', menuItemId: existing.id, price }))

  // ── [2] POST /api/menu ──────────────────────────────────────────────────────────────────────
  console.log('\n[2] POST /api/menu refuses every bad price and creates nothing')
  {
    const before = await itemCount()
    for (const [label, price] of REFUSED_JSON) {
      const res = await create(price)
      const b = await bodyOf(res)
      assert(res.status === 400 && b?.error?.code === 'VALIDATION_ERROR', `${label}: 400 VALIDATION_ERROR (got ${res.status} ${b?.error?.code})`)
    }
    assert(await itemCount() === before, `no item was created by any refused price (count ${before} → ${await itemCount()})`)
    // Since H5 Fix B a brand-new item waits for approval: accepted is 202, not 201.
    const ok = await create(12.5)
    assert(ok.status === 202, `[0] positive control: the same request with 12.5 is accepted for approval, 202 (got ${ok.status})`)
  }

  // ── [3] PATCH /api/menu/[id] ────────────────────────────────────────────────────────────────
  console.log('\n[3] PATCH /api/menu/[id] refuses every bad price and leaves the stored price alone')
  {
    await prisma.menuItem.update({ where: { id: existing.id }, data: { price: 8 } })
    for (const [label, price] of REFUSED_JSON) {
      const res = await patch(price)
      const b = await bodyOf(res)
      assert(res.status === 400 && b?.error?.code === 'VALIDATION_ERROR', `${label}: 400 VALIDATION_ERROR (got ${res.status} ${b?.error?.code})`)
    }
    assert(await storedPrice() === 8, `the stored price is still 8 after every refused PATCH (got ${await storedPrice()})`)
    const ok = await patch(9.5)
    assert(ok.status === 200 && await storedPrice() === 9.5, `[0] positive control: PATCH 9.5 is applied (got ${ok.status}, price ${await storedPrice()})`)
    // A PATCH without a price must still work and keep the stored price.
    const noPrice = await menuPATCH(jsonReq(`/api/menu/${existing.id}`, 'PATCH', { description: 'x' }), { params: Promise.resolve({ id: existing.id }) })
    assert(noPrice.status === 200 && await storedPrice() === 9.5, `a PATCH that leaves price out keeps the stored price (got ${noPrice.status}, price ${await storedPrice()})`)
  }

  // ── [4] POST /api/menu-requests ─────────────────────────────────────────────────────────────
  console.log('\n[4] POST /api/menu-requests refuses every bad price, for ADD and EDIT, and writes no request')
  {
    const before = await requestCount()
    for (const [label, price] of REFUSED_JSON) {
      const add = await requestAdd(price)
      const ab = await bodyOf(add)
      assert(add.status === 400 && ab?.error?.code === 'VALIDATION_ERROR', `ADD ${label}: 400 VALIDATION_ERROR (got ${add.status} ${ab?.error?.code})`)
      const edit = await requestEdit(price)
      const eb = await bodyOf(edit)
      assert(edit.status === 400 && eb?.error?.code === 'VALIDATION_ERROR', `EDIT ${label}: 400 VALIDATION_ERROR (got ${edit.status} ${eb?.error?.code})`)
    }
    assert(await requestCount() === before, `no request row was written by any refused price (count ${before} → ${await requestCount()})`)
    const okAdd = await requestAdd(12.5)
    const okEdit = await requestEdit(12.5)
    assert(okAdd.status < 300 && okEdit.status < 300, `[0] positive control: ADD and EDIT with 12.5 are accepted (got ${okAdd.status}, ${okEdit.status})`)
  }

  // ── [5] accepted prices, stored as parsed ───────────────────────────────────────────────────
  console.log('\n[5] accepted prices land on every path, stored as the parsed value')
  for (const [label, price, stored] of ACCEPTED) {
    // A brand-new item through POST /api/menu waits for approval (H5 Fix B): 202, and the pending
    // request stores the parsed price.
    const c = await create(price)
    const cb = await bodyOf(c)
    const pending = cb?.data?.request as { price?: number; status?: string } | undefined
    assert(c.status === 202 && pending?.status === 'PENDING' && pending?.price === stored,
      `POST /api/menu ${label}: 202, request stored ${stored} (got ${c.status}, ${pending?.price})`)

    const p = await patch(price)
    assert(p.status === 200 && await storedPrice() === stored, `PATCH ${label}: 200, stored ${stored} (got ${p.status}, ${await storedPrice()})`)

    const name = `${PFX}acc-${rand()}`
    const r = await requestsPOST(jsonReq('/api/menu-requests', 'POST', { vendorId: vendor.id, type: 'ADD', name, price, category: 'Mains' }))
    const row = await prisma.menuRequest.findFirst({ where: { vendorId: vendor.id, name }, select: { price: true } })
    assert(r.status < 300 && row?.price === stored, `menu request ADD ${label}: accepted, stored ${stored} (got ${r.status}, ${row?.price})`)
  }

  // ── [6] source: no raw Number(price) left on a write path ───────────────────────────────────
  console.log('\n[6] source: every write path uses the shared rule, none stores a raw Number(price)')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const files = ['app/api/menu/route.ts', 'app/api/menu/[id]/route.ts', 'lib/menu-requests/validate-item.ts']
  for (const f of files) {
    const src = strip(readSource(f))
    // POST /api/menu runs the shared per-item validator since H5 Fix B, which is where the rule lives.
    const usesRule = f === 'app/api/menu/route.ts' ? /validateMenuRequestItem\(/.test(src) : /parseInPersonPrice\(/.test(src)
    assert(usesRule, `${f}: ${f === 'app/api/menu/route.ts' ? 'calls validateMenuRequestItem (which applies parseInPersonPrice)' : 'calls parseInPersonPrice'}`)
    assert(!/Number\(price\)/.test(src), `${f}: no Number(price) left`)
  }
  assert(/Number\(price\)/.test('price: Number(price),'), '[0] control: the Number(price) scan does match the old form')
}

main()
  .catch(e => { fail++; console.error(e) })
  .finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup failed', e) }
    await prisma.$disconnect()
    console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  })
