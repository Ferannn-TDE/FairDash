/**
 * H2 Test Suite — Vendor order endpoint splits
 *
 * Run:  npx tsx scripts/test-h2.ts
 *
 * Calls Prisma directly (routes require Clerk auth).
 * Each test mirrors the exact WHERE/SELECT from the route so divergence
 * is caught immediately.
 *
 * Seed: 5 PLACED + 5 PREPARING + 5 READY + 60 COMPLETED + 5 CANCELLED orders,
 *       each with 3 OrderItems carrying a known itemName snapshot.
 *
 * Tests:
 *   1.  Active endpoint returns only active VendorOrderStatus rows
 *   2.  Active endpoint hard-capped at 50 rows
 *   3.  History endpoint returns only terminal / CANCELLED orders
 *   4.  History cursor pagination — no page overlap
 *   5.  Client cannot exceed 50 rows on history
 *   6.  OrderItems have itemName, no deep include fields
 *   7.  itemName snapshot survives a menuItem rename
 *   8.  Active query responds in < 500ms across 10 sequential runs
 *   9.  Active orders sorted oldest-first (kitchen priority)
 *  10.  History orders sorted newest-first
 */

// ─── Env setup ────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient, OrderStatus, FulfillmentType } from '@prisma/client'

const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

// ─── Route constants (must stay in sync with the routes) ─────────────────────

const ACTIVE_VENDOR_STATUSES   = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']
const TERMINAL_VENDOR_STATUSES = ['COMPLETED', 'DECLINED']

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RUN_ID = Date.now()

let testVendorId  = ''
let testEventId   = ''
let testUserId    = ''
let testMenuItemId = ''

const seededOrderIds: string[] = []

async function setupFixtures() {
  const user = await db.user.create({
    data: {
      clerkId: `test-h2-clerk-${RUN_ID}`,
      email:   `test-h2-${RUN_ID}@test.invalid`,
      name:    'H2 Test User',
    },
    select: { id: true },
  })
  testUserId = user.id

  const event = await db.event.create({
    data: {
      name:      `H2 Test Event ${RUN_ID}`,
      urlSlug:   `test-h2-event-${RUN_ID}`,
      startDate: new Date('2025-01-01'),
      endDate:   new Date('2025-01-02'),
    },
    select: { id: true },
  })
  testEventId = event.id

  const vendor = await db.vendor.create({
    data: {
      eventId:     testEventId,
      name:        `H2 Test Vendor ${RUN_ID}`,
      slug:        `test-h2-vendor-${RUN_ID}`,
      cuisineType: 'Test',
    },
    select: { id: true },
  })
  testVendorId = vendor.id

  const menuItem = await db.menuItem.create({
    data: {
      vendorId: testVendorId,
      name:     'Test Nachos',
      price:    9.99,
      category: 'Snacks',
    },
    select: { id: true },
  })
  testMenuItemId = menuItem.id
}

// ─── Seed helpers ────────────────────────────────────────────────────────────

interface SeedSpec {
  vendorStatus: string | null   // VendorOrderStatus.status; null = no row (for CANCELLED)
  masterStatus: OrderStatus
  count: number
  baseTime: Date
  itemName?: string
}

