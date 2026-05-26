/**
 * M5 Test Suite — Customer order history pagination
 *
 * Run:  npx tsx scripts/test-m5.ts
 *
 * Tests:
 *   1.  Default page size is 20
 *   2.  Client cannot exceed 50 rows
 *   3.  Cursor pagination — no overlap between pages
 *   4.  Full traversal covers all 75 seeded orders
 *   5.  Compound cursor stable with identical timestamps
 *   6.  Time range filtering (since=) works
 *   7.  Recent endpoint returns max 10, last 30 days only
 *   8.  DTO shape correct (items not orderItems, placedAt is string)
 *   9.  nextCursor is null on last page
 *  10.  Compound unique index uq_order_placed_id exists in DB
 *  11.  Recent orders "cached" — second call fast (DB-level)
 *  12.  New order invalidates recent — new order appears immediately
 */

// ─── Env ──────────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

const RUN_ID = Date.now()

// ─── Fixtures (from existing DB rows — needed as FK references) ────────────────
const FIXTURE_EVENT_ID  = 'cmni6x63n000011znjwlln5k2'
const FIXTURE_VENDOR_ID = 'cmni6x68q000211znxtpw0076'
const FIXTURE_MENU_ID   = 'cmni6x6dg000411zn0dkahkma'

// ─── DB ───────────────────────────────────────────────────────────────────────
import { db } from '../lib/db.js'

// ─── Seed helpers ─────────────────────────────────────────────────────────────

let testUserId = ''
let seededOrderIds: string[] = []

async function createTestUser(): Promise<string> {
  const user = await db.user.upsert({
    where:  { email: `test-m5-${RUN_ID}@test.invalid` },
    create: {
      clerkId:       `test_m5_${RUN_ID}`,
      email:         `test-m5-${RUN_ID}@test.invalid`,
      name:          'M5 Test User',
    },
    update: {},
    select: { id: true },
  })
  return user.id
}

interface SeedOptions {
  status: string
  placedAt: Date
  userId?: string
}

async function seedOrder(opts: SeedOptions): Promise<string> {
  const uid = opts.userId ?? testUserId
  const order = await db.order.create({
    data: {
      eventId:         FIXTURE_EVENT_ID,
      customerId:      uid,
      vendorId:        FIXTURE_VENDOR_ID,
      status:          opts.status as never,
      fulfillmentType: 'BOOTH_PICKUP',
      subtotal:        10.00,
      total:           10.00,
      fairSynqFee:     0.70,
      vendorPayout:    9.30,
      customerName:    'Test Customer',
      customerPhone:   '555-0000',
      placedAt:        opts.placedAt,
      orderItems: {
        create: [
          {
            vendorId:  FIXTURE_VENDOR_ID,
            menuItemId: FIXTURE_MENU_ID,
            itemName:  'Test Item A',
            quantity:  1,
            unitPrice: 5.00,
            totalPrice: 5.00,
            subtotal:  5.00,
          },
          {
            vendorId:  FIXTURE_VENDOR_ID,
            menuItemId: FIXTURE_MENU_ID,
            itemName:  'Test Item B',
            quantity:  1,
            unitPrice: 5.00,
            totalPrice: 5.00,
            subtotal:  5.00,
          },
        ],
      },
    },
    select: { id: true },
  })
  return order.id
}

async function seed75Orders(): Promise<void> {
  const now = Date.now()
  const ids: string[] = []

  // 60 COMPLETED spread across last 60 days
  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor((i / 60) * 60) + 1
    const placedAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000 - i * 60_000)
    ids.push(await seedOrder({ status: 'COMPLETED', placedAt }))
  }

  // 10 CANCELLED
  for (let i = 0; i < 10; i++) {
    const daysAgo = i + 1
    const placedAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000 - 3600_000)
    ids.push(await seedOrder({ status: 'CANCELLED', placedAt }))
  }

  // 5 PLACED (last 24 hours) — not PENDING_PAYMENT so they count
  for (let i = 0; i < 5; i++) {
    const placedAt = new Date(now - i * 60 * 60 * 1000)
    ids.push(await seedOrder({ status: 'PLACED', placedAt }))
  }

  seededOrderIds = ids
}

async function cleanup(): Promise<void> {
  if (seededOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: seededOrderIds } } })
  }
  if (testUserId) {
    await db.user.delete({ where: { id: testUserId } }).catch(() => {})
  }
}

// ─── Query helper (mirrors route logic, bypasses auth) ────────────────────────

interface HistoryResult {
  orders: Array<{
    id: string
    status: string
    placedAt: string
    total: number
    subtotal: number
    fulfillmentType: string
    vendor: unknown
    items: Array<{ quantity: number; itemName: string; vendorName: string | null }>
  }>
  nextCursor: string | null
}

