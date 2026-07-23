/**
 * RUNNER-COMPLETION GUARD — completion rate = delivered / collected, from the custody events.
 *
 * Policy (v1): possession-then-failure is penalized; flagging early is not. A pre-collect
 * RELEASE never enters the denominator; a post-collect RETURN counts against.
 *
 *   [0] BASELINE — a runner with no 'collected' events has rate 1.0 (failed nothing).
 *   [1] DELIVERED — collected + delivered (status DELIVERED, still assigned) → counts as delivered.
 *   [2] RETURN counts against — collected then returned (runnerId nulled, status READY) → in the
 *       denominator, not the numerator → lowers the rate.
 *   [3] PRE-collect RELEASE does NOT count — no 'collected' event → not in the denominator at all.
 *   [4] the arithmetic — 2 delivered of 3 collected → 0.667; positive control that a bad delivery
 *       actually moves the number (not a vacuous 1.0).
 *
 * Seeds a throwaway event and cleans up. Run:  npx tsx scripts/runner-completion-guard.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { computeRunnerCompletionRate } from '../lib/runner-completion'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })
const SLUG = 'rcomp-', MAIL = '@rcomp.local', rand = () => Math.random().toString(36).slice(2, 10)

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

async function main() {
  await cleanup()
  try {
    const ev = await prisma.event.create({ data: { name: `RC ${rand()}`, urlSlug: `${SLUG}${rand()}`, startDate: new Date(), endDate: new Date(Date.now() + 864e5), status: 'ACTIVE' } })
    const mkUser = async () => (await prisma.user.create({ data: { clerkId: `${SLUG}${rand()}`, email: `${SLUG}${rand()}${MAIL}`, name: 'r', role: 'customer' } })).id
    const runner = await prisma.runner.create({ data: { eventId: ev.id, userId: await mkUser(), status: 'ACTIVE' } })
    const vendor = await prisma.vendor.create({ data: { eventId: ev.id, name: `V ${rand()}`, slug: `${SLUG}${rand()}`, cuisineType: 'T', status: 'ACTIVE' } })

    // An order in a given final state; optionally with a 'collected' event by our runner, and
    // optionally a 'released' event (pre-collect release → NO collected event).
    const mkOrder = async (o: { status: string; assignedToRunner: boolean; collected: boolean }) => {
      const order = await prisma.order.create({ data: {
        eventId: ev.id, customerId: await mkUser(), vendorId: vendor.id, status: o.status as never,
        fulfillmentType: 'HOME_DELIVERY', runnerId: o.assignedToRunner ? runner.id : null,
        subtotal: 20, fairSynqFee: 2, total: 22, vendorPayout: 20, customerName: 'C', customerPhone: '+10000000000', placedAt: new Date(),
      } })
      if (o.collected) {
        await prisma.deliveryCustodyEvent.create({ data: { orderId: order.id, eventType: 'collected', actorRole: 'runner', runnerId: runner.id } })
      }
      return order
    }

    console.log('[0] baseline: no collected events → rate 1.0')
    const c0 = await computeRunnerCompletionRate(runner.id)
    assert(c0.collected === 0 && c0.rate === 1, 'a runner who has collected nothing has rate 1.0 (failed nothing)')

    console.log('\n[1..4] one delivered, one returned, one pre-collect release')
    await mkOrder({ status: 'DELIVERED', assignedToRunner: true, collected: true })   // delivered by them
    await mkOrder({ status: 'READY', assignedToRunner: false, collected: true })       // collected then RETURNED (runnerId nulled)
    await mkOrder({ status: 'DELIVERED', assignedToRunner: true, collected: true })   // second delivered
    await mkOrder({ status: 'READY', assignedToRunner: false, collected: false })      // PRE-collect release (no collected event)

    const c = await computeRunnerCompletionRate(runner.id)
    assert(c.collected === 3, 'denominator = 3 collected (the pre-collect release is NOT counted)')
    assert(c.delivered === 2, 'numerator = 2 delivered-by-this-runner (the returned one is excluded)')
    assert(Math.abs(c.rate - 2 / 3) < 1e-9, 'rate = 2/3 ≈ 0.667 — the return dragged it below 1.0 (not vacuous)')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }

  console.log(`\n${'─'.repeat(52)}\n${fail === 0 ? '✅' : '❌'} runner-completion-guard: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
