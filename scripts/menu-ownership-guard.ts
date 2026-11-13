/**
 * MENU OWNERSHIP AND EDIT GATE — audit C1 and H4.
 *
 * C1: any signed-in user could reprice or delete any vendor's menu item, because PATCH/DELETE
 *     /api/menu/[id] only asked "is this person a vendor anywhere".
 * H4: a menu request could name another vendor's item, and approval then wrote to it.
 *
 * Two halves:
 *   BEHAVIOURAL — the access helpers the routes call, run against the test database, each with a
 *     positive control so a helper that refuses everyone cannot pass.
 *   STATIC — the routes themselves, read as source, to prove each write path calls those helpers
 *     before its first write. The routes need a Clerk session, which this harness doesn't have,
 *     so the logic lives in the helpers and the wiring is proven here.
 *
 * ⚠️ WRITES TO A DATABASE. Run it through the wrapper, which is the only thing that makes the
 * connection non-production:
 *
 *   npm run test:db:up
 *   ./scripts/with-test-db.sh npx tsx scripts/menu-ownership-guard.ts
 *
 * It refuses to run unless the app `db` singleton is provably the test database.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { db } from '../lib/db'
import { testPrisma } from '../lib/test-db'
import { resolveOwnedMenuItem, requireVendorMayEditMenu } from '../lib/auth'
import { ApiError } from '../lib/api-error'
import { menuEditRefusal } from '../lib/vendor-operator-state'
import {
  checkMenuRequestItemOwnership,
  menuRequestTargetsOwnItem,
} from '../lib/menu-requests/item-ownership'

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

const TAG = `mog-${Date.now()}`

/**
 * Same identity proof as scripts/vendor-accept-verb-test.ts: write a marker through testPrisma()
 * (guaranteed non-production by lib/test-db), read it back through the app singleton the helpers
 * use. Different databases → the read misses → refuse before any test write.
 */
async function assertSingletonIsTheTestDatabase(): Promise<void> {
  const probe = testPrisma()
  try {
    const marker = await probe.event.create({
      data: {
        name: `${TAG} identity probe`,
        urlSlug: `${TAG}-identity-probe`,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    })
    const seen = await db.event.findUnique({ where: { id: marker.id }, select: { id: true } })
    await probe.event.delete({ where: { id: marker.id } })
    if (!seen) {
      console.error(
        '\n🛑 REFUSING: the app `db` singleton is NOT the test database.\n' +
        '   Run:  ./scripts/with-test-db.sh npx tsx scripts/menu-ownership-guard.ts\n',
      )
      process.exit(1)
    }
    console.log('  (verified: the app singleton and TEST_DATABASE_URL are the same database)')
  } finally {
    await probe.$disconnect()
  }
}

type Outcome = { ok: boolean; status?: number; code?: string; message?: string }

async function outcomeOf(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn()
    return { ok: true }
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, status: err.statusCode, code: err.code, message: err.message }
    throw err
  }
}