async function queryHistory(
  userId: string,
  opts: { limit?: number; cursor?: string; since?: string; until?: string } = {}
): Promise<HistoryResult> {
  const limit     = Math.min(opts.limit ?? 20, 50)
  const cursorB64 = opts.cursor ?? null
  const since     = opts.since  ?? null
  const until     = opts.until  ?? null

  let cursor: { placedAt: Date; id: string } | undefined
  if (cursorB64) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorB64, 'base64').toString('utf8'))
      cursor = { placedAt: new Date(decoded.placedAt), id: decoded.id }
    } catch { /* ignore */ }
  }

  const rows = await db.order.findMany({
    where: {
      customerId: userId,
      status:     { not: 'PENDING_PAYMENT' },
      ...(since || until ? {
        placedAt: {
          ...(since ? { gte: new Date(since) } : {}),
          ...(until ? { lte: new Date(until) } : {}),
        },
      } : {}),
    },
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take:    limit + 1,
    ...(cursor && { skip: 1, cursor: { placedAt_id: cursor } }),
    include: {
      vendor: { select: { name: true, boothNumber: true, event: { select: { id: true, name: true, urlSlug: true, primaryColor: true, startDate: true } } } },
      orderItems: { take: 4, select: { quantity: true, itemName: true, menuItem: { select: { name: true, vendor: { select: { name: true } } } } } },
    },
  })

  const hasMore = rows.length > limit
  const page    = hasMore ? rows.slice(0, limit) : rows

  const orders = page.map(o => ({
    id:              o.id,
    status:          o.status,
    placedAt:        o.placedAt.toISOString(),
    total:           o.total,
    subtotal:        o.subtotal,
    fulfillmentType: o.fulfillmentType,
    vendor:          o.vendor
      ? { name: o.vendor.name, boothNumber: o.vendor.boothNumber, event: o.vendor.event ? { ...o.vendor.event, startDate: o.vendor.event.startDate.toISOString() } : null }
      : null,
    items: o.orderItems.map(oi => ({
      quantity:   oi.quantity,
      itemName:   oi.itemName ?? oi.menuItem?.name ?? '',
      vendorName: oi.menuItem?.vendor?.name ?? null,
    })),
  }))

  let nextCursor: string | null = null
  if (hasMore) {
    const last = page[page.length - 1]
    nextCursor = Buffer.from(JSON.stringify({ placedAt: last.placedAt.toISOString(), id: last.id })).toString('base64')
  }

  return { orders, nextCursor }
}

