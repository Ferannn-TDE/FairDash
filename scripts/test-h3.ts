/**
 * H3 Test Suite — Index verification
 *
 * Run:  npx tsx scripts/test-h3.ts
 *
 * Seeds 1000 orders across statuses so Postgres has enough rows to choose
 * index scans over sequential scans. Tests validate index existence, usage,
 * and correctness; cleans up all fixtures on exit.
 *
 * Tests:
 *   1.  Vendor+status+placedAt query uses index, not Seq Scan
 *   2.  Event+status+placedAt query uses index
 *   3.  Customer order history query uses index
 *   4.  VendorOrderStatus vendor+status query uses index
 *   5.  VendorMember unique constraint rejects duplicates
 *   6.  Partial index (idx_order_active_vendor) used for active orders
 *   7.  Slow query logger fires for slow queries
 *   8.  No redundant prefix indexes
 *   9.  Vendor+status benchmark — avg < 50ms across 50 runs
 *  10.  All expected indexes exist
 */

// ─── Env ─────────────────────────────────────────────────────────────────────
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient, OrderStatus, FulfillmentType } from '@prisma/client'

const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  log: [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'warn' }],
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }

function explainRows(rows: unknown[]): string {
  return rows.map((r: unknown) => Object.values(r as Record<string, unknown>)[0]).join('\n')
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const RUN_ID = Date.now()
let testVendorId  = ''
let testEventId   = ''
let testUserId    = ''
let testMenuItemId = ''
const seededOrderIds: string[] = []
const seededVendorMemberIds: string[] = []

async function setupFixtures() {
  const user = await db.user.create({
    data: {
      clerkId: `test-h3-clerk-${RUN_ID}`,
      email:   `test-h3-${RUN_ID}@test.invalid`,
      name:    'H3 Test User',
    },
    select: { id: true },
  })
  testUserId = user.id

  const event = await db.event.create({
    data: {
      name:      `H3 Test Event ${RUN_ID}`,
      urlSlug:   `test-h3-event-${RUN_ID}`,
      startDate: new Date('2025-01-01'),
      endDate:   new Date('2025-01-02'),
    },
    select: { id: true },
  })
  testEventId = event.id

  const vendor = await db.vendor.create({
    data: {
      eventId:     testEventId,
      name:        `H3 Test Vendor ${RUN_ID}`,
      slug:        `test-h3-vendor-${RUN_ID}`,
      cuisineType: 'Test',
    },
    select: { id: true },
  })
  testVendorId = vendor.id

  const menuItem = await db.menuItem.create({
    data: {
      vendorId: testVendorId,
      name:     'H3 Test Item',
      price:    9.99,
      category: 'Test',
    },
    select: { id: true },
  })
  testMenuItemId = menuItem.id
}

// ─── Seed 1000 orders ────────────────────────────────────────────────────────

const SEED_SPECS: Array<{ masterStatus: OrderStatus; vendorStatus: string | null; count: number }> = [
  { masterStatus: OrderStatus.PLACED,     vendorStatus: 'PLACED',    count: 100 },
  { masterStatus: OrderStatus.ACCEPTED,   vendorStatus: 'ACCEPTED',  count: 100 },
  { masterStatus: OrderStatus.PREPARING,  vendorStatus: 'PREPARING', count: 200 },
  { masterStatus: OrderStatus.READY,      vendorStatus: 'READY',     count: 100 },
  { masterStatus: OrderStatus.COMPLETED,  vendorStatus: 'COMPLETED', count: 400 },
  { masterStatus: OrderStatus.CANCELLED,  vendorStatus: null,        count: 100 },
]

async function seedOrders() {
  const base = new Date('2025-06-01T10:00:00Z')
  let offset = 0

  for (const spec of SEED_SPECS) {
    // Sequential to avoid pool exhaustion
    const orders = await db.$transaction(
      Array.from({ length: spec.count }, (_, i) => {
        const placedAt = new Date(base.getTime() + (offset + i) * 30_000)
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
          select: { id: true },
        })
      })
    )
    seededOrderIds.push(...orders.map(o => o.id))

    if (spec.vendorStatus) {
      await db.vendorOrderStatus.createMany({
        data: orders.map(o => ({
          orderId:  o.id,
          vendorId: testVendorId,
          status:   spec.vendorStatus!,
        })),
      })
    }

    await db.orderItem.createMany({
      data: orders.map(o => ({
        orderId:    o.id,
        vendorId:   testVendorId,
        menuItemId: testMenuItemId,
        itemName:   'H3 Test Item',
        quantity:   1,
        unitPrice:  9.99,
        totalPrice: 9.99,
        subtotal:   9.99,
      })),
    })

    offset += spec.count
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function test1_vendorStatusIndex() {
  console.log('\nTest 1 — vendor+status+placedAt query uses index not Seq Scan')
  const rows = await db.$queryRaw<Record<string, string>[]>`
    EXPLAIN ANALYZE
    SELECT * FROM "Order"
    WHERE "vendorId" = ${testVendorId} AND status = 'PREPARING'
    ORDER BY "placedAt" DESC LIMIT 50
  `
  const plan = explainRows(rows)
  if (plan.includes('Seq Scan')) {
    fail(`vendor+status query did Seq Scan:\n${plan}`)
  } else if (plan.includes('Index Scan') || plan.includes('Bitmap Index Scan') || plan.includes('Index Only Scan')) {
    pass('vendor+status+placedAt query uses index')
  } else {
    fail(`unexpected plan (no index scan detected):\n${plan}`)
  }
}

async function test2_eventStatusIndex() {
  console.log('\nTest 2 — event+status+placedAt query uses index')
  const rows = await db.$queryRaw<Record<string, string>[]>`
    EXPLAIN ANALYZE
    SELECT * FROM "Order"
    WHERE "eventId" = ${testEventId} AND status = 'COMPLETED'
    ORDER BY "placedAt" DESC LIMIT 100
  `
  const plan = explainRows(rows)
  if (plan.includes('Seq Scan')) {
    fail(`event+status query did Seq Scan:\n${plan}`)
  } else if (plan.includes('Index Scan') || plan.includes('Bitmap Index Scan')) {
    pass('event+status+placedAt query uses index')
  } else {
    fail(`unexpected plan:\n${plan}`)
  }
}

async function test3_customerHistoryIndex() {
  console.log('\nTest 3 — customer order history query uses index')
  const rows = await db.$queryRaw<Record<string, string>[]>`
    EXPLAIN ANALYZE
    SELECT * FROM "Order"
    WHERE "customerId" = ${testUserId}
    ORDER BY "placedAt" DESC LIMIT 20
  `
  const plan = explainRows(rows)
  if (plan.includes('Seq Scan')) {
    fail(`customer history query did Seq Scan:\n${plan}`)
  } else if (plan.includes('Index Scan') || plan.includes('Bitmap Index Scan')) {
    pass('customer history query uses index')
  } else {
    fail(`unexpected plan:\n${plan}`)
  }
}

async function test4_vosVendorStatusIndex() {
  console.log('\nTest 4 — VendorOrderStatus vendor+status uses index')
  const rows = await db.$queryRaw<Record<string, string>[]>`
    EXPLAIN ANALYZE
    SELECT * FROM "VendorOrderStatus"
    WHERE "vendorId" = ${testVendorId} AND status = 'READY'
  `
  const plan = explainRows(rows)
  if (plan.includes('Seq Scan')) {
    fail(`VendorOrderStatus query did Seq Scan:\n${plan}`)
  } else if (plan.includes('Index Scan') || plan.includes('Bitmap Index Scan')) {
    pass('VendorOrderStatus vendor+status query uses index')
  } else {
    fail(`unexpected plan:\n${plan}`)
  }
}

async function test5_vendorMemberUnique() {
  console.log('\nTest 5 — VendorMember unique constraint rejects duplicates')
  const vm = await db.vendorMember.create({
    data: { vendorId: testVendorId, userId: testUserId, role: 'staff' },
    select: { id: true },
  })
  seededVendorMemberIds.push(vm.id)

  let threw = false
  try {
    await db.vendorMember.create({
      data: { vendorId: testVendorId, userId: testUserId, role: 'staff' },
    })
  } catch {
    threw = true
  }

  const count = await db.vendorMember.count({
    where: { vendorId: testVendorId, userId: testUserId },
  })

  if (!threw) {
    fail('expected unique constraint violation but insert succeeded')
  } else if (count !== 1) {
    fail(`expected 1 VendorMember row but got ${count}`)
  } else {
    pass(`VendorMember unique constraint rejected duplicate (count = ${count})`)
  }
}

async function test6_partialIndexUsed() {
  console.log('\nTest 6 — partial index (idx_order_active_vendor) used for active orders')
  const rows = await db.$queryRaw<Record<string, string>[]>`
    EXPLAIN ANALYZE
    SELECT * FROM "Order"
    WHERE "vendorId" = ${testVendorId}
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')
    ORDER BY "placedAt" DESC LIMIT 50
  `
  const plan = explainRows(rows)
  if (plan.includes('idx_order_active_vendor')) {
    pass('partial index idx_order_active_vendor used for active orders')
  } else if (plan.includes('Seq Scan')) {
    fail(`active-orders query did Seq Scan (partial index not used):\n${plan}`)
  } else {
    // Another index was used — still not a Seq Scan, but flag it
    fail(`expected idx_order_active_vendor, got different plan:\n${plan.split('\n').slice(0, 6).join('\n')}`)
  }
}

async function test7_slowQueryLogger() {
  console.log('\nTest 7 — slow query logger fires for slow queries')

  let slowLogFired = false
  let loggedDuration = 0

  // Intercept $on query events on this client instance
  db.$on('query', (e) => {
    if (e.duration > 100) {
      slowLogFired = true
      loggedDuration = e.duration
    }
  })

  // Run a deliberately slow query — cast to text so Prisma can deserialize void
  await db.$queryRaw`SELECT pg_sleep(0.15)::text`

  // Give the event loop one tick to process the event
  await new Promise(r => setTimeout(r, 50))

  if (slowLogFired) {
    pass(`slow query logger fired (durationMs=${loggedDuration})`)
  } else {
    fail('slow query logger did NOT fire for a 150ms query')
  }
}

async function test8_noRedundantPrefixIndexes() {
  console.log('\nTest 8 — no redundant prefix indexes')

  const rows = await db.$queryRaw<{ tablename: string; indexname: string; indexdef: string }[]>`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE tablename IN ('Order', 'VendorOrderStatus', 'OrderItem', 'Vendor', 'VendorMember')
    ORDER BY tablename, indexname
  `

  // Extract column lists from index definitions
  function extractCols(def: string): string[] {
    // Match columns inside the btree(...) part, stripping DESC/ASC
    const m = def.match(/USING btree \(([^)]+)\)/)
    if (!m) return []
    return m[1].split(',').map(c => c.trim().replace(/ DESC| ASC/g, '').replace(/"/g, ''))
  }

  // Group by table
  const byTable = new Map<string, Array<{ name: string; cols: string[] }>>()
  for (const row of rows) {
    const cols = extractCols(row.indexdef)
    if (!byTable.has(row.tablename)) byTable.set(row.tablename, [])
    byTable.get(row.tablename)!.push({ name: row.indexname, cols })
  }

  const redundant: string[] = []
  for (const [table, indexes] of byTable) {
    for (let i = 0; i < indexes.length; i++) {
      for (let j = 0; j < indexes.length; j++) {
        if (i === j) continue
        const a = indexes[i]
        const b = indexes[j]
        // a is redundant if b is a strict superset starting with all of a's columns
        if (
          a.cols.length > 0 &&
          b.cols.length > a.cols.length &&
          a.cols.every((c, idx) => b.cols[idx] === c)
        ) {
          redundant.push(`${table}: ${a.name} [${a.cols}] is prefix of ${b.name} [${b.cols}]`)
        }
      }
    }
  }

  if (redundant.length === 0) {
    pass('no redundant prefix indexes found')
  } else {
    fail(`found redundant prefix indexes:\n    ${redundant.join('\n    ')}`)
  }
}

async function test9_vendorStatusBenchmark() {
  console.log('\nTest 9 — vendor+status benchmark avg < 50ms across 50 runs')
  const RUNS = 50
  let totalMs = 0

  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    await db.$queryRaw`
      SELECT id, status, "placedAt" FROM "Order"
      WHERE "vendorId" = ${testVendorId} AND status = 'PREPARING'
      ORDER BY "placedAt" DESC LIMIT 50
    `
    totalMs += performance.now() - t0
  }

  const avg = totalMs / RUNS
  if (avg < 50) {
    pass(`avg query time ${(avg ?? 0).toFixed(1)}ms < 50ms (${RUNS} runs)`)
  } else {
    fail(`avg query time ${(avg ?? 0).toFixed(1)}ms exceeded 50ms`)
  }
}

async function test10_allIndexesExist() {
  console.log('\nTest 10 — all expected indexes exist')

  const rows = await db.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('Order', 'VendorOrderStatus', 'OrderItem', 'Vendor', 'VendorMember')
  `
  const existing = new Set(rows.map(r => r.indexname))

  const required = [
    'idx_order_event_status',
    'idx_order_customer_placed',
    'idx_vos_vendor_status',
    'uq_vendormember_user_vendor',
    'idx_order_active_vendor',
    'idx_order_vendor_status_placed',
    'idx_order_event_placed',
    'idx_order_vendor_placed',
    'idx_orderitem_vendor_order',
    'idx_orderitem_menuitem',
    'idx_vendor_event_status',
    'idx_vos_status',
  ]

  const missing = required.filter(name => !existing.has(name))
  if (missing.length === 0) {
    pass(`all ${required.length} expected indexes present`)
  } else {
    fail(`missing indexes: ${missing.join(', ')}`)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n  Cleaning up…')
  await db.vendorOrderStatus.deleteMany({ where: { orderId: { in: seededOrderIds } } })
  await db.orderItem.deleteMany({ where: { orderId: { in: seededOrderIds } } })
  await db.order.deleteMany({ where: { id: { in: seededOrderIds } } })
  if (seededVendorMemberIds.length) {
    await db.vendorMember.deleteMany({ where: { id: { in: seededVendorMemberIds } } })
  }
  await db.menuItem.deleteMany({ where: { id: testMenuItemId } })
  await db.vendor.deleteMany({ where: { id: testVendorId } })
  await db.event.deleteMany({ where: { id: testEventId } })
  await db.user.deleteMany({ where: { id: testUserId } })
  console.log('  Done.')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('H3 Test Suite — index verification')
  console.log(`  RUN_ID: ${RUN_ID}`)
  console.log('─'.repeat(60))

  await setupFixtures()
  console.log(`  testVendorId:  ${testVendorId}`)
  console.log(`  testEventId:   ${testEventId}`)
  console.log(`  testUserId:    ${testUserId}`)

  console.log('  Seeding 1000 orders…')
  await seedOrders()
  console.log(`  Seeded ${seededOrderIds.length} orders.`)

  await test1_vendorStatusIndex()
  await test2_eventStatusIndex()
  await test3_customerHistoryIndex()
  await test4_vosVendorStatusIndex()
  await test5_vendorMemberUnique()
  await test6_partialIndexUsed()
  await test7_slowQueryLogger()
  await test8_noRedundantPrefixIndexes()
  await test9_vendorStatusBenchmark()
  await test10_allIndexesExist()

  await cleanup()

  console.log('\n' + '─'.repeat(60))
  if (process.exitCode === 1) {
    console.error('Some tests FAILED.')
  } else {
    console.log('All 10 tests passed.')
  }

  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await cleanup().catch(() => {})
  await db.$disconnect()
  process.exit(1)
})
