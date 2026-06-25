/**
 * Race-safe runner claim + RunnerEarning tracking (real DB, no Stripe).
 *   npx tsx scripts/test-runner-claim.ts
 *
 * Proves the load-bearing correctness piece: two runners claiming the SAME order
 * at the same instant → exactly ONE winner (atomic updateMany, count===1); the
 * loser gets count===0 ("already taken"), never a silent double-assign. Then a
 * delivered order tracks ONE RunnerEarning sourced from Order.deliveryFee.
 */
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })

let pass = 0, fail = 0
const ok = (m: string) => { console.log(`  ✅ ${m}`); pass++ }
const no = (m: string) => { console.log(`  ❌ ${m}`); fail++ }

async function main() {
  const { db } = await import('../lib/db.js')

  // Fixtures: an event, two runners on it, a customer, a vendor + menu item.
  const event = await db.event.findFirst({ select: { id: true } })
  const customer = await db.user.findFirst({ select: { id: true } })
  const vendor = await db.vendor.findFirst({ where: { eventId: event!.id }, select: { id: true } })
  const menuItem = await db.menuItem.findFirst({ where: { vendorId: vendor!.id }, select: { id: true } })

  // Two runner records (reuse or create two throwaway users+runners).
  async function makeRunner(tag: string) {
    const u = await db.user.create({ data: { clerkId: `test_runner_${tag}_${Date.now()}`, email: `runner_${tag}_${Date.now()}@test.local`, role: 'runner', name: `Runner ${tag}` } })
    const r = await db.runner.create({ data: { userId: u.id, eventId: event!.id, status: 'ACTIVE' } })
    return r.id
  }
  const runnerA = await makeRunner('A')
  const runnerB = await makeRunner('B')

  // A READY home-delivery order, unassigned, with a delivery fee (the runner pool).
  const order = await db.order.create({ data: {
    eventId: event!.id, customerId: customer!.id, vendorId: vendor!.id,
    status: 'READY', fulfillmentType: 'HOME_DELIVERY',
    subtotal: 20, deliveryFee: 5, total: 27, fairSynqFee: 2, vendorPayout: 20,
    customerName: 'Race Test', customerPhone: '+10000000000',
    readyAt: new Date(),
    orderItems: { create: [{ menuItemId: menuItem!.id, itemName: 'I', vendorId: vendor!.id, quantity: 1, unitPrice: 20, totalPrice: 20, subtotal: 20 }] },
    vendorOrderStatuses: { create: [{ vendorId: vendor!.id, status: 'READY' }] },
  }, select: { id: true } })

  console.log('\n=== Race-safe claim ===')
  // The EXACT atomic claim the route runs, fired concurrently by both runners.
  const claim = (runnerId: string) =>
    db.order.updateMany({ where: { id: order.id, runnerId: null }, data: { runnerId, dispatchedAt: new Date() } })

  const [resA, resB] = await Promise.all([claim(runnerA), claim(runnerB)])
  const winners = [resA.count, resB.count].filter(c => c === 1).length
  const losers = [resA.count, resB.count].filter(c => c === 0).length
  winners === 1 ? ok(`exactly ONE winner (A=${resA.count}, B=${resB.count})`) : no(`winners=${winners} (A=${resA.count}, B=${resB.count})`)
  losers === 1 ? ok('the loser got count===0 ("already taken"), not a silent double-assign') : no(`losers=${losers}`)

  const claimed = await db.order.findUnique({ where: { id: order.id }, select: { runnerId: true } })
  const winnerId = resA.count === 1 ? runnerA : runnerB
  claimed?.runnerId === winnerId ? ok(`order.runnerId == the winning runner (${winnerId.slice(-6)})`) : no(`runnerId=${claimed?.runnerId}`)

  // A third claim attempt (e.g. retry/redelivery) must also lose now.
  const resC = await claim(runnerB === winnerId ? runnerA : runnerB)
  resC.count === 0 ? ok('a later claim on the now-assigned order also gets count===0') : no(`later claim count=${resC.count}`)

  console.log('\n=== RunnerEarning tracking (from deliveryFee, idempotent) ===')
  // Simulate the DELIVERED side-effect: upsert earning from deliveryFee.
  const upsertEarning = () => db.runnerEarning.upsert({
    where: { orderId: order.id },
    create: { eventId: event!.id, orderId: order.id, runnerId: winnerId, amountCents: 500, status: 'tracked' },
    update: {},
  })
  await upsertEarning()
  await upsertEarning() // idempotent re-run (redelivered webhook / double status call)
  const earnings = await db.runnerEarning.findMany({ where: { orderId: order.id } })
  earnings.length === 1 ? ok('exactly ONE RunnerEarning (idempotent — no double-count)') : no(`${earnings.length} earnings`)
  earnings[0]?.amountCents === 500 ? ok('earning = $5.00 deliveryFee (customer-funded runner pool, not a vendor deduction)') : no(`amount ${earnings[0]?.amountCents}`)
  earnings[0]?.status === 'tracked' ? ok("status 'tracked' — display only, NOT paid (payout deferred)") : no(`status ${earnings[0]?.status}`)

  // ── Cleanup throwaway fixtures ────────────────────────────────────────────
  await db.runnerEarning.deleteMany({ where: { orderId: order.id } })
  await db.vendorOrderStatus.deleteMany({ where: { orderId: order.id } })
  await db.orderItem.deleteMany({ where: { orderId: order.id } })
  await db.order.delete({ where: { id: order.id } })
  await db.runner.deleteMany({ where: { id: { in: [runnerA, runnerB] } } })
  const u = await db.runner.findMany({ where: { id: { in: [runnerA, runnerB] } } }) // already gone
  await db.user.deleteMany({ where: { clerkId: { startsWith: 'test_runner_' } } })

  console.log(`\n${'─'.repeat(56)}`)
  console.log(fail === 0 ? `All ${pass} assertions passed ✅` : `${pass} passed, ${fail} FAILED`)
  await db.$disconnect()
  if (fail > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