/** Drops comment lines and block comments, so a comment can't satisfy a source assertion. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The source of one exported handler: from `export async function NAME` to the next export or EOF. */
function handlerSource(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  if (start === -1) return ''
  const next = src.indexOf('export async function ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

/** Index of the first DB write in a handler, or -1. */
function firstWrite(body: string): number {
  const hits = [/db\.menuItem\.(update|create|delete|updateMany|deleteMany)\(/, /db\.\$transaction\(/, /db\.menuRequest\.(create|update)\(/]
    .map(re => body.search(re))
    .filter(i => i >= 0)
  return hits.length ? Math.min(...hits) : -1
}

async function main() {
  console.log('\n══ MENU OWNERSHIP AND EDIT GATE (C1, H4) ══\n')
  await assertSingletonIsTheTestDatabase()

  const event = await db.event.create({
    data: {
      name: `${TAG} fair`,
      urlSlug: `${TAG}-fair`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86_400_000),
    },
  })

  type BoothStatus = 'PENDING' | 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'REJECTED'
  type MemberStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

  const mkVendor = (name: string, status: BoothStatus) =>
    db.vendor.create({
      data: { eventId: event.id, name: `${TAG} ${name}`, slug: `${TAG}-${name}`, cuisineType: 'test', status },
    })
  const mkUser = (who: string) =>
    db.user.create({ data: { clerkId: `${TAG}-${who}`, email: `${TAG}-${who}@example.test` } })
  const mkMember = (userId: string, vendorId: string, approvalStatus: MemberStatus) =>
    db.vendorMember.create({
      data: {
        userId, vendorId, role: 'owner', approvalStatus,
        rejectionReason: approvalStatus === 'REJECTED' ? 'test rejection' : null,
      },
    })
  const mkItem = (vendorId: string, name: string, removed = false) =>
    db.menuItem.create({
      data: { vendorId, name: `${TAG} ${name}`, price: 8, category: 'Mains', ...(removed && { removedAt: new Date() }) },
    })

  // Two booths at the same fair, one operator each.
  const vendorA = await mkVendor('vendor-a', 'ACTIVE')
  const vendorB = await mkVendor('vendor-b', 'ACTIVE')
  const userA = await mkUser('user-a')
  const userB = await mkUser('user-b')
  await mkMember(userA.id, vendorA.id, 'APPROVED')
  await mkMember(userB.id, vendorB.id, 'APPROVED')

  const itemA = await mkItem(vendorA.id, 'a-on-menu')
  const itemARemoved = await mkItem(vendorA.id, 'a-removed', true)
  const itemB = await mkItem(vendorB.id, 'b-on-menu')
  const MISSING_ID = `${TAG}-no-such-item`

  // ── [1] resolveOwnedMenuItem — C1 ─────────────────────────────────────────────────────────
  console.log('\n[1] a menu item resolves only for its own vendor (C1)')
  const itemBBefore = await db.menuItem.findUnique({ where: { id: itemB.id } })

  const own = await resolveOwnedMenuItem(userA.id, itemA.id).catch(() => null)
  assert(own !== null && own.vendorId === vendorA.id,
    'positive control: vendor A resolves its own item')

  const foreign = await outcomeOf(() => resolveOwnedMenuItem(userA.id, itemB.id))
  assert(!foreign.ok && foreign.status === 404 && foreign.code === 'NOT_FOUND',
    `vendor A on vendor B's item gets 404 NOT_FOUND (got ${foreign.status ?? 'ALLOWED'} ${foreign.code ?? ''})`)

  const missing = await outcomeOf(() => resolveOwnedMenuItem(userA.id, MISSING_ID))
  assert(!missing.ok && missing.status === foreign.status && missing.code === foreign.code && missing.message === foreign.message,
    'a missing item gets the IDENTICAL status, code and message, so item ids cannot be probed')

  const itemBAfter = await db.menuItem.findUnique({ where: { id: itemB.id } })
  assert(JSON.stringify(itemBBefore) === JSON.stringify(itemBAfter), "vendor B's row is unchanged")

  // ── [2] requireVendorMayEditMenu — the full matrix ────────────────────────────────────────
  console.log('\n[2] who may edit a menu: booth status × operator status')
  const booths: BoothStatus[] = ['PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'REJECTED']
  const members: MemberStatus[] = ['PENDING', 'APPROVED', 'REJECTED']
  for (const booth of booths) {
    for (const member of members) {
      const v = await mkVendor(`gate-${booth}-${member}`.toLowerCase(), booth)
      const u = await mkUser(`gate-${booth}-${member}`.toLowerCase())
      await mkMember(u.id, v.id, member)
      const r = await outcomeOf(() => requireVendorMayEditMenu(u.id, v.id))
      const expectOk = (booth === 'PENDING' || booth === 'ACTIVE') && (member === 'PENDING' || member === 'APPROVED')
      if (expectOk) {
        assert(r.ok, `booth ${booth} + operator ${member} is ALLOWED (positive control)`)
      } else {
        assert(!r.ok && r.status === 403 && r.code === 'VENDOR_MENU_EDIT_BLOCKED' && !!r.message,
          `booth ${booth} + operator ${member} is refused 403 VENDOR_MENU_EDIT_BLOCKED with a message (got ${r.status ?? 'ALLOWED'} ${r.code ?? ''})`)
      }
    }
  }
  const stranger = await mkUser('stranger')
  const strangerR = await outcomeOf(() => requireVendorMayEditMenu(stranger.id, vendorA.id))
  assert(!strangerR.ok && strangerR.status === 403 && strangerR.code === 'FORBIDDEN',
    `no membership fails closed with 403 FORBIDDEN (got ${strangerR.status ?? 'ALLOWED'} ${strangerR.code ?? ''})`)

  // ── [3] checkMenuRequestItemOwnership — H4 at filing time ─────────────────────────────────
  console.log('\n[3] a menu request may only name the vendor\'s own items (H4)')
  const check = (inputs: Parameters<typeof checkMenuRequestItemOwnership>[1]) =>
    checkMenuRequestItemOwnership(vendorA.id, inputs)

  assert(await check([
    { type: 'EDIT', menuItemId: itemA.id },
    { type: 'DELETE', menuItemId: itemA.id },
    { type: 'RESTORE', menuItemId: itemARemoved.id },
  ]) === null, 'positive control: own EDIT, DELETE and RESTORE (right removed state) pass')
  assert(await check([{ type: 'ADD' }]) === null, 'an ADD with no item id passes')

  const editForeign = await check([{ type: 'EDIT', menuItemId: itemB.id }])
  assert(editForeign?.status === 404 && editForeign.code === 'NOT_FOUND' && editForeign.index === 0,
    `EDIT naming vendor B's item is refused 404 at index 0 (got ${JSON.stringify(editForeign)})`)

  const editMissing = await check([{ type: 'EDIT', menuItemId: MISSING_ID }])
  assert(editMissing?.status === 404 && editMissing.message === editForeign?.message,
    'a missing item id gets the same 404 message as a foreign one')

  const batch = await check([
    { type: 'ADD' },
    { type: 'EDIT', menuItemId: itemA.id },
    { type: 'DELETE', menuItemId: itemB.id },
  ])
  assert(batch?.status === 404 && batch.index === 2,
    `in a batch, the foreign 3rd item is named by position (index 2) (got ${JSON.stringify(batch)})`)

  const deleteRemoved = await check([{ type: 'DELETE', menuItemId: itemARemoved.id }])
  assert(deleteRemoved?.status === 409 && deleteRemoved.code === 'CONFLICT',
    `DELETE of an already-removed item is 409 (got ${JSON.stringify(deleteRemoved)})`)

  const restoreOnMenu = await check([{ type: 'RESTORE', menuItemId: itemA.id }])
  assert(restoreOnMenu?.status === 409 && restoreOnMenu.code === 'CONFLICT',
    `RESTORE of an item still on the menu is 409 (got ${JSON.stringify(restoreOnMenu)})`)

  const nonString = await check([{ type: 'EDIT', menuItemId: 12345 }])
  assert(nonString?.status === 404, `a non-string item id is 404 (got ${JSON.stringify(nonString)})`)

  const addForeign = await check([{ type: 'ADD', menuItemId: itemB.id }])
  assert(addForeign?.status === 404,
    `an ADD carrying vendor B's item id is 404 (got ${JSON.stringify(addForeign)})`)

  // ── [4] menuRequestTargetsOwnItem — H4 at approval time ───────────────────────────────────
  console.log('\n[4] approval re-checks the item belongs to the request\'s vendor (H4)')
  assert(await menuRequestTargetsOwnItem(itemA.id, vendorA.id) === true,
    'positive control: a matching item passes')
  assert(await menuRequestTargetsOwnItem(MISSING_ID, vendorA.id) === false, 'a missing item fails')

  // A row written straight to the database, the way a request filed before the filing check
  // existed could look: vendor A's request naming vendor B's item.
  const forged = await db.menuRequest.create({
    data: { vendorId: vendorA.id, requestedBy: userA.id, type: 'EDIT', menuItemId: itemB.id, name: `${TAG} forged` },
  })
  assert(await menuRequestTargetsOwnItem(forged.menuItemId!, forged.vendorId) === false,
    'a forged request naming another vendor\'s item fails, so approval answers 422 and applies nothing')

  // ── [5] menuEditRefusal — pure ────────────────────────────────────────────────────────────
  console.log('\n[5] the shared refusal wording, cell by cell')
  for (const booth of booths) {
    for (const member of members) {
      const r = menuEditRefusal(booth, member)
      const expectOk = (booth === 'PENDING' || booth === 'ACTIVE') && (member === 'PENDING' || member === 'APPROVED')
      assert(expectOk ? r === null : (r !== null && r.code === 'VENDOR_MENU_EDIT_BLOCKED' && r.message.length > 0),
        `menuEditRefusal(${booth}, ${member}) → ${expectOk ? 'allowed' : 'refused'}`)
    }
  }
  assert(menuEditRefusal('ACTIVE', 'SOMETHING_NEW') !== null, 'an unknown operator status fails closed')
  assert(menuEditRefusal('SOMETHING_NEW', 'APPROVED') !== null, 'an unknown booth status fails closed')

  // ── [6] static wiring — the routes use the helpers ────────────────────────────────────────
  console.log('\n[6] every menu write path calls the ownership and edit checks before writing')

  // [0] controls: the scanners actually detect what they claim to.
  assert(stripComments('// requireVendorMayEditMenu(x)\nfoo()').includes('requireVendorMayEditMenu') === false,
    '[0] control: a commented-out call is not counted')
  assert(firstWrite('a; db.menuItem.update(x)') === 3, '[0] control: the write scanner finds a write')

  const menuIdSrc = stripComments(readFileSync('app/api/menu/[id]/route.ts', 'utf8'))
  const menuSrc = stripComments(readFileSync('app/api/menu/route.ts', 'utf8'))
  const availSrc = stripComments(readFileSync('app/api/menu-items/[id]/availability/route.ts', 'utf8'))
  const reqSrc = stripComments(readFileSync('app/api/menu-requests/route.ts', 'utf8'))
  // The approval logic is shared by the organizer and admin routes since H5 2g.
  const approvalSrc = stripComments(readFileSync('lib/menu-requests/apply-decision.ts', 'utf8'))

  const writePaths: Array<[string, string, string[]]> = [
    ['PATCH /api/menu/[id]', handlerSource(menuIdSrc, 'PATCH'), ['requireVendorMenuItemAccess(', 'requireVendorMayEditMenu(']],
    ['DELETE /api/menu/[id]', handlerSource(menuIdSrc, 'DELETE'), ['requireVendorMenuItemAccess(', 'requireVendorMayEditMenu(']],
    ['POST /api/menu', handlerSource(menuSrc, 'POST'), ['getVendorAuth(', 'requireVendorMayEditMenu(']],
    ['PATCH availability', handlerSource(availSrc, 'PATCH'), ['requireVendorMenuItemAccess(', 'requireVendorMayEditMenu(']],
    ['POST /api/menu-requests', handlerSource(reqSrc, 'POST'), ['requireVendorMayEditMenu(', 'checkMenuRequestItemOwnership(']],
  ]
  for (const [label, body, gates] of writePaths) {
    const w = firstWrite(body)
    assert(body.length > 0 && w > 0, `${label}: handler found and has a write (positive control)`)
    for (const gate of gates) {
      const g = body.indexOf(gate)
      assert(g >= 0 && g < w, `${label}: ${gate.replace('(', '')} runs before the first write`)
    }
  }

  assert(!/requireVendorAuth/.test(menuIdSrc), '/api/menu/[id] no longer authorises with requireVendorAuth')
  assert(!/menuItem\.delete\(/.test(menuIdSrc), 'DELETE /api/menu/[id] no longer hard-deletes')
  assert(/data: \{ removedAt: new Date\(\) \}/.test(handlerSource(menuIdSrc, 'DELETE')), 'DELETE /api/menu/[id] soft-removes')
  assert(!/showAll/.test(menuSrc), '/api/menu no longer reads showAll')

  const approveIdx = approvalSrc.indexOf('menuRequestTargetsOwnItem(')
  const switchIdx = approvalSrc.indexOf('switch (requestType)')
  assert(approveIdx >= 0 && switchIdx > 0 && approveIdx < switchIdx,
    'the approval route re-checks item ownership before applying the change')

  // ── [7] non-member answers on /api/menu-requests are 404, not 403 ─────────────────────────
  console.log('\n[7] /api/menu-requests answers a non-member with 404, not 403')
  const reqPost = handlerSource(reqSrc, 'POST')
  const reqGet = handlerSource(reqSrc, 'GET')
  const vendorBranch = reqGet.slice(reqGet.indexOf('if (vendorId)'), reqGet.indexOf('if (eventId)'))
  const eventBranch = reqGet.slice(reqGet.indexOf('if (eventId)'))

  assert(vendorBranch.length > 0 && eventBranch.length > 0, '[0] control: both GET branches found')
  assert(/apiError\('Vendor not found', 404, 'NOT_FOUND'\)/.test(reqPost) && !/FORBIDDEN/.test(reqPost),
    'POST: a non-member of the vendor gets 404 "Vendor not found", and nothing in POST answers 403')
  assert(/apiError\('Vendor not found', 404, 'NOT_FOUND'\)/.test(vendorBranch) && !/FORBIDDEN/.test(vendorBranch),
    'GET ?vendorId=: a non-member gets 404 "Vendor not found", not 403')

  // The organizer branch: a missing fair and a fair the caller doesn't organize must give the
  // same answer, so the non-member line must be the SAME 404 as the missing-fair line.
  const eventNotFound = eventBranch.match(/apiError\('Event not found', 404, 'NOT_FOUND'\)/g) ?? []
  const orgCheck = eventBranch.indexOf('db.orgMember.findFirst(')
  const afterOrgCheck = orgCheck >= 0 ? eventBranch.slice(orgCheck) : ''
  assert(orgCheck > 0, '[0] control: the organizer membership check is present in the ?eventId= branch')
  assert(eventNotFound.length >= 2 && /if \(!isOrg\) return apiError\('Event not found', 404, 'NOT_FOUND'\)/.test(afterOrgCheck),
    'GET ?eventId=: a signed-in non-organizer gets the same 404 "Event not found" as a missing fair')
  assert(!/FORBIDDEN|'Access denied'/.test(eventBranch),
    'GET ?eventId=: nothing in the organizer branch answers 403 "Access denied"')

  // ── Cleanup ───────────────────────────────────────────────────────────────────────────────
  // Event → Vendor → VendorMember / MenuItem / MenuRequest all cascade. Users don't; drop by tag.
  await db.event.delete({ where: { id: event.id } })
  await db.user.deleteMany({ where: { clerkId: { startsWith: TAG } } })

  console.log(`\n${'─'.repeat(70)}\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