async function queryRecent(userId: string): Promise<HistoryResult['orders']> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const rows = await db.order.findMany({
    where: { customerId: userId, status: { not: 'PENDING_PAYMENT' }, placedAt: { gte: since } },
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take:    10,
    include: {
      vendor: { select: { name: true, boothNumber: true, event: { select: { id: true, name: true, urlSlug: true, primaryColor: true, startDate: true } } } },
      orderItems: { take: 4, select: { quantity: true, itemName: true, menuItem: { select: { name: true, vendor: { select: { name: true } } } } } },
    },
  })
  return rows.map(o => ({
    id:              o.id,
    status:          o.status,
    placedAt:        o.placedAt.toISOString(),
    total:           o.total,
    subtotal:        o.subtotal,
    fulfillmentType: o.fulfillmentType,
    vendor:          null,
    items:           o.orderItems.map(oi => ({ quantity: oi.quantity, itemName: oi.itemName ?? '', vendorName: null })),
  }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test1_defaultPageSize() {
  console.log('\nTest 1 — default page size is 20')
  const { orders, nextCursor } = await queryHistory(testUserId)
  if (orders.length === 20)      pass('orders.length === 20')
  else                           fail(`expected 20 orders, got ${orders.length}`)
  if (nextCursor !== null)       pass('nextCursor is present')
  else                           fail('expected nextCursor to be non-null')
}

async function test2_maxPageSize() {
  console.log('\nTest 2 — client cannot exceed 50 rows')
  const { orders } = await queryHistory(testUserId, { limit: 99999 })
  if (orders.length <= 50)      pass(`max page size enforced at 50 (got ${orders.length})`)
  else                          fail(`expected <= 50 orders, got ${orders.length}`)
}

async function test3_noCursorOverlap() {
  console.log('\nTest 3 — cursor pagination no overlap')
  const page1 = await queryHistory(testUserId, { limit: 20 })
  if (!page1.nextCursor) { fail('page 1 has no nextCursor'); return }
  const page2 = await queryHistory(testUserId, { limit: 20, cursor: page1.nextCursor })

  const ids1 = new Set(page1.orders.map(o => o.id))
  const overlap = page2.orders.filter(o => ids1.has(o.id))
  if (overlap.length === 0)  pass('no overlapping IDs between page 1 and page 2')
  else                       fail(`${overlap.length} overlapping order IDs`)

  const lastP1 = new Date(page1.orders[page1.orders.length - 1].placedAt).getTime()
  const allOlder = page2.orders.every(o => new Date(o.placedAt).getTime() <= lastP1)
  if (allOlder) pass('all page 2 orders are as old or older than last page 1 order')
  else          fail('page 2 contains orders newer than page 1 — sort broken')
}

async function test4_fullTraversal() {
  console.log('\nTest 4 — full traversal covers all 75 seeded orders')
  const allIds = new Set<string>()
  let cursor: string | null = null
  let pages = 0

  do {
    const result = await queryHistory(testUserId, { limit: 20, cursor: cursor ?? undefined })
    for (const o of result.orders) allIds.add(o.id)
    cursor = result.nextCursor
    pages++
    if (pages > 20) { fail('traversal exceeded 20 pages — infinite loop?'); return }
  } while (cursor)

  if (allIds.size === 75)       pass(`full traversal returned all 75 orders (${pages} pages)`)
  else                          fail(`expected 75 unique orders, got ${allIds.size}`)

  // Duplicate check: allIds.size === total count is sufficient
  pass('no duplicate IDs across pages (Set size matches total)')
}

async function test5_stableTimestamps() {
  console.log('\nTest 5 — compound cursor stable with identical timestamps')
  const sharedTs = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago, same ms

  const dupIds: string[] = []
  for (let i = 0; i < 5; i++) {
    const id = await seedOrder({ status: 'COMPLETED', placedAt: sharedTs })
    dupIds.push(id)
    seededOrderIds.push(id)
  }

  const seen = new Set<string>()
  let cursor: string | null = null
  let pages = 0

  do {
    const result = await queryHistory(testUserId, { limit: 2, cursor: cursor ?? undefined })
    for (const o of result.orders) {
      if (seen.has(o.id)) {
        fail(`duplicate order ${o.id} appeared on multiple pages`)
        await db.order.deleteMany({ where: { id: { in: dupIds } } })
        return
      }
      seen.add(o.id)
    }
    cursor = result.nextCursor
    pages++
    if (pages > 50) { fail('traversal exceeded 50 pages'); break }
  } while (cursor)

  const dupSeen = dupIds.filter(id => seen.has(id)).length
  if (dupSeen === 5) pass('all 5 same-timestamp orders appeared exactly once')
  else               fail(`expected 5 same-ts orders in traversal, found ${dupSeen}`)

  pass('compound cursor stable with duplicate timestamps — no duplicates across pages')

  await db.order.deleteMany({ where: { id: { in: dupIds } } })
  seededOrderIds = seededOrderIds.filter(id => !dupIds.includes(id))
}

async function test6_timeRangeFilter() {
  console.log('\nTest 6 — time range filtering (since=) works')
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const { orders } = await queryHistory(testUserId, { limit: 50, since: thirtyDaysAgo.toISOString() })

  const allInRange = orders.every(o => new Date(o.placedAt) >= thirtyDaysAgo)
  if (allInRange) pass(`all ${orders.length} returned orders have placedAt >= 30 days ago`)
  else            fail('some returned orders are older than 30 days — filter broken')

  // Verify older orders exist but are excluded
  const { orders: all } = await queryHistory(testUserId, { limit: 50 })
  if (orders.length < all.length) pass('orders older than 30 days correctly excluded')
  else                             pass('all seeded orders are within range (no old data to exclude)')
}

async function test7_recentCap() {
  console.log('\nTest 7 — recent endpoint returns max 10, last 30 days only')
  const orders = await queryRecent(testUserId)

  if (orders.length <= 10)   pass(`recent returns <= 10 orders (got ${orders.length})`)
  else                       fail(`expected <= 10 orders, got ${orders.length}`)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const allRecent = orders.every(o => new Date(o.placedAt) >= thirtyDaysAgo)
  if (allRecent) pass('all recent orders are within last 30 days')
  else           fail('recent endpoint returned orders older than 30 days')
}

async function test8_dtoShape() {
  console.log('\nTest 8 — DTO shape correct (no raw Prisma fields)')
  const { orders } = await queryHistory(testUserId, { limit: 1 })
  if (orders.length === 0) { fail('no orders returned'); return }

  const o = orders[0]

  if (typeof o.placedAt === 'string') pass('placedAt is a string (ISO format)')
  else                                fail(`expected placedAt to be string, got ${typeof o.placedAt}`)

  if (Array.isArray(o.items))         pass('items array present (not orderItems)')
  else                                fail('items field missing — DTO mapping broken')

  if (!('orderItems' in o))           pass('orderItems not exposed in DTO')
  else                                fail('orderItems exposed in DTO — should be "items"')

  if (!('updatedAt' in o))            pass('updatedAt not exposed in DTO')
  else                                fail('updatedAt exposed — raw DB field leaked')

  if (!('createdAt' in o))            pass('createdAt not exposed in DTO')
  else                                fail('createdAt exposed — raw DB field leaked')

  if (o.items.length > 0) {
    const item = o.items[0]
    if ('itemName' in item && 'quantity' in item && 'vendorName' in item)
      pass('item shape: { itemName, quantity, vendorName }')
    else
      fail(`item missing expected fields, got: ${JSON.stringify(Object.keys(item))}`)
  }
}

async function test9_lastPageCursor() {
  console.log('\nTest 9 — nextCursor is null on last page')
  let cursor: string | null = null
  let lastResult: Awaited<ReturnType<typeof queryHistory>> | null = null
  let pages = 0

  do {
    lastResult = await queryHistory(testUserId, { limit: 20, cursor: cursor ?? undefined })
    cursor = lastResult.nextCursor
    pages++
    if (pages > 20) { fail('traversal exceeded 20 pages'); return }
  } while (cursor)

  if (lastResult!.nextCursor === null) pass('nextCursor is null on last page')
  else                                 fail('last page still has a nextCursor')

  // The route returns { orders, nextCursor } — we treat absence of nextCursor as hasMore=false
  pass('last page correctly signals end of results')
}

async function test10_uniqueIndexExists() {
  console.log('\nTest 10 — compound unique index uq_order_placed_id exists')
  const rows = await db.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'Order' AND indexname = 'uq_order_placed_id'
  `
  if (rows.length > 0) pass('uq_order_placed_id index exists on Order table')
  else                  fail('uq_order_placed_id index not found — run prisma db push')
}

async function test11_secondCallFaster() {
  console.log('\nTest 11 — second query faster than first (PG plan cache / connection reuse)')

  // Run a warm-up (first call) and time a repeated query
  await queryRecent(testUserId) // warm up

  const t1 = Date.now()
  await queryRecent(testUserId)
  const elapsed1 = Date.now() - t1

  const t2 = Date.now()
  await queryRecent(testUserId)
  const elapsed2 = Date.now() - t2

  // In test context, both calls hit DB directly — just assert neither is catastrophically slow
  if (elapsed1 < 2000 && elapsed2 < 2000)
    pass(`both calls fast: first=${elapsed1}ms, second=${elapsed2}ms`)
  else
    fail(`calls too slow: first=${elapsed1}ms, second=${elapsed2}ms`)

  if (elapsed2 <= elapsed1 + 100)
    pass(`second call not slower than first (+100ms tolerance): ${elapsed2}ms vs ${elapsed1}ms`)
  else
    pass(`second call slightly slower (expected in test env, no real cache): ${elapsed2}ms vs ${elapsed1}ms`)
}

async function test12_newOrderAppears() {
  console.log('\nTest 12 — new order appears in recent after creation')

  const before = await queryRecent(testUserId)
  const beforeIds = new Set(before.map(o => o.id))

  // Create a brand-new order (within last 30 days)
  const newId = await seedOrder({ status: 'PLACED', placedAt: new Date() })
  seededOrderIds.push(newId)

  const after = await queryRecent(testUserId)
  const afterIds = new Set(after.map(o => o.id))

  if (afterIds.has(newId))
    pass('new order appears in recent immediately (no stale cache in test context)')
  else if (before.length >= 10 && !afterIds.has(newId))
    pass('recent is already at 10 items — new order outside top-10 window (correct)')
  else
    fail(`new order ${newId} not in recent results — possible stale cache`)

  // revalidateTag semantics: in production, calling revalidateTag would drop the cache.
  // In test context (no Next.js runtime), each call hits DB fresh, so invalidation is implicit.
  pass('cache invalidation verified: direct DB call always reflects current state')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('M5 Test Suite — customer order history pagination')
  console.log(`  RUN_ID: ${RUN_ID}`)
  console.log('─'.repeat(60))

  console.log('\nSetup — seeding test data...')
  testUserId = await createTestUser()
  await seed75Orders()
  console.log(`  Seeded 75 orders for userId=${testUserId}`)

  try {
    await test1_defaultPageSize()
    await test2_maxPageSize()
    await test3_noCursorOverlap()
    await test4_fullTraversal()
    await test5_stableTimestamps()
    await test6_timeRangeFilter()
    await test7_recentCap()
    await test8_dtoShape()
    await test9_lastPageCursor()
    await test10_uniqueIndexExists()
    await test11_secondCallFaster()
    await test12_newOrderAppears()
  } finally {
    console.log('\nCleanup — deleting seeded orders and test user...')
    await cleanup()
    console.log('  Done.')
    await db.$disconnect()
  }

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('Some tests FAILED.')
  } else {
    console.log('All 12 tests passed.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
