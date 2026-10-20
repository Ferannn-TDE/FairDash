/**
 * Seeds three orders on the LOCAL dev DB for eyeballing the customer order page
 * (readiness 1.3): a normal paid delivery, a fully auto-cancelled order (food +
 * delivery & tip refunded), and a partial multi-vendor cancel. Writes rows only;
 * no Stripe calls, no queue jobs. Refuses any non-local database.
 *
 * Run:  npx tsx scripts/seed-order-display-demo.ts <customer-email> [--clerk-id=user_…] [--clean]
 *       --clerk-id creates the dev User row (via ensureDbUser) when sign-in hasn't yet.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { isLocalHost, assertNotProductionDatabase } from '../lib/prod-db-guard'

const TAG = 'order-display-demo'
const DEMO_PHONE = '+15555550130' // marks the demo orders for --clean

async function main() {
  if (!isLocalHost(process.env.DATABASE_URL)) throw new Error('refusing: DATABASE_URL is not a local database')
  const email = process.argv[2]
  if (!email) throw new Error('usage: seed-order-display-demo.ts <customer-email> [--clean]')
  assertNotProductionDatabase('seed-order-display-demo.ts')
  const db = new PrismaClient()
  try {
    const clerkId = process.argv.find(a => a.startsWith('--clerk-id='))?.slice('--clerk-id='.length)
    let customer = await db.user.findUnique({ where: { email } })
    if (!customer && clerkId) {
      const { ensureDbUser } = await import('../lib/ensure-db-user')
      customer = (await ensureDbUser(clerkId, { email, role: 'customer' }, { db })).user
    }
    if (!customer) throw new Error(`no dev user with email ${email} — sign in on localhost first, or pass --clerk-id=`)

    const old = await db.order.findMany({ where: { customerId: customer.id, customerPhone: DEMO_PHONE }, select: { id: true } })
    if (old.length) {
      const ids = old.map(o => o.id)
      await db.refund.deleteMany({ where: { orderId: { in: ids } } })
      await db.order.deleteMany({ where: { id: { in: ids } } })
    }
    if (process.argv.includes('--clean')) { console.log(`removed ${old.length} demo orders`); return }

    const vendors = await db.vendor.findMany({
      where: { status: 'ACTIVE', menuItems: { some: {} } },
      include: { menuItems: { take: 2, orderBy: { price: 'asc' } }, event: { select: { id: true, urlSlug: true } } },
      take: 10,
    })
    const byEvent = new Map<string, typeof vendors>()
    for (const v of vendors) byEvent.set(v.eventId, [...(byEvent.get(v.eventId) ?? []), v])
    const pair = [...byEvent.values()].find(vs => vs.length >= 2)
    if (!pair) throw new Error('need an event with two ACTIVE vendors that have menu items')
    const [vA, vB] = pair
    const eventId = vA.eventId

    const lines = [
      { v: vA, item: vA.menuItems[0], qty: 2 },
      { v: vA, item: vA.menuItems[1] ?? vA.menuItems[0], qty: 1 },
      { v: vB, item: vB.menuItems[0], qty: 1 },
    ]
    const r2 = (n: number) => Math.round(n * 100) / 100
    const subtotal = r2(lines.reduce((s, l) => s + l.item.price * l.qty, 0))
    const fee = r2(subtotal * 0.1)
    const delivery = 5.99, tip = 3
    const total = r2(subtotal + fee + delivery + tip)
    const sliceCents = (vid: string) => Math.round(lines.filter(l => l.v.id === vid).reduce((s, l) => s + l.item.price * l.qty, 0) * 100)

    async function mk(kind: 'paid' | 'full' | 'partial') {
      const minutesAgo = { paid: 40, full: 90, partial: 140 }[kind]
      const placedAt = new Date(Date.now() - minutesAgo * 60_000)
      const cancelled = kind === 'full'
      const order = await db.order.create({
        data: {
          eventId, customerId: customer!.id, vendorId: vA.id, fulfillmentType: 'HOME_DELIVERY',
          status: cancelled ? 'CANCELLED' : 'DELIVERED',
          subtotal, fairSynqFee: fee, deliveryFee: delivery, tip, total, vendorPayout: subtotal,
          customerName: customer!.name ?? 'Demo Customer', customerPhone: DEMO_PHONE,
          deliveryStreet: '100 Demo St', deliveryCity: 'Springfield', deliveryState: 'IL', deliveryZip: '62701',
          placedAt,
          ...(cancelled ? {
            cancelledAt: new Date(placedAt.getTime() + 11 * 60_000), cancelledBy: 'system',
            cancellationReason: 'No vendor accepted in time',
            tipRefundId: `re_demo_${Date.now()}`, tipRefundedAt: new Date(), deliveryFeeRefundCents: Math.round(delivery * 100),
          } : {}),
          orderItems: { create: lines.map(l => ({
            vendorId: l.v.id, menuItemId: l.item.id, itemName: l.item.name, quantity: l.qty,
            unitPrice: l.item.price, totalPrice: r2(l.item.price * l.qty), subtotal: r2(l.item.price * l.qty),
          })) },
          vendorOrderStatuses: { create: [
            { vendorId: vA.id, status: cancelled ? 'CANCELLED' : kind === 'partial' ? 'DECLINED' : 'COMPLETED' },
            { vendorId: vB.id, status: cancelled ? 'CANCELLED' : 'COMPLETED' },
          ] },
          ...(cancelled ? { cancellation: { create: { vendorId: vA.id, reason: 'No vendor accepted in time' } } } : {}),
        },
      })
      const refundVendors = kind === 'full' ? [vA, vB] : kind === 'partial' ? [vA] : []
      for (const v of refundVendors) {
        await db.refund.create({ data: {
          eventId, orderId: order.id, vendorId: v.id, amountCents: sliceCents(v.id), status: 'COMPLETED',
          reason: TAG, stripeRefundId: `re_demo_${v.id.slice(-6)}_${kind}`, createdBy: 'system',
        } })
      }
      return order
    }

    const paid = await mk('paid'), full = await mk('full'), partial = await mk('partial')
    const base = `http://localhost:3000/fair/${vA.event.urlSlug}/order`
    console.log(`vendors: ${vA.name} ($${(sliceCents(vA.id) / 100).toFixed(2)}), ${vB.name} ($${(sliceCents(vB.id) / 100).toFixed(2)}); total $${total.toFixed(2)}`)
    console.log(`paid:    ${base}/${paid.id}`)
    console.log(`full:    ${base}/${full.id}`)
    console.log(`partial: ${base}/${partial.id}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch(err => { console.error(err.message ?? err); process.exit(1) })
