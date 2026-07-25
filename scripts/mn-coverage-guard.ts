/**
 * SWEEP COVERAGE GUARD — the reconciler's scans must be DETERMINISTIC and COMPLETE.
 *
 * THE BUG THIS EXISTS FOR (measured, not hypothetical). Patterns M/N/O/R scanned the whole
 * live-order space with `take: 100` and NO `orderBy`. With 153 active orders, five consecutive
 * scans returned the IDENTICAL 100 ids and 53 orders were NEVER returned by any of them — not
 * "rotates across sweeps", permanently invisible. During a rush is exactly when the active-order
 * count exceeds the cap, and exactly when master-status drift (N) and stranded deliveries (O)
 * matter most.
 *
 * [0] POSITIVE CONTROLS FIRST — the probe itself must be able to FAIL. An unordered scan is run
 *     against real seeded data to demonstrate the starvation the ordered scan then fixes. Without
 *     this the [2] assertions could pass vacuously on an empty table.
 *
 * Run: npx tsx scripts/mn-coverage-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { guardedPrisma } from '../lib/prod-write-guard'

const db = guardedPrisma()
const ACTIVE = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED'] as const

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const SEED = 40           // > CAP so truncation is real
const CAP = 25            // stand-in for a cap smaller than the pool
const TAG = `mncov-${Date.now()}`

function scan(orderBy: object | undefined, take: number) {
  return db.order.findMany({
    where: { status: { in: ACTIVE as never }, voidedAt: null },
    select: { id: true },
    ...(orderBy ? { orderBy } : {}),
    take,
  })
}

async function main() {
  console.log('\n════ SWEEP COVERAGE GUARD ════')

  // ── [1] STRUCTURAL: every capped scan in the reconciler carries an orderBy ────
  console.log('\n[1] STRUCTURAL: no capped scan in lib/reconciler.ts is unordered')
  const src = readFileSync('lib/reconciler.ts', 'utf8').split('\n')
  const unordered: number[] = []
  src.forEach((l, i) => {
    if (/take: o\.(maxPerPattern|scanCeiling)/.test(l)) {
      const back = src.slice(Math.max(0, i - 22), i).join('\n')
      const lastQuery = back.split(/findMany\(\{|groupBy\(\{/).pop() ?? ''
      if (!/orderBy/.test(lastQuery)) unordered.push(i + 1)
    }
  })
  assert(unordered.length === 0,
    `every capped scan has a deterministic orderBy (unordered at lines: ${unordered.join(', ') || 'none'})`)

  const ceilingUses = src.filter(l => /take: o\.scanCeiling/.test(l)).length
  assert(ceilingUses === 4, `the 4 whole-live-space scanners (M,N,O,R) use scanCeiling, not maxPerPattern (found ${ceilingUses})`)
  const ceilingAlerts = src.filter(l => /SCAN CEILING HIT/.test(l)).length
  assert(ceilingAlerts === 4, `each of the 4 alerts LOUDLY when the ceiling truncates (found ${ceilingAlerts}) — truncation is never silent`)

  // ── seed ─────────────────────────────────────────────────────────────────────
  console.log(`\n  seeding ${SEED} ACTIVE orders into a throwaway event…`)
  const org = await db.fairOrganizer.create({ data: { name: TAG, contactEmail: `${TAG}@example.test` } })
  const ev = await db.event.create({
    data: { name: TAG, urlSlug: TAG, organizerId: org.id, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 86_400_000) },
  })
  const ven = await db.vendor.create({ data: { eventId: ev.id, name: `${TAG}-v`, slug: `${TAG}-v`, cuisineType: 'Test', status: 'ACTIVE' } })
  const item = await db.menuItem.create({ data: { vendorId: ven.id, name: 'i', price: 10, category: 'T', isAvailable: true } })
  const cust = await db.user.create({ data: { clerkId: `${TAG}-c`, email: `${TAG}-c@example.test`, name: 'Cov' } })

  const seeded: string[] = []
  for (let i = 0; i < SEED; i++) {
    const o = await db.order.create({
      data: {
        eventId: ev.id, customerId: cust.id, vendorId: ven.id, status: 'PLACED', fulfillmentType: 'BOOTH_PICKUP',
        subtotal: 10, total: 11, fairSynqFee: 1, vendorPayout: 10, customerName: 'Cov', customerPhone: '+10000000000',
        placedAt: new Date(Date.now() - (SEED - i) * 1000),
        orderItems: { create: [{ menuItemId: item.id, itemName: 'i', vendorId: ven.id, quantity: 1, unitPrice: 10, totalPrice: 10, subtotal: 10 }] },
        vendorOrderStatuses: { create: [{ vendorId: ven.id, status: 'PLACED' }] },
      }, select: { id: true },
    })
    seeded.push(o.id)
  }

  try {
    const pool = await db.order.count({ where: { status: { in: ACTIVE as never }, voidedAt: null } })
    assert(pool > CAP, `[0] POSITIVE CONTROL: the candidate pool (${pool}) EXCEEDS the cap (${CAP}) — truncation is actually exercised`)

    // ── [0] the probe can fail: unordered scan starves rows ────────────────────
    console.log('\n[0] POSITIVE CONTROL: an UNORDERED capped scan starves rows (the original bug)')
    const u1 = new Set((await scan(undefined, CAP)).map(r => r.id))
    const u2 = new Set((await scan(undefined, CAP)).map(r => r.id))
    const union = new Set([...u1, ...u2])
    const starved = seeded.filter(id => !union.has(id))
    assert(starved.length > 0,
      `unordered scan leaves ${starved.length} seeded orders unexamined across 2 runs — the probe CAN detect starvation`)

    // ── [2] ordered scan is deterministic and oldest-first ─────────────────────
    console.log('\n[2] the ORDERED scan is deterministic and oldest-first')
    const orderBy = [{ placedAt: 'asc' as const }, { id: 'asc' as const }]
    const a = (await scan(orderBy, CAP)).map(r => r.id)
    const b = (await scan(orderBy, CAP)).map(r => r.id)
    assert(a.join(',') === b.join(','), 'two ordered scans return the same ids in the same SEQUENCE')

    const oldest = (await db.order.findMany({
      where: { status: { in: ACTIVE as never }, voidedAt: null }, orderBy, take: CAP, select: { id: true },
    })).map(r => r.id)
    assert(oldest.join(',') === a.join(','), 'the ordered scan is exactly the OLDEST N — truncation drops the newest, not an arbitrary set')

    // ── [3] POSITIVE CONTROL: a row beyond the cap IS eventually examined ───────
    console.log('\n[3] POSITIVE CONTROL: a row beyond the cap is reached once the head drains')
    const beyond = seeded.find(id => !a.includes(id))
    assert(!!beyond, 'a seeded order exists beyond the cap (otherwise [3] would be vacuous)')
    // Drain the head the way real life does — the oldest orders leave ACTIVE.
    await db.order.updateMany({ where: { id: { in: a.slice(0, CAP) } }, data: { status: 'COMPLETED' } })
    const after = (await scan(orderBy, CAP)).map(r => r.id)
    assert(after.includes(beyond!), 'the previously-starved order IS examined after the head drains — coverage advances, it does not stall')

    // ── [4] the real ceiling covers a realistic peak ───────────────────────────
    console.log('\n[4] the production ceiling is bigger than any realistic pool')
    const ceiling = Number(/scanCeiling: (\d+)/.exec(readFileSync('lib/reconciler.ts', 'utf8'))?.[1] ?? 0)
    assert(ceiling >= 1000, `scanCeiling is ${ceiling} — ≥10× a realistic fair peak in one round-trip`)
  } finally {
    console.log('\n  cleaning up…')
    await db.orderItem.deleteMany({ where: { order: { eventId: ev.id } } })
    await db.vendorOrderStatus.deleteMany({ where: { order: { eventId: ev.id } } })
    await db.order.deleteMany({ where: { eventId: ev.id } })
    await db.menuItem.deleteMany({ where: { vendorId: ven.id } })
    await db.vendor.deleteMany({ where: { eventId: ev.id } })
    await db.event.delete({ where: { id: ev.id } })
    await db.fairOrganizer.delete({ where: { id: org.id } })
    await db.user.delete({ where: { id: cust.id } })
    const left = await db.order.count({ where: { eventId: ev.id } })
    console.log(`  throwaway event rows left: ${left}`)
  }

  console.log('\n────────────────────────────────────')
  console.log(failed === 0 ? `  ✅ ${passed} passed, 0 failed` : `  ❌ ${passed} passed, ${failed} failed`)
  await db.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
