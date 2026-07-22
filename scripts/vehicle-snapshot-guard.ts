/**
 * VEHICLE-SNAPSHOT GUARD — the car that took an order is captured at claim and never lost.
 *
 * Two truths, one transaction (the approved amendment): the Order.runnerVehicle* COLUMNS are
 * current-state for the customer's driver card (cleared on release/return so a re-claimer
 * re-snapshots); the 'claimed' DeliveryCustodyEvent metadata is the APPEND-ONLY record. The
 * incident this closes: clearing the columns on release must NOT erase runner A's vehicle —
 * reconstructing it from a change-log is exactly the replay problem we rejected.
 *
 *   [1] CLEAR keeps HISTORY (real libs) — releaseOrder / confirmReturn null the columns, but
 *       the 'claimed' custody event STILL carries the vehicle. Positive control: an untouched
 *       order keeps its columns.
 *   [2] SOURCE SHAPE — the claim writes the snapshot columns AND a 'claimed' custody event with
 *       the vehicle in metadata, in ONE transaction; release + confirm-return null the columns.
 *   [3] DRIVER CARD — reads Runner.phone (the contact field the settings PATCH writes), never
 *       User.phone; renders the snapshot vehicle, never the customer's or a mutable profile.
 *
 * Seeds a throwaway event and cleans up. Run:  npx tsx scripts/vehicle-snapshot-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { releaseOrder } from '../lib/release-order'
import { confirmReturn } from '../lib/confirm-return'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'vsnap-', MAIL = '@vsnap.local', rand = () => Math.random().toString(36).slice(2, 10)

let pass = 0, fail = 0
const assert = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) } }

async function cleanup() {
  const ev = await prisma.event.findMany({ where: { urlSlug: { startsWith: SLUG } }, select: { id: true } })
  const ids = ev.map(e => e.id)
  if (ids.length) {
    const w = { where: { eventId: { in: ids } } }
    await prisma.order.deleteMany(w) // cascades DeliveryCustodyEvent
    await prisma.runner.deleteMany(w)
    await prisma.vendor.deleteMany(w)
    await prisma.event.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: MAIL } } })
}

const VEHICLE = { vehicleMake: 'Honda', vehicleColor: 'Blue', vehiclePlate: 'RUN-123' }

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `VS ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async (p: string) => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${p}-${rand()}${MAIL}`, name: p, role: 'customer' } })).id
    const runnerUser = await mkUser('r')
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: runnerUser, status: 'ACTIVE', phone: '+15551234567', ...VEHICLE } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    // Seed an order as if just claimed: snapshot columns set + a 'claimed' custody event
    // carrying the same vehicle (what the real claim transaction writes).
    const mkClaimed = async (extra: Record<string, unknown>) => {
      const o = await prisma.order.create({ data: {
        eventId: ev.id, customerId: await mkUser('c'), vendorId: vendor.id,
        status: 'RUNNER_COLLECTED', fulfillmentType: 'HOME_DELIVERY', runnerId: runner.id,
        subtotal: 30, fairSynqFee: 3, total: 33, vendorPayout: 30, customerName: 'C', customerPhone: '+10000000000',
        placedAt: new Date(),
        runnerVehicleMake: VEHICLE.vehicleMake, runnerVehicleColor: VEHICLE.vehicleColor, runnerVehiclePlate: VEHICLE.vehiclePlate,
        ...extra,
      } })
      await prisma.deliveryCustodyEvent.create({ data: {
        orderId: o.id, eventType: 'claimed', actorRole: 'runner', runnerId: runner.id,
        metadata: { vehicleMake: VEHICLE.vehicleMake, vehicleColor: VEHICLE.vehicleColor, vehiclePlate: VEHICLE.vehiclePlate },
      } })
      return o
    }
    const claimedEventVehicle = async (orderId: string) => {
      const e = await prisma.deliveryCustodyEvent.findFirst({ where: { orderId, eventType: 'claimed' }, select: { metadata: true } })
      return (e?.metadata ?? null) as { vehicleMake?: string } | null
    }

    console.log('[1] release/return clears the COLUMNS but the custody event KEEPS the vehicle')
    // release: pre-collection (collectedAt null)
    const relOrder = await mkClaimed({ collectedAt: null })
    const rel = await releaseOrder({ orderId: relOrder.id, runnerId: runner.id, eventId: ev.id })
    assert(rel.outcome === 'released', `release succeeded (got '${rel.outcome}')`)
    const relAfter = await prisma.order.findUnique({ where: { id: relOrder.id }, select: { runnerVehicleMake: true, runnerVehicleColor: true, runnerVehiclePlate: true } })
    assert(relAfter?.runnerVehicleMake === null && relAfter?.runnerVehicleColor === null && relAfter?.runnerVehiclePlate === null, 'snapshot columns cleared on release')
    assert((await claimedEventVehicle(relOrder.id))?.vehicleMake === 'Honda', 'the claimed custody event STILL carries the vehicle (history not lost — the incident case)')

    // confirm-return: collected + return requested + a VOS row for the vendor
    const retOrder = await mkClaimed({ collectedAt: new Date(), returnRequestedAt: new Date() })
    await prisma.vendorOrderStatus.create({ data: { orderId: retOrder.id, vendorId: vendor.id, status: 'READY' } })
    const ret = await confirmReturn({ orderId: retOrder.id, vendorId: vendor.id })
    assert(ret.outcome === 'returned', `confirm-return succeeded (got '${ret.outcome}')`)
    const retAfter = await prisma.order.findUnique({ where: { id: retOrder.id }, select: { runnerVehicleMake: true } })
    assert(retAfter?.runnerVehicleMake === null, 'snapshot columns cleared on confirm-return')
    assert((await claimedEventVehicle(retOrder.id))?.vehicleMake === 'Honda', 'the claimed custody event STILL carries the vehicle after return')

    // positive control: an untouched claimed order keeps its columns (the clear isn't universal)
    const keep = await mkClaimed({ collectedAt: null })
    const keepAfter = await prisma.order.findUnique({ where: { id: keep.id }, select: { runnerVehicleMake: true } })
    assert(keepAfter?.runnerVehicleMake === 'Honda', 'positive control: an un-released order keeps its snapshot')

    console.log('\n[2] source shape: claim writes columns + custody event in one transaction; clears on release/return')
    const statusRoute = readFileSync(new URL('../app/api/orders/[id]/status/route.ts', import.meta.url), 'utf8')
    assert(/\$transaction/.test(statusRoute) && /runnerVehicleMake:\s*runner\.vehicleMake/.test(statusRoute), 'claim snapshots the vehicle inside a transaction')
    assert(/eventType:\s*'claimed'/.test(statusRoute) && /vehicleMake:\s*runner\.vehicleMake/.test(statusRoute), "claim writes a 'claimed' custody event with the vehicle in metadata")
    const relSrc = readFileSync(new URL('../lib/release-order.ts', import.meta.url), 'utf8')
    const retSrc = readFileSync(new URL('../lib/confirm-return.ts', import.meta.url), 'utf8')
    assert(/runnerVehicleMake:\s*null/.test(relSrc) && /runnerVehicleMake:\s*null/.test(retSrc), 'release + confirm-return null the snapshot columns')

    console.log('\n[3] driver card reads Runner.phone + the snapshot, never User.phone or a mutable profile')
    const route = readFileSync(new URL('../app/api/orders/[id]/route.ts', import.meta.url), 'utf8')
    assert(/select:\s*\{\s*phone:\s*true/.test(route) && !route.includes('name: true, phone: true'), 'order route selects Runner.phone (not User.phone) for the driver card')
    const card = readFileSync(new URL('../components/order/DeliveryTracking.tsx', import.meta.url), 'utf8')
    assert(card.includes('order.runner?.phone') && !card.includes('order.runner?.user?.phone'), 'driver card reads Runner.phone')
    assert(card.includes('runnerVehicleColor') && !card.includes('order.vehicleMake'), 'driver card renders the snapshot vehicle, never the customer vehicle')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} vehicle-snapshot-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
