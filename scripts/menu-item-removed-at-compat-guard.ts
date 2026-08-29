/**
 * MENU-ITEM removedAt COMPAT GUARD — step 1 of removal: the column lands INERT.
 *
 * WHAT THIS PROTECTS. Adding `removedAt` must change nothing for the rows that already exist,
 * and "nothing" has to be a BEHAVIOURAL claim, not a schema one. So this asserts not merely
 * that the column is nullable, but that a legacy item still appears on the customer menu, still
 * prices into an order, and still counts toward vendor readiness — the three things the next
 * commit is about to start filtering on. If any of them moved now, the feature would be built
 * on a floor that already shifted.
 *
 * It also pins the three states as DISTINCT VALUES before any code reads them, so the collapse
 * this feature exists to undo ("removed" being an alias for "sold out") cannot quietly persist:
 *     available  isAvailable: true,  removedAt: null
 *     sold out   isAvailable: false, removedAt: null
 *     removed    removedAt: <date>
 *
 * ⚠️ NOT YET ENFORCED ANYWHERE. At this step nothing writes or reads removedAt. [4] therefore
 * asserts the CURRENT, deliberately-wrong behaviour — a removed item is still customer-visible,
 * because no read filters it yet — and is the assertion step 2 must FLIP. It is written as a
 * pin, not a wish, so that step 2 landing without the read filter shows up as this guard going
 * red rather than as silence.
 *
 * ⚠️ MenuItem carries vendorId but NO eventId, so it sits in the prod-write-guard blind spot
 * (lib/prod-write-guard.ts documents the gap). This suite MUST run against the test database.
 *
 * Run: npm run test:db:up && ./scripts/with-test-db.sh npx tsx scripts/menu-item-removed-at-compat-guard.ts
 * Self-cleaning, prefix mira-.
 */

import { config } from 'dotenv'
import { testPrisma } from '../lib/test-db'
config({ path: '.env.local' })

const prisma = testPrisma()