async function seedBatch(specs: SeedSpec[]) {
  // 1. Create all orders in one transaction
  const orderRows = await db.$transaction(
    specs.flatMap(spec =>
      Array.from({ length: spec.count }, (_, i) => {
        const placedAt = new Date(spec.baseTime.getTime() + i * 60_000)
        return db.order.create({
          data: {
            eventId:         testEventId,
            customerId:      testUserId,
            vendorId:        testVendorId,
            status:          spec.masterStatus,
            fulfillmentType: FulfillmentType.BOOTH_PICKUP,
            subtotal:        10,
            total:           10,
            fairSynqFee:     0.7,
            vendorPayout:    9.3,
            customerName:    `Customer ${i}`,
            customerPhone:   '555-0000',
            placedAt,
          },
          select: { id: true, status: true },
        })
      })
    )
  )

  seededOrderIds.push(...orderRows.map(o => o.id))

  // 2. Create OrderItems (3 per order) in bulk
  const itemName = specs[0].itemName ?? 'Test Nachos'
  await db.orderItem.createMany({
    data: orderRows.flatMap(o =>
      [1, 2, 3].map(n => ({
        orderId:    o.id,
        vendorId:   testVendorId,
        menuItemId: testMenuItemId,
        itemName,
        quantity:   n,
        unitPrice:  9.99,
        totalPrice: 9.99 * n,
        subtotal:   9.99 * n,
      }))
    ),
  })

  // 3. Create VendorOrderStatus rows (skip for CANCELLED orders with null vendorStatus)
  const statusRows = orderRows
    .map((o, idx) => {
      const spec = specs[Math.floor(idx / (specs[0].count || 1))]
      return { orderId: o.id, vs: spec.vendorStatus }
    })

  // Re-derive per-order vendorStatus by mapping order index back to spec
  let cumulative = 0
  const perOrder: Array<{ orderId: string; vs: string | null }> = []
  for (const spec of specs) {
    const slice = orderRows.slice(cumulative, cumulative + spec.count)
    for (const o of slice) perOrder.push({ orderId: o.id, vs: spec.vendorStatus })
    cumulative += spec.count
  }

  const vsRows = perOrder.filter(r => r.vs !== null)
  if (vsRows.length > 0) {
    await db.vendorOrderStatus.createMany({
      data: vsRows.map(r => ({
        orderId:  r.orderId,
        vendorId: testVendorId,
        status:   r.vs!,
      })),
    })
  }

  return orderRows
}

async function seedAll() {
  await seedBatch([
    { vendorStatus: 'PLACED',    masterStatus: 'PLACED',    count: 5,  baseTime: new Date('2024-01-01T08:00:00Z') },
  ])
  await seedBatch([
    { vendorStatus: 'PREPARING', masterStatus: 'PREPARING', count: 5,  baseTime: new Date('2024-01-01T09:00:00Z') },
  ])
  await seedBatch([
    { vendorStatus: 'READY',     masterStatus: 'READY',     count: 5,  baseTime: new Date('2024-01-01T10:00:00Z') },
  ])
  await seedBatch([
    { vendorStatus: 'COMPLETED', masterStatus: 'COMPLETED', count: 60, baseTime: new Date('2023-06-01T00:00:00Z') },
  ])
  await seedBatch([
    // CANCELLED: no VendorOrderStatus row — matched via Order.status in history query
    { vendorStatus: null, masterStatus: 'CANCELLED', count: 5, baseTime: new Date('2023-05-01T00:00:00Z') },
  ])
}

// ─── Query helpers (mirror exact route queries) ───────────────────────────────

function activeQuery() {
  return db.order.findMany({
    where: {
      orderItems: { some: { vendorId: testVendorId } },
      vendorOrderStatuses: {
        some: { vendorId: testVendorId, status: { in: ACTIVE_VENDOR_STATUSES } },
      },
    },
    orderBy: [{ placedAt: 'asc' }],
    take: 50,
    select: {
      id: true,
      status: true,
      total: true,
      placedAt: true,
      vendorOrderStatuses: {
        where: { vendorId: testVendorId },
        select: { status: true },
      },
      orderItems: {
        where: { vendorId: testVendorId },
        select: { id: true, quantity: true, unitPrice: true, itemName: true },
      },
    },
  })
}

