/**
 * Vendor order history — pagination correctness.
 *
 * THE TWO WAYS PAGINATION BREAKS IN PRACTICE, both exercised for real:
 *
 *  1. FILTER COMPOSITION. Pages must compose with the active filter — "page 2 of Cancelled",
 *     never "page 2 of everything" wearing the Cancelled label.
 *
 *  2. STABLE SORT. placedAt is NOT unique. Two orders placed in the same second collide, and
 *     with a non-deterministic tie order the database may return them in a different order on
 *     each query — so a row appears on TWO pages, or is SKIPPED entirely. Silent, and
 *     maddening to debug in production.
 *
 * THE TEST DATA MUST CONTAIN THE CONDITION THE BUG NEEDS. If every seeded order had a
 * distinct createdAt, the sort would be trivially stable and this test would pass while
 * proving NOTHING. So the seed deliberately gives MANY orders the IDENTICAL placedAt —
 * including runs that straddle the page boundary, which is precisely where a missing
 * tiebreaker duplicates or drops rows.
 *
 * Exercises the REAL query used by the route (lib/vendor-order-history), not a copy.
 *
 * Run:  npx tsx scripts/vendor-order-pagination-test.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { fetchVendorOrderHistory } from '../lib/vendor-order-history'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const SLUG = 'pgtest-'
const MAIL = '@pgtest.local'
const rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}`) }
}

async function cleanup() {
  const events = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = events.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.vendorEarning.deleteMany(w)
    await prisma.order.deleteMany(w)
    await prisma.menuItem.deleteMany({ where: { vendor: { eventId: { in: ids } } } })
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

/** Walk EVERY page of a filter via the cursor, exactly as the client does. */
async function walkAllPages(vendorId: string, tab: string, take: number, sort: 'newest' | 'oldest' = 'newest') {
  const seen: string[] = []
  let cursor: string | null = null
  let pages = 0
  for (;;) {
    const res: Awaited<ReturnType<typeof fetchVendorOrderHistory>> =
      await fetchVendorOrderHistory({ vendorId, tab, take, cursor, sort })
    seen.push(...res.orders.map(o => o.id))
    pages++
    if (!res.nextCursor) break
    cursor = res.nextCursor
    if (pages > 50) throw new Error('runaway pagination — nextCursor never cleared')
  }
  return { seen, pages }
}