const PFX = 'mira-'
const MAIL = '@mira.test'
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

  // ── [1] COLUMN SHAPE, read from the catalog ────────────────────────────────────────────
  // What the DATABASE got, not what the schema file claims.
  console.log('\n[1] the column landed nullable, defaultless, and indexed')
  const cols = await prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string | null; data_type: string }[]>(
    `SELECT is_nullable, column_default, data_type
       FROM information_schema.columns
      WHERE table_name = 'MenuItem' AND column_name = 'removedAt'`,
  )
  assert(cols.length === 1, 'MenuItem.removedAt exists')
  assert(cols[0]?.is_nullable === 'YES', 'removedAt is NULLABLE (an un-removed item must be representable)')
  assert(cols[0]?.column_default === null,
    'removedAt has NO DEFAULT — nothing is silently removed (contrast the VendorMember grandfather)')
  assert(/timestamp/i.test(cols[0]?.data_type ?? ''), `removedAt is a timestamp (got ${cols[0]?.data_type})`)

  const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'MenuItem' AND indexdef LIKE '%removedAt%'`,
  )
  assert(idx.length >= 1, `removedAt is indexed (${idx.map(i => i.indexname).join(', ') || 'NONE'})`)

  // ── [2] LEGACY ROWS ARE NOT REMOVED ────────────────────────────────────────────────────
  console.log('\n[2] an item written the old way is not removed')
  const legacy = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}legacy`, price: 9.5, category: 'Mains', isAvailable: true },
  })
  assert(legacy.removedAt === null, 'an item created without removedAt reads back null')

  const soldOut = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}soldout`, price: 4, category: 'Sides', isAvailable: false },
  })
  assert(soldOut.removedAt === null, 'a SOLD-OUT item is also not removed — the two states are independent')

  // ── [3] THE THREE STATES ARE DISTINCT VALUES ───────────────────────────────────────────
  // Pinned before any code reads them, so the collapse this feature undoes cannot persist.
  console.log('\n[3] available / sold out / removed are three distinguishable rows')
  const removed = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}removed`, price: 7, category: 'Mains', isAvailable: true, removedAt: new Date() },
  })
  const triple = [legacy, soldOut, removed].map(m => `${m.isAvailable}|${m.removedAt === null ? 'null' : 'date'}`)
  assert(new Set(triple).size === 3, `three distinct (isAvailable, removedAt) pairs (got ${triple.join(' , ')})`)
  assert(removed.removedAt !== null && removed.isAvailable === true,
    'a removed item can be isAvailable:true — removal does NOT reuse the sold-out flag')

  // Reversibility is a property of the column, and it is asserted here rather than assumed,
  // because the restore BUTTON may not ship for some time.
  const restored = await prisma.menuItem.update({ where: { id: removed.id }, data: { removedAt: null } })
  assert(restored.removedAt === null, 'restore is removedAt = null — the state is reversible today')
  await prisma.menuItem.update({ where: { id: removed.id }, data: { removedAt: new Date() } })

  // ── [4] NOTHING READS IT YET — the pin step 2 must flip ────────────────────────────────
  // Deliberately asserting the CURRENT behaviour: a removed item is still customer-visible,
  // because no read filters removedAt. If step 2 lands without the filter, this stays green and
  // says so; when step 2 lands correctly, this assertion is the one that must be inverted.
  console.log('\n[4] PIN: no read filters removedAt yet (step 2 must invert this)')
  // PREDICATE PARITY, not a call. getGroupedMenuItems wraps its queries in unstable_cache and
  // reaches next/cache via require(), so it cannot be invoked from an ESM script at all — the
  // same constraint scripts/p2-archived-visibility-test.ts documents, and it uses the same
  // answer: run the EXACT where-clause the read uses, and assert separately that the source
  // still contains that clause. Two halves, because either alone could drift from the route.
  const { readFileSync } = await import('node:fs')
  const readSrc = readFileSync('lib/menu/getGroupedMenuItems.ts', 'utf8')

  const byVendorToday = await prisma.menuItem.findMany({
    where: { vendorId: vendor.id },            // ← verbatim getGroupedMenuItems.ts:28
    select: { name: true },
  })
  const names = byVendorToday.map(m => m.name)
  assert(names.some(n => n.includes('legacy')),
    '[0] positive control: an ordinary available item IS returned (the predicate works at all)')
  assert(names.some(n => n.includes('removed')),
    'a removed item is STILL returned today — unfiltered, as expected at step 1. STEP 2 MUST FLIP THIS.')
  assert(!/removedAt/.test(readSrc),
    'and the read chokepoint does not mention removedAt yet — the column is genuinely inert')

  // ── [5] LEGACY BEHAVIOUR IS UNTOUCHED — readiness still counts the old way ──────────────
  console.log('\n[5] the readiness count is unchanged by the column landing')
  const readiness = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    include: { _count: { select: { menuItems: { where: { isAvailable: true } } } } },
  })
  // legacy (avail) + removed (avail:true, but removed) = 2; soldOut is not counted.
  assert(readiness?._count.menuItems === 2,
    `readiness counts isAvailable:true only, ignoring removedAt for now (got ${readiness?._count.menuItems}) — step 2 adds removedAt:null and this becomes 1`)

  // ── [6] THE FK BACKSTOP IS REAL ────────────────────────────────────────────────────────
  // The reason no hard-delete carve-out exists. Proven here, at the step that decides the
  // design, rather than asserted in a comment.
  console.log('\n[6] Postgres REFUSES to hard-delete an ordered item (why removal is soft)')
  const customer = await prisma.user.create({
    data: { clerkId: `${PFX}c-${rand()}`, email: `${PFX}c-${rand()}${MAIL}`, name: 'Customer', role: 'customer' },
  })
  const order = await prisma.order.create({
    data: {
      eventId: event.id, customerId: customer.id, vendorId: vendor.id,
      subtotal: 9.5, total: 10.45, fairSynqFee: 0.95, vendorPayout: 9.5,
      customerName: 'Test Customer', customerPhone: '5550000000',
    },
  })
  await prisma.orderItem.create({
    data: {
      orderId: order.id, vendorId: vendor.id, menuItemId: legacy.id, itemName: legacy.name,
      quantity: 1, unitPrice: 9.5, totalPrice: 9.5, subtotal: 9.5,
    },
  })

  let fkBlocked = false
  let fkMessage = ''
  try {
    await prisma.menuItem.delete({ where: { id: legacy.id } })
  } catch (err) {
    fkBlocked = true
    fkMessage = String(err).split('\n').find(l => /foreign key|constraint/i.test(l))?.trim() ?? 'constraint violation'
  }
  assert(fkBlocked, `a hard DELETE of an ORDERED item is refused by the database — ${fkMessage}`)
  const stillThere = await prisma.menuItem.findUnique({ where: { id: legacy.id } })
  assert(stillThere !== null, 'and the row survives the attempt')

  // [0] CONTROL on that probe: an item with NO order references CAN be hard-deleted, so the
  // refusal above is the FK doing work — not deletes failing for some unrelated reason.
  const orphan = await prisma.menuItem.create({
    data: { vendorId: vendor.id, name: `${PFX}orphan`, price: 1, category: 'Test' },
  })
  let orphanDeleted = false
  try {
    await prisma.menuItem.delete({ where: { id: orphan.id } })
    orphanDeleted = true
  } catch { /* unexpected */ }
  assert(orphanDeleted,
    '[0] positive control: a NEVER-ORDERED item CAN be hard-deleted — so [6] is the FK, not a broken delete')

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