function historyQuery(take: number, cursor?: string) {
  return db.order.findMany({
    where: {
      orderItems: { some: { vendorId: testVendorId } },
      OR: [
        { vendorOrderStatuses: { some: { vendorId: testVendorId, status: { in: TERMINAL_VENDOR_STATUSES } } } },
        { status: 'CANCELLED' },
      ],
    },
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take,
    cursor: cursor ? { id: cursor } : undefined,
    skip:   cursor ? 1 : 0,
    select: {
      id: true,
      status: true,
      total: true,
      placedAt: true,
      vendorOrderStatuses: {
        where: { vendorId: testVendorId },
        select: { status: true },
      },
      orderItems: {
        where: { vendorId: testVendorId },
        select: { id: true, quantity: true, unitPrice: true, itemName: true },
      },
    },
  })
}

type OrderRow = Awaited<ReturnType<typeof activeQuery>>[number]

function resolveStatus(o: OrderRow) {
  return o.vendorOrderStatuses[0]?.status ?? o.status
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function test1() {
  console.log('\nTest 1 — active endpoint returns only active VendorOrderStatus rows')
  const orders = await activeQuery()
  const result = orders.map(o => resolveStatus(o))

  const invalid = result.filter(s => !ACTIVE_VENDOR_STATUSES.includes(s))
  if (invalid.length === 0) {
    pass(`all ${result.length} active orders have status in [${ACTIVE_VENDOR_STATUSES.join(', ')}]`)
  } else {
    fail(`found non-active statuses: [${invalid.join(', ')}]`)
  }

  const hasCompleted  = result.some(s => s === 'COMPLETED')
  const hasCancelled  = result.some(s => s === 'CANCELLED')
  if (!hasCompleted && !hasCancelled) {
    pass('no COMPLETED or CANCELLED orders in active response')
  } else {
    fail(`active response includes terminal statuses: COMPLETED=${hasCompleted}, CANCELLED=${hasCancelled}`)
  }
}

async function test2() {
  console.log('\nTest 2 — active endpoint hard-capped at 50 rows')
  const orders = await activeQuery()
  if (orders.length <= 50) {
    pass(`orders.length = ${orders.length} (≤ 50)`)
  } else {
    fail(`expected ≤ 50, got ${orders.length}`)
  }
}

async function test3() {
  console.log('\nTest 3 — history endpoint returns only terminal/CANCELLED orders')
  const orders = await historyQuery(50)
  const statuses = orders.map(o => resolveStatus(o))

  const ALLOWED = new Set([...TERMINAL_VENDOR_STATUSES, 'CANCELLED'])
  const invalid = statuses.filter(s => !ALLOWED.has(s))
  if (invalid.length === 0) {
    pass(`all ${statuses.length} history orders have terminal status`)
  } else {
    fail(`found non-terminal statuses in history: [${invalid.join(', ')}]`)
  }

  const hasActive = statuses.some(s => ACTIVE_VENDOR_STATUSES.includes(s))
  if (!hasActive) {
    pass('no PLACED/ACCEPTED/PREPARING/READY in history response')
  } else {
    fail('history response contains active-status orders')
  }
}

async function test4() {
  console.log('\nTest 4 — history cursor pagination: no page overlap, correct count')
  const TAKE = 50

  const page1 = await historyQuery(TAKE)
  const cursor = page1.length === TAKE ? page1[page1.length - 1].id : null

  if (page1.length === TAKE) {
    pass(`page 1 returned ${TAKE} rows (60 COMPLETED + 5 CANCELLED = 65 terminal orders seeded)`)
  } else {
    fail(`expected page 1 to have ${TAKE} rows, got ${page1.length}`)
  }

  if (!cursor) {
    fail('nextCursor missing from page 1 — pagination broken')
    return
  }
  pass(`nextCursor present ("${cursor.slice(0, 12)}…")`)

  const page2 = await historyQuery(TAKE, cursor)
  const p1Ids = new Set(page1.map(o => o.id))
  const overlap = page2.filter(o => p1Ids.has(o.id))

  if (overlap.length === 0) {
    pass(`no overlapping IDs between page 1 (${page1.length}) and page 2 (${page2.length})`)
  } else {
    fail(`${overlap.length} orders appear on both pages — cursor broken`)
  }

  if (page2.length > 0) {
    pass(`page 2 returned ${page2.length} rows`)
  }
}

async function test5() {
  console.log('\nTest 5 — client cannot exceed 50 rows (take=99999 clamped)')
  const rawTake = 99_999
  const take = Math.min(Math.max(1, rawTake), 50)
  const orders = await historyQuery(take)
  if (orders.length <= 50) {
    pass(`clamped take=${take} → returned ${orders.length} rows (≤ 50)`)
  } else {
    fail(`expected ≤ 50 after clamping, got ${orders.length}`)
  }
}

async function test6() {
  console.log('\nTest 6 — orderItems have itemName, no deep include fields')
  const orders = await activeQuery()

  if (orders.length === 0) {
    fail('no active orders returned — cannot inspect orderItems')
    return
  }

  const item = orders[0].orderItems[0] as Record<string, unknown>

  // itemName must be present and be a string
  if (typeof item.itemName === 'string') {
    pass(`orderItem.itemName is a string ("${item.itemName}")`)
  } else {
    fail(`orderItem.itemName is ${typeof item.itemName} — expected string`)
  }

  // menuItem join must be absent
  if (!('menuItem' in item)) {
    pass('"menuItem" absent from orderItem — join removed')
  } else {
    fail('"menuItem" still present on orderItem — deep include not removed')
  }

  // Extra fields must be absent
  const FORBIDDEN = ['description', 'imageUrl', 'category', 'allergens', 'createdAt', 'specialInstructions']
  for (const f of FORBIDDEN) {
    if (!(f in item)) {
      pass(`"${f}" absent from orderItem select`)
    } else {
      fail(`"${f}" present on orderItem — select is too broad`)
    }
  }
}

async function test7() {
  console.log('\nTest 7 — itemName snapshot survives a menuItem rename')

  // Create a dedicated order with itemName already snapshotted
  const order = await db.order.create({
    data: {
      eventId:         testEventId,
      customerId:      testUserId,
      vendorId:        testVendorId,
      status:          'PLACED',
      fulfillmentType: FulfillmentType.BOOTH_PICKUP,
      subtotal: 9.99, total: 9.99, fairSynqFee: 0.70, vendorPayout: 9.29,
      customerName: 'Snapshot Test Customer',
      customerPhone: '555-1234',
      placedAt: new Date('2024-02-01T12:00:00Z'),
    },
    select: { id: true },
  })
  seededOrderIds.push(order.id)

  await db.orderItem.create({
    data: {
      orderId:    order.id,
      vendorId:   testVendorId,
      menuItemId: testMenuItemId,
      itemName:   'Test Nachos',         // snapshot at order time
      quantity:   1,
      unitPrice:  9.99,
      totalPrice: 9.99,
      subtotal:   9.99,
    },
  })

  await db.vendorOrderStatus.create({
    data: { orderId: order.id, vendorId: testVendorId, status: 'PLACED' },
  })

  // Rename the menuItem AFTER the order was placed
  await db.menuItem.update({
    where: { id: testMenuItemId },
    data: { name: 'Renamed Item' },
  })

  // Query via the active endpoint query
  const orders = await activeQuery()
  const target = orders.find(o => o.id === order.id)

  if (!target) {
    fail('seeded PLACED order not found in active results')
    // Restore name for subsequent tests
    await db.menuItem.update({ where: { id: testMenuItemId }, data: { name: 'Test Nachos' } })
    return
  }

  const snapshotName = target.orderItems[0]?.itemName
  if (snapshotName === 'Test Nachos') {
    pass(`itemName = "Test Nachos" (snapshot preserved despite menuItem rename)`)
  } else {
    fail(`expected "Test Nachos", got "${snapshotName}" — snapshot not preserved`)
  }

  if (snapshotName !== 'Renamed Item') {
    pass('"Renamed Item" NOT showing — join is gone, snapshot is source of truth')
  } else {
    fail('"Renamed Item" showing — route is still joining menuItem instead of using snapshot')
  }

  // Restore for subsequent tests that might check item names
  await db.menuItem.update({ where: { id: testMenuItemId }, data: { name: 'Test Nachos' } })
}

async function test8() {
  const RUNS = 10
  const THRESHOLD_MS = 500
  console.log(`\nTest 8 — ${RUNS} sequential active queries, each < ${THRESHOLD_MS}ms`)
  // Sequential to avoid exhausting the Supabase session-mode pool (max 15 connections).
  // Query efficiency (the H2 fix) is captured by individual response times.

  const timings: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now()
    await activeQuery()
    timings.push(Date.now() - t0)
  }

  const maxMs = Math.max(...timings)
  const avgMs = Math.round(timings.reduce((s, t) => s + t, 0) / timings.length)
  const slow  = timings.filter(t => t >= THRESHOLD_MS)

  if (slow.length === 0) {
    pass(`all ${RUNS} active queries completed in < ${THRESHOLD_MS}ms (max: ${maxMs}ms, avg: ${avgMs}ms)`)
  } else {
    fail(`${slow.length}/${RUNS} queries exceeded ${THRESHOLD_MS}ms (max: ${maxMs}ms, avg: ${avgMs}ms)`)
  }
}

