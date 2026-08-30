/**
 * MENU-ITEM REMOVAL GUARD — the feature, and the four sites that must all apply the filter.
 *
 * THE RISK THIS EXISTS FOR is silent UNDER-APPLICATION: landing the removal write but missing
 * one read, so a removed item stays visible on exactly one surface and nobody notices until a
 * customer orders a ghost. Four filter sites therefore get four SEPARATE assertions, each red
 * on its own if that specific site is unfiltered:
 *      A  getGroupedMenuItems byVendor   (lib/menu/getGroupedMenuItems.ts, `{ vendorId, ...ON_MENU }`)
 *      B  getGroupedMenuItems byEvent    (same file, `{ vendorId: { in: vendorIds }, ...ON_MENU }`)
 *      C  checkout                       (app/api/orders/route.ts — ITEM_REMOVED)
 *      D  vendor readiness count         (same file, `{ isAvailable: true, ...ON_MENU }`)
 * Four sites, four pins, or the one you forget is the one that ships.
 *
 * PREDICATE PARITY for A and B. getGroupedMenuItems reaches next/cache through require(), so it
 * cannot be imported into an ESM script — the constraint p2-archived-visibility-test.ts
 * documents. Each is therefore proven in two halves: run the EXACT where-clause against real
 * rows, AND assert the clause is present in the query object in source. The source half is the
 * fragile one, so its regex is anchored to the whole `where: { … }` expression rather than
 * grepping for the word "removedAt" — which a comment would satisfy — and carries a control
 * proving it fails when the spread is deleted from that specific line.
 *
 * ⚠️ MenuItem carries vendorId but NO eventId, so it is in the prod-write-guard blind spot
 * (lib/prod-write-guard.ts documents the gap). This suite MUST run on the test database.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-item-removal-guard.ts
 * Self-cleaning, prefix mirm-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { IS_REMOVED, ON_MENU, SELLABLE } from '../lib/menu/on-menu'

const prisma = testPrisma()

const PFX = 'mirm-'
const MAIL = '@mirm.test'
const rand = () => Math.random().toString(36).slice(2, 9)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const evs = await prisma.event.findMany({ where: { urlSlug: { startsWith: PFX } }, select: { id: true } })
  const ids = evs.map(e => e.id)
  if (ids.length) {
    const vs = await prisma.vendor.findMany({ where: { eventId: { in: ids } }, select: { id: true } })
    const vids = vs.map(v => v.id)
    await prisma.orderItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.menuRequest.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.favoriteItem.deleteMany({ where: { menuItem: { vendorId: { in: vids } } } })
    await prisma.menuItem.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendorMember.deleteMany({ where: { vendorId: { in: vids } } })
    await prisma.vendor.deleteMany({ where: { eventId: { in: ids } } })
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** The removal write, exactly as the approval route performs it. */
const remove  = (id: string) => prisma.menuItem.update({ where: { id }, data: { removedAt: new Date() } })
const restore = (id: string) => prisma.menuItem.update({ where: { id }, data: { removedAt: null } })