async function main() {
  await cleanup()
  try {
    const user = await prisma.user.create({
      data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}v-${rand()}${MAIL}`, name: 'PG', role: 'vendor' },
    })
    const event = await prisma.event.create({
      data: { name: `PG ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE' },
    })
    const mkVendor = async () => {
      const v = await prisma.vendor.create({
        data: { eventId: event.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' },
      })
      const mi = await prisma.menuItem.create({ data: { vendorId: v.id, name: 'Item', price: 10, category: 'T' } })
      return { v, mi }
    }
    const { v: vendor, mi } = await mkVendor()
    const { v: otherVendor, mi: otherMi } = await mkVendor()

    // ── SEED ──────────────────────────────────────────────────────────────────
    // THE WHOLE POINT: a SINGLE shared timestamp for most orders. Without an id
    // tiebreaker in the sort, these are the rows that duplicate/vanish across pages.
    const COLLIDING_TS = new Date('2026-07-01T12:00:00.000Z')
    const N_COMPLETED = 55  // > one page of 25, straddles the boundary
    const N_CANCELLED = 30

    const mk = async (vId: string, mId: string, vendorStatus: string, masterStatus: any, placedAt: Date) => {
      const c = await prisma.user.create({
        data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}c-${rand()}${MAIL}`, name: 'C', role: 'customer' },
      })
      const o = await prisma.order.create({
        data: {
          eventId: event.id, customerId: c.id, vendorId: vId,
          status: masterStatus, fulfillmentType: 'BOOTH_PICKUP',
          subtotal: 10, fairSynqFee: 1, total: 11, vendorPayout: 10,
          customerName: 'C', customerPhone: '+10000000000',
          placedAt,
          orderItems: { create: [{ vendorId: vId, menuItemId: mId, itemName: 'Item', quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
          vendorOrderStatuses: { create: [{ vendorId: vId, status: vendorStatus }] },
        },
      })
      return o.id
    }

    const completedIds: string[] = []
    for (let i = 0; i < N_COMPLETED; i++) {
      // EVERY completed order shares the exact same placedAt.
      completedIds.push(await mk(vendor.id, mi.id, 'COMPLETED', 'COMPLETED', COLLIDING_TS))
    }
    const cancelledIds: string[] = []
    for (let i = 0; i < N_CANCELLED; i++) {
      cancelledIds.push(await mk(vendor.id, mi.id, 'DECLINED', 'CANCELLED', COLLIDING_TS))
    }
    // Another vendor's orders — must never leak into our pages.
    const otherIds: string[] = []
    for (let i = 0; i < 10; i++) {
      otherIds.push(await mk(otherVendor.id, otherMi.id, 'COMPLETED', 'COMPLETED', COLLIDING_TS))
    }

    // Prove the seed really is degenerate — otherwise the whole test is vacuous.
    console.log('\n[0] the seed actually contains the condition the bug needs')
    const distinctTs = await prisma.order.findMany({
      where: { orderItems: { some: { vendorId: vendor.id } } },
      select: { placedAt: true },
      distinct: ['placedAt'],
    })
    assert(distinctTs.length === 1,
      `all ${N_COMPLETED + N_CANCELLED} of this vendor's orders share ONE placedAt (distinct timestamps: ${distinctTs.length}) — without an id tiebreaker the sort is undefined`)

    // ── [1] ⛔ STABLE SORT: walk every page, nothing duplicated, nothing skipped ─
    console.log('\n[1] ⛔ STABLE SORT: every order appears EXACTLY once across all pages')
    const TAKE = 25 // forces 3 pages over 55 completed — ties straddle both boundaries
    const { seen, pages } = await walkAllPages(vendor.id, 'COMPLETED', TAKE)
    assert(pages === 3, `paged through ${pages} pages of ${TAKE}`)
    const dupes = seen.filter((id, i) => seen.indexOf(id) !== i)
    assert(dupes.length === 0, `NO duplicates across pages (found ${dupes.length})`)
    assert(new Set(seen).size === N_COMPLETED, `saw ${new Set(seen).size} distinct orders — expected all ${N_COMPLETED}`)
    const missing = completedIds.filter(id => !seen.includes(id))
    assert(missing.length === 0, `NO order was SKIPPED (missing ${missing.length})`)

    // ── [2] Determinism: the same walk twice yields the same order ─────────────
    console.log('\n[2] the page order is DETERMINISTIC (same walk twice → identical sequence)')
    const again = await walkAllPages(vendor.id, 'COMPLETED', TAKE)
    assert(JSON.stringify(again.seen) === JSON.stringify(seen),
      'two independent walks return the identical sequence — ties are not reshuffled between queries')

    // ── [3] ⛔ FILTER COMPOSITION: page 2 of Cancelled is CANCELLED ────────────
    console.log('\n[3] ⛔ FILTER COMPOSITION: page 2 of Cancelled contains only cancelled orders')
    const p1 = await fetchVendorOrderHistory({ vendorId: vendor.id, tab: 'CANCELLED', take: 10 })
    assert(p1.orders.length === 10, 'Cancelled page 1 is full')
    const p2 = await fetchVendorOrderHistory({ vendorId: vendor.id, tab: 'CANCELLED', take: 10, cursor: p1.nextCursor })
    assert(p2.orders.length === 10, 'Cancelled page 2 is full')
    const p2AllCancelled = p2.orders.every(o => cancelledIds.includes(o.id))
    assert(p2AllCancelled, '⛔ every row on Cancelled page 2 IS a cancelled order (not "page 2 of everything")')
    const p2NoCompleted = p2.orders.every(o => !completedIds.includes(o.id))
    assert(p2NoCompleted, 'no COMPLETED order leaked onto the Cancelled page')

    // Full walk of the filter: exactly the cancelled set, no more, no less.
    const cancelWalk = await walkAllPages(vendor.id, 'CANCELLED', 10)
    assert(new Set(cancelWalk.seen).size === N_CANCELLED,
      `walking Cancelled yields exactly ${N_CANCELLED} orders (got ${new Set(cancelWalk.seen).size})`)
    assert(cancelWalk.seen.every(id => cancelledIds.includes(id)), 'and every one of them is cancelled')

    // ── [4] Counts are TRUE totals, not "within the page" ──────────────────────
    console.log('\n[4] tab counts are TRUE totals across all history, not just the fetched page')
    const withCounts = await fetchVendorOrderHistory({ vendorId: vendor.id, tab: 'all', take: 10, withCounts: true })
    assert(withCounts.orders.length === 10, 'page returned 10 rows')
    assert(withCounts.counts?.COMPLETED === N_COMPLETED,
      `COMPLETED count = ${withCounts.counts?.COMPLETED} (the true ${N_COMPLETED}, not the 10 on this page)`)
    assert(withCounts.counts?.CANCELLED === N_CANCELLED,
      `CANCELLED count = ${withCounts.counts?.CANCELLED} (the true ${N_CANCELLED})`)
    assert(withCounts.counts?.all === N_COMPLETED + N_CANCELLED,
      `all count = ${withCounts.counts?.all} (${N_COMPLETED + N_CANCELLED})`)

    // ── [5] ⛔ VENDOR SCOPING: cannot page into another vendor's orders ────────
    console.log('\n[5] ⛔ VENDOR SCOPING: another vendor\'s orders never appear on any page')
    const allWalk = await walkAllPages(vendor.id, 'all', 25)
    const leaked = allWalk.seen.filter(id => otherIds.includes(id))
    assert(leaked.length === 0, `ZERO of the other vendor's ${otherIds.length} orders leaked (found ${leaked.length})`)
    assert(new Set(allWalk.seen).size === N_COMPLETED + N_CANCELLED,
      `'all' returns exactly this vendor's ${N_COMPLETED + N_CANCELLED} orders`)

    // ── [6] Sort direction flips, and stays stable ─────────────────────────────
    console.log('\n[6] oldest-first also pages cleanly (the tiebreaker follows the sort direction)')
    const oldest = await walkAllPages(vendor.id, 'COMPLETED', TAKE, 'oldest')
    const oldDupes = oldest.seen.filter((id, i) => oldest.seen.indexOf(id) !== i)
    assert(oldDupes.length === 0, 'no duplicates when sorted oldest-first')
    assert(new Set(oldest.seen).size === N_COMPLETED, `all ${N_COMPLETED} orders still seen exactly once`)
    assert(JSON.stringify(oldest.seen) === JSON.stringify([...seen].reverse()),
      'oldest-first is the exact reverse of newest-first — the tiebreaker direction follows the sort')

    console.log(`\n${'─'.repeat(64)}\n  ${pass} passed, ${fail} failed\n${'─'.repeat(64)}\n`)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\n💥', e); await cleanup().catch(() => {}); await prisma.$disconnect(); process.exit(1) })
