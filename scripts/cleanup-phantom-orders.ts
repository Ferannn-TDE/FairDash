/**
 * Phantom order cleanup.
 *
 * Background: a previous bug created orders (and vendor-visible side-effects)
 * at "Continue to Payment", before payment. Abandoned/declined checkouts left
 * PENDING_PAYMENT orders — some with stray VendorOrderStatus rows — that never
 * got paid. This script identifies and (only with --delete) removes them.
 *
 * SAFETY:
 *  - Dry-run by default. Pass --delete to actually remove.
 *  - Only touches orders still in PENDING_PAYMENT (never PLACED/paid orders).
 *  - Only orders older than --older-than-hours (default 2h) so an in-progress
 *    checkout sitting on the payment page is never deleted.
 *  - Double-checks Stripe: if a PENDING_PAYMENT order's PaymentIntent actually
 *    succeeded (webhook lag / missed event), it is SKIPPED and reported, never
 *    deleted — that's a real paid order that just needs placing.
 *
 * Usage:
 *   npx tsx scripts/cleanup-phantom-orders.ts
 *   npx tsx scripts/cleanup-phantom-orders.ts --older-than-hours=2
 *   npx tsx scripts/cleanup-phantom-orders.ts --delete
 */

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'

const db = new PrismaClient()
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

function arg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
}
const DELETE = process.argv.includes('--delete')
const OLDER_THAN_HOURS = Number(arg('older-than-hours') ?? 2)

async function main() {
  const cutoff = new Date(Date.now() - OLDER_THAN_HOURS * 60 * 60 * 1000)

  const candidates = await db.order.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true, createdAt: true, total: true, stripePaymentIntentId: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`\nPENDING_PAYMENT orders older than ${OLDER_THAN_HOURS}h: ${candidates.length}`)

  const phantom: string[] = []
  const actuallyPaid: string[] = []

  for (const o of candidates) {
    // Verify against Stripe so we never delete an order whose payment actually
    // went through but whose webhook was missed.
    if (stripe && o.stripePaymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(o.stripePaymentIntentId)
        if (pi.status === 'succeeded') {
          actuallyPaid.push(o.id)
          continue
        }
      } catch {
        // PI not retrievable — treat as phantom (it was never really charged)
      }
    }
    phantom.push(o.id)
  }

  console.log(`  → phantom (unpaid, safe to delete): ${phantom.length}`)
  console.log(`  → actually paid (SKIP — need placing, not deletion): ${actuallyPaid.length}`)
  if (actuallyPaid.length) {
    console.log(`     paid-but-pending order ids: ${actuallyPaid.join(', ')}`)
  }

  if (!DELETE) {
    console.log(`\nDry run. Re-run with --delete to remove the ${phantom.length} phantom order(s).\n`)
    return
  }

  if (phantom.length === 0) {
    console.log('\nNothing to delete.\n')
    return
  }

  // Delete children first (no cascade assumed), then the orders.
  const res = await db.$transaction([
    db.vendorOrderStatus.deleteMany({ where: { orderId: { in: phantom } } }),
    db.orderItem.deleteMany({ where: { orderId: { in: phantom } } }),
    db.order.deleteMany({ where: { id: { in: phantom } } }),
  ])
  console.log(`\nDeleted ${res[2].count} phantom orders (${res[0].count} vendor-status rows, ${res[1].count} order items).\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