async function test9() {
  console.log('\nTest 9 — active orders sorted oldest-first (kitchen priority)')
  const orders = await activeQuery()
  if (orders.length < 2) {
    pass('fewer than 2 active orders — ordering trivially correct')
    return
  }
  let sorted = true
  for (let i = 1; i < orders.length; i++) {
    if (orders[i].placedAt < orders[i - 1].placedAt) { sorted = false; break }
  }
  if (sorted) {
    pass(`${orders.length} active orders in ascending placedAt order (oldest first)`)
  } else {
    fail('active orders are NOT in ascending placedAt order')
  }
}

async function test10() {
  console.log('\nTest 10 — history orders sorted newest-first')
  const orders = await historyQuery(50)
  if (orders.length < 2) {
    pass('fewer than 2 history orders — ordering trivially correct')
    return
  }
  let sorted = true
  for (let i = 1; i < orders.length; i++) {
    if (orders[i].placedAt > orders[i - 1].placedAt) { sorted = false; break }
  }
  if (sorted) {
    pass(`${orders.length} history orders in descending placedAt order (newest first)`)
  } else {
    fail('history orders are NOT in descending placedAt order')
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  if (seededOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: seededOrderIds } } })
  }
  if (testMenuItemId) await db.menuItem.delete({ where: { id: testMenuItemId } }).catch(() => {})
  if (testVendorId)   await db.vendor.delete({ where: { id: testVendorId } }).catch(() => {})
  if (testEventId)    await db.event.delete({ where: { id: testEventId } }).catch(() => {})
  if (testUserId)     await db.user.delete({ where: { id: testUserId } }).catch(() => {})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nH2 Test Suite — vendor order endpoint splits')
  console.log(`  RUN_ID: ${RUN_ID}`)
  console.log('─'.repeat(60))

  try {
    await setupFixtures()
    console.log(`  testVendorId:  ${testVendorId}`)
    console.log(`  testEventId:   ${testEventId}`)
    console.log(`  testMenuItemId: ${testMenuItemId}`)
    console.log('  Seeding orders…')
    await seedAll()
    console.log(`  Seeded ${seededOrderIds.length} orders.`)

    await test1()
    await test2()
    await test3()
    await test4()
    await test5()
    await test6()
    await test7()
    await test8()
    await test9()
    await test10()
  } finally {
    console.log('\n  Cleaning up…')
    await cleanup()
    await db.$disconnect()
    console.log('  Done.')
  }

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('One or more tests FAILED.')
  } else {
    console.log('All 10 tests passed.')
  }
  process.exit(process.exitCode ?? 0)
}

main()