async function main() {
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
  const customer = await prisma.user.create({
    data: { clerkId: `${PFX}c-${rand()}`, email: `${PFX}c-${rand()}${MAIL}`, name: 'Customer', role: 'customer' },
  })
  const mk = (name: string, over: Record<string, unknown> = {}) => prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}${name}`, price: 5, category: 'Mains', ...over },
  })

  // ── [1] ORDER SURVIVAL — the load-bearing control ──────────────────────────────────────
  console.log('\n[1] an ordered item survives removal, and its order still resolves')
  const ordered = await mk('ordered')
  const order = await prisma.order.create({
    data: {
      eventId: event.id, customerId: customer.id, vendorId: vendor.id,
      subtotal: 5, total: 5.5, fairSynqFee: 0.5, vendorPayout: 5,
      customerName: 'Test Customer', customerPhone: '5550000000',
    },
  })
  await prisma.orderItem.create({
    data: {
      orderId: order.id, vendorId: vendor.id, menuItemId: ordered.id, itemName: ordered.name,
      quantity: 1, unitPrice: 5, totalPrice: 5, subtotal: 5,
    },
  })

  await remove(ordered.id)

  const resolved = await prisma.orderItem.findFirst({
    where: { orderId: order.id },
    include: { menuItem: { select: { id: true, name: true, price: true, removedAt: true } } },
  })
  assert(resolved?.itemName === ordered.name, 'the order still shows its item name')
  assert(resolved?.unitPrice === 5, 'the order still shows its unit price')
  assert(resolved?.menuItem?.id === ordered.id, 'the menuItem JOIN still resolves — the row was not destroyed')
  assert(resolved?.menuItem?.removedAt !== null, 'and that item reads as removed')

  // [0] NEGATIVE CONTROL: the hard delete the design deliberately does NOT do. Postgres must
  // refuse it, which is what makes the soft path load-bearing rather than ceremony.
  let hardBlocked = false
  try { await prisma.menuItem.delete({ where: { id: ordered.id } }) } catch { hardBlocked = true }
  assert(hardBlocked,
    '[0] control: a HARD delete of the same item is refused by the FK — the soft path is doing real work')

  // ── [2] DISCRIMINATION — never-ordered takes the SAME soft path ────────────────────────
  console.log('\n[2] a never-ordered item is soft-removed too — the row survives, visibility does not')
  const neverOrdered = await mk('neverordered')
  await remove(neverOrdered.id)
  const stillThere = await prisma.menuItem.findUnique({ where: { id: neverOrdered.id } })
  assert(stillThere !== null, 'the never-ordered item row STILL EXISTS (no hard-delete carve-out)')
  assert(stillThere?.removedAt !== null, 'and it is marked removed')

  const visibleNow = await prisma.menuItem.findMany({
    where: { vendorId: vendor.id, ...ON_MENU }, select: { id: true },
  })
  const visibleIds = new Set(visibleNow.map(v => v.id))
  assert(!visibleIds.has(ordered.id) && !visibleIds.has(neverOrdered.id),
    'BOTH removed items are equally invisible — discrimination is read visibility, not row existence')

  // ── [3] THREE STATES NEVER COLLAPSE ────────────────────────────────────────────────────
  console.log('\n[3] available / sold out / removed stay three different things')
  const available = await mk('available')
  const soldOut = await mk('soldout', { isAvailable: false })

  const onMenu = await prisma.menuItem.findMany({
    where: { vendorId: vendor.id, ...ON_MENU }, select: { id: true, isAvailable: true },
  })
  const onMenuIds = new Set(onMenu.map(m => m.id))
  assert(onMenuIds.has(available.id),
    '[0] positive control: a plain available item IS on the menu (the filter is not hiding everything)')
  assert(onMenuIds.has(soldOut.id),
    'a SOLD-OUT item is STILL on the menu — it renders unavailable, it is not removed')
  assert(onMenu.find(m => m.id === soldOut.id)?.isAvailable === false,
    'and it is still reported as unavailable, so the storefront can grey it')
  assert(!onMenuIds.has(neverOrdered.id), 'the removed item is not on the menu')

  // ── SITE A / SITE B — predicate parity for the two cached reads ────────────────────────
  console.log('\n[A/B] the two getGroupedMenuItems reads each apply the filter')
  const src = readFileSync('lib/menu/getGroupedMenuItems.ts', 'utf8')
  const SITE_A = /where:\s*\{\s*vendorId,\s*\.\.\.ON_MENU\s*\}/
  const SITE_B = /where:\s*\{\s*vendorId:\s*\{\s*in:\s*vendorIds\s*\}\s*,\s*\.\.\.ON_MENU\s*\}/

  // [0] The source scanners are the fragile half — anchored to the whole where-expression, so a
  // stray mention of removedAt in a COMMENT cannot satisfy them. Proven before they are trusted.
  assert(SITE_A.test('    where: { vendorId, ...ON_MENU },'), '[0] site-A scanner matches the real clause')
  assert(!SITE_A.test('    where: { vendorId },'), '[0] site-A scanner REJECTS the unfiltered clause')
  assert(!SITE_A.test('// removedAt: null is applied below'), '[0] site-A scanner ignores a comment')
  assert(SITE_B.test('    where: { vendorId: { in: vendorIds }, ...ON_MENU },'), '[0] site-B scanner matches the real clause')
  assert(!SITE_B.test('    where: { vendorId: { in: vendorIds } },'), '[0] site-B scanner REJECTS the unfiltered clause')

  assert(SITE_A.test(src), 'SITE A (byVendor) applies ...ON_MENU in its where clause')
  assert(SITE_B.test(src), 'SITE B (byEvent) applies ...ON_MENU in its where clause')
  assert((src.match(/\.\.\.ON_MENU/g) ?? []).length === 2,
    'exactly TWO applications — both reads filtered, neither duplicated into a third copy')

  // The behavioural half of B: the event-scoped predicate excludes removed items too.
  const byEventNow = await prisma.menuItem.findMany({
    where: { vendorId: { in: [vendor.id] }, ...ON_MENU }, select: { id: true },
  })
  assert(!byEventNow.some(m => m.id === neverOrdered.id), 'SITE B behaviourally excludes the removed item')

  // ── [4] / SITE C — CHECKOUT FAILS CLOSED ───────────────────────────────────────────────
  console.log('\n[4] checkout refuses a cart naming a removed item')
  const ordersSrc = readFileSync('app/api/orders/route.ts', 'utf8')
  assert(/if \(mi\.removedAt !== null\)/.test(ordersSrc), 'SITE C: the cart loop checks removedAt')
  assert(/'ITEM_REMOVED'/.test(ordersSrc), 'and answers with its own code, distinct from ITEM_UNAVAILABLE')
  assert(ordersSrc.indexOf('ITEM_REMOVED') < ordersSrc.indexOf("'ITEM_UNAVAILABLE'"),
    'removed is checked BEFORE sold-out — a removed item must not be reported as temporarily unavailable')

  // Behavioural: the route resolves the row (unfiltered lookup) so it can name the item.
  const cartLookup = await prisma.menuItem.findMany({
    where: { id: { in: [neverOrdered.id] } }, select: { id: true, name: true, removedAt: true },
  })
  assert(cartLookup.length === 1 && cartLookup[0].removedAt !== null,
    'the cart lookup still RESOLVES a removed item, so the error can name it rather than 404')
  // [0] control: a normal item is not flagged — else "reject everything" would pass.
  const okLookup = await prisma.menuItem.findFirst({ where: { id: available.id } })
  assert(okLookup?.removedAt === null, '[0] positive control: an on-menu item is NOT flagged removed')

  // ── [5] / SITE D — THE READINESS COUPLING ──────────────────────────────────────────────
  // Removing a vendor's LAST available item takes them offline. Asserted here because it is a
  // state change hiding inside a delete, and would otherwise surface as a support ticket.
  console.log('\n[5] removing the last available item flips the vendor offline; restoring flips it back')
  assert(/where: SELLABLE/.test(ordersSrc),
    'SITE D: the readiness count uses SELLABLE (on the menu AND available)')

  // ── SITE D IS SIX SITES, NOT ONE ───────────────────────────────────────────────────────
  // "Does this vendor have anything to sell" was written by hand in six places, and step 2
  // filtered exactly one of them — so a vendor who removed their last item stayed "ready"
  // everywhere except the order route: on the storefront, with nothing to sell. This is the
  // class check that keeps the six from drifting again: no readiness count may spell the
  // predicate out by hand.
  const READINESS_FILES = [
    'lib/vendor-readiness.ts',
    'lib/fair-vendors.ts',
    'app/api/vendors/route.ts',
    'app/api/vendors/[id]/route.ts',
    'app/api/vendors/[id]/menu/route.ts',
    'app/api/orders/route.ts',
  ]
  const BARE = /menuItems:\s*\{\s*(some|where):\s*\{\s*isAvailable:\s*true\s*\}\s*\}|where:\s*\{\s*isAvailable:\s*true\s*\}/
  assert(BARE.test('  menuItems: { some: { isAvailable: true } },'),
    '[0] positive control: the scanner DOES flag a bare isAvailable readiness filter')
  assert(!BARE.test('  menuItems: { some: SELLABLE },'),
    '[0] baseline: the scanner does NOT flag the shared predicate')
  for (const f of READINESS_FILES) {
    const s = readFileSync(f, 'utf8')
    assert(!BARE.test(s), `${f}: no hand-written isAvailable readiness filter — uses SELLABLE`)
    assert(/SELLABLE/.test(s), `${f}: imports and uses the shared SELLABLE predicate`)
  }

  const soloVendor = await prisma.vendor.create({
    data: { eventId: event.id, name: `${PFX}solo`, slug: `${PFX}s-${rand()}`, cuisineType: 'Test', status: 'ACTIVE' },
  })
  const onlyItem = await prisma.menuItem.create({
    data: { vendorId: soloVendor.id, name: `${PFX}only`, price: 3, category: 'Mains', isAvailable: true },
  })
  const countFor = async () => (await prisma.vendor.findUnique({
    where: { id: soloVendor.id },
    include: { _count: { select: { menuItems: { where: SELLABLE } } } },
  }))!._count.menuItems

  assert(await countFor() === 1, '[0] positive control: the vendor starts with 1 live item (ready)')
  await remove(onlyItem.id)
  assert(await countFor() === 0, 'removing the last live item drops the count to 0 — the vendor goes OFFLINE')
  await restore(onlyItem.id)
  assert(await countFor() === 1, 'restoring brings it back to 1 — the vendor returns, so removal is reversible end-to-end')

  // [0] control on the coupling: an UNFILTERED count would NOT have moved. This is what proves
  // site D is doing the work rather than the count changing for some other reason.
  await remove(onlyItem.id)
  const unfiltered = (await prisma.vendor.findUnique({
    where: { id: soloVendor.id },
    include: { _count: { select: { menuItems: { where: { isAvailable: true } } } } },
  }))!._count.menuItems
  assert(unfiltered === 1,
    '[0] control: WITHOUT the removedAt filter the count stays 1 — so the flip above is site D, not a coincidence')

  // ── [6] PARTITION — the SSOT anchor everything else trusts ─────────────────────────────
  // ON_MENU and IS_REMOVED must carve the vendor's items into two sets with no overlap and no
  // gap. If they ever stop being complements, the vendor's active list and Removed section
  // disagree about reality — an item shows in both, or vanishes from both.
  console.log('\n[6] ON_MENU and IS_REMOVED partition every item exactly once')
  const allForVendor = await prisma.menuItem.findMany({ where: { vendorId: vendor.id }, select: { id: true } })
  const inOnMenu = await prisma.menuItem.findMany({ where: { vendorId: vendor.id, ...ON_MENU }, select: { id: true } })
  const inRemoved = await prisma.menuItem.findMany({ where: { vendorId: vendor.id, ...IS_REMOVED }, select: { id: true } })

  const onIds = new Set(inOnMenu.map(i => i.id))
  const remIds = new Set(inRemoved.map(i => i.id))
  const both = [...onIds].filter(id => remIds.has(id))
  const neither = allForVendor.map(i => i.id).filter(id => !onIds.has(id) && !remIds.has(id))

  assert(allForVendor.length > 0, '[0] positive control: the fixture has items at all (an empty set partitions trivially)')
  assert(onIds.size > 0 && remIds.size > 0,
    `[0] positive control: BOTH sides are non-empty (${onIds.size} on menu, ${remIds.size} removed) — a partition where one side is empty proves nothing`)
  assert(both.length === 0, `no item is in BOTH sets (overlap: ${both.length})`)
  assert(neither.length === 0, `no item is in NEITHER set (gap: ${neither.length})`)
  assert(onIds.size + remIds.size === allForVendor.length,
    `the two sets sum to the whole (${onIds.size} + ${remIds.size} === ${allForVendor.length})`)

  // [0] The complement must be DERIVED, not re-typed beside ON_MENU. A hand-written clause is
  // what drifts; this is the structural half of the same assertion.
  const onMenuSrc = readFileSync('lib/menu/on-menu.ts', 'utf8')
  assert(/IS_REMOVED\s*=\s*\{\s*removedAt:\s*\{\s*not:\s*ON_MENU\.removedAt\s*\}\s*\}/.test(onMenuSrc),
    'IS_REMOVED is derived from ON_MENU (negation), not a second hand-typed clause')

  // ── [7] RESTORE ROUND-TRIP at the data layer ───────────────────────────────────────────
  console.log('\n[7] remove → restore returns the item to the menu')
  const roundTrip = await mk('roundtrip')
  const inOnMenuNow = async (id: string) =>
    (await prisma.menuItem.count({ where: { id, ...ON_MENU } })) === 1
  const inRemovedNow = async (id: string) =>
    (await prisma.menuItem.count({ where: { id, ...IS_REMOVED } })) === 1

  assert(await inOnMenuNow(roundTrip.id) && !(await inRemovedNow(roundTrip.id)),
    '[0] starts on the menu, not in the removed set')
  await remove(roundTrip.id)
  assert(await inRemovedNow(roundTrip.id) && !(await inOnMenuNow(roundTrip.id)),
    'after removal: in the removed set, absent from the menu')
  await restore(roundTrip.id)
  assert(await inOnMenuNow(roundTrip.id) && !(await inRemovedNow(roundTrip.id)),
    'after restore: back on the menu, absent from the removed set — the full loop')

  // ── [8] STATE PRESERVATION ACROSS THE CYCLE — the subtle one ───────────────────────────
  // Removal is orthogonal to the sold-out axis. A sold-out item that is removed and restored
  // must come back SOLD OUT — restoring it as "available" would silently put an out-of-stock
  // dish back on sale, which is the three-states rule failing through reversibility.
  console.log('\n[8] a remove/restore cycle does not touch the sold-out axis')
  const cycleSoldOut = await mk('cyclesoldout', { isAvailable: false })
  const cycleAvailable = await mk('cycleavailable', { isAvailable: true })

  for (const item of [cycleSoldOut, cycleAvailable]) {
    await remove(item.id)
    await restore(item.id)
  }
  const afterSoldOut = await prisma.menuItem.findUnique({ where: { id: cycleSoldOut.id } })
  const afterAvailable = await prisma.menuItem.findUnique({ where: { id: cycleAvailable.id } })

  assert(afterSoldOut?.isAvailable === false,
    'a SOLD-OUT item survives remove→restore still sold out (not silently put back on sale)')
  assert(afterAvailable?.isAvailable === true,
    'an AVAILABLE item survives remove→restore still available')
  assert(afterSoldOut?.removedAt === null && afterAvailable?.removedAt === null,
    'and both are back on the menu')
  // [0] control: the two outcomes DIFFER, so "preserved" is not just reporting one constant.
  assert(afterSoldOut?.isAvailable !== afterAvailable?.isAvailable,
    '[0] positive control: the two items end in DIFFERENT states — the cycle preserved each one, it did not normalise them')

  // ── [9] RESTORE AUTHORITY — mirrors removal ────────────────────────────────────────────
  // Verified at HEAD: setting removedAt is ORGANIZER-gated (the approval route runs
  // requireOrganizerAuth + resolveOwnedFair), while isAvailable is vendor-direct
  // (/api/menu-items/[id]/availability needs only getVendorAuth). So clearing removedAt must be
  // organizer-gated too, or a vendor could unilaterally undo an organizer's decision.
  console.log('\n[9] restore carries the same authority as removal')
  const approvalSrc = readFileSync('app/api/organizer/fairs/[fairSlug]/menu-requests/[id]/route.ts', 'utf8')
  const availabilitySrc = readFileSync('app/api/menu-items/[id]/availability/route.ts', 'utf8')

  assert(/requireOrganizerAuth\(\)/.test(approvalSrc),
    'removal (and restore) run through the organizer-gated approval route')
  assert(/case 'RESTORE'/.test(approvalSrc) && /data: \{ removedAt: null \}/.test(approvalSrc),
    'the RESTORE branch and its removedAt:null write live in that organizer-gated route')
  assert(/assertNeverRequestType/.test(approvalSrc),
    'and the switch is exhaustive — a fifth type fails tsc rather than silently approving nothing')
  assert(!/removedAt/.test(availabilitySrc),
    'the VENDOR-DIRECT availability route cannot touch removedAt — a vendor cannot self-restore')
  // [0] control: that route CAN write the field it is allowed to write, so the assertion above
  // is about removedAt specifically and not about the route being inert.
  assert(/data: \{ isAvailable \}/.test(availabilitySrc),
    '[0] positive control: the vendor-direct route does write isAvailable — it is not simply doing nothing')

  // ── [10] THE AUDIT TRAIL APPENDS — it never rewrites ───────────────────────────────────
  // Reversing a removal must not erase the record that it happened. Each remove and each
  // restore files its OWN request row; a restore that reopened or edited the DELETE row would
  // leave a history saying the item was never removed. Run through TWO full cycles, because
  // the failure mode only shows when rows would start colliding.
  console.log('\n[10] repeat remove/restore cycles append rows and mutate none')
  const cycled = await mk('audited')
  const trailUser = await prisma.user.create({
    data: { clerkId: `${PFX}t-${rand()}`, email: `${PFX}t-${rand()}${MAIL}`, name: 'Owner', role: 'vendor' },
  })
  const fileRequest = async (type: 'DELETE' | 'RESTORE') => {
    const row = await prisma.menuRequest.create({
      data: { vendorId: vendor.id, requestedBy: trailUser.id, type, menuItemId: cycled.id },
    })
    // Approve it, exactly as the organizer route does.
    await prisma.menuRequest.update({
      where: { id: row.id },
      data: { status: 'APPROVED', reviewedBy: trailUser.id, reviewedAt: new Date() },
    })
    if (type === 'DELETE') await remove(cycled.id)
    else await restore(cycled.id)
    return row.id
  }

  const d1 = await fileRequest('DELETE')
  const r1 = await fileRequest('RESTORE')
  const d2 = await fileRequest('DELETE')
  const r2 = await fileRequest('RESTORE')

  const trail = await prisma.menuRequest.findMany({
    where: { menuItemId: cycled.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, type: true, status: true },
  })
  assert(trail.length === 4, `four cycles left FOUR rows (got ${trail.length}) — appended, not reused`)
  assert(new Set([d1, r1, d2, r2]).size === 4, 'every request is a distinct row')
  assert(trail.map(t => t.type).join(',') === 'DELETE,RESTORE,DELETE,RESTORE',
    `the trail reads removed → restored → removed → restored (got ${trail.map(t => t.type).join(',')})`)
  assert(trail.every(t => t.status === 'APPROVED'),
    'every earlier request KEEPS its APPROVED status — a restore never reopens the removal it undid')
  const firstDelete = trail.find(t => t.id === d1)
  assert(firstDelete?.type === 'DELETE' && firstDelete.status === 'APPROVED',
    'the ORIGINAL delete row is untouched after two further cycles — history is not rewritten')
  // [0] control: the item genuinely moved each time, so the trail is not four no-ops.
  const finalState = await prisma.menuItem.findUnique({ where: { id: cycled.id } })
  assert(finalState?.removedAt === null,
    '[0] positive control: after the last RESTORE the item is back on the menu — the cycles really ran')

  // ── [11] THE RENDER SITES TYPESCRIPT CANNOT FORCE ──────────────────────────────────────
  // A ternary chain falls through to its last arm, and a `{cond && ...}` branch simply renders
  // nothing — both are valid TypeScript, so the compiler cannot demand a case for a new request
  // type. These two sites are therefore asserted by hand: without them a RESTORE rendered as a
  // RED chip (coloured as a removal) and as a card with no body.
  console.log('\n[11] the render sites handle RESTORE (tsc cannot force these)')
  const chipSrc = readFileSync('app/organizer/fairs/[fairSlug]/vendors/[vendorSlug]/page.tsx', 'utf8')
  assert(/req\.type === 'RESTORE'\s*\?/.test(chipSrc),
    'the vendor-detail chip ternary has its own RESTORE arm — not falling through to the removal colour')
  const queueSrc = readFileSync('app/organizer/fairs/[fairSlug]/menu-requests/page.tsx', 'utf8')
  assert(/req\.type === 'RESTORE' && req\.currentItem/.test(queueSrc),
    'the approval queue has a RESTORE body — the organizer is not approving a blank card')
  assert(/removed \$\{timeAgo\(req\.currentItem\.removedAt\)\}|removed \$\{timeAgo/.test(queueSrc),
    'and that body shows WHEN the item was removed — the context the decision needs')
  assert(/RESTORE: \{ label: 'Restore'/.test(queueSrc),
    'RESTORE has its own badge in the type Record (which tsc DOES force)')

  console.log(`\n${'─'.repeat(72)}`)
  if (fail === 0) console.log(`  ${pass} passed, 0 failed`)
  else console.log(`  ❌ SUITE FAILED — ${fail} of ${pass + fail} failed`)
  console.log(`${'─'.repeat(72)}\n`)

  await cleanup()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async err => {
  console.error(err)
  await cleanup().catch(() => {})
  process.exit(1)
})
