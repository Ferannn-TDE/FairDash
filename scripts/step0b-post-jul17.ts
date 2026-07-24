/**
 * Step 0b — narrowing: orders that COULD have enqueued.
 *
 * Vercel's REDIS_URL landed 2026-07-17, so only orders placed on/after that date
 * bear on the missing `bull:fairsynq-orders:id`. READ-ONLY.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const CUT = new Date('2026-07-17T00:00:00.000Z')

async function main() {
  const rows = await db.order.findMany({
    where: { voidedAt: null, placedAt: { gte: CUT } },
    select: {
      id: true, placedAt: true, status: true, fulfillmentType: true,
      acceptedAt: true, readyAt: true, completedAt: true, cancelledAt: true,
      runnerId: true, payoutStatus: true, total: true,
      stripePaymentIntentId: true,
    },
    orderBy: { placedAt: 'asc' },
  })

  console.log(`non-voided orders placed on/after ${CUT.toISOString().slice(0, 10)}: ${rows.length}\n`)

  // Which add() call sites each order's lifecycle would have reached.
  //  - JOB_UNACCEPTED   : fires on EVERY placement (lib/place-order.ts:135)
  //  - UNCOLLECTED/UNDELIVERABLE : fires on READY  (status route :344, reconcile :451)
  //  - vendor payout    : fires on COMPLETED/DELIVERED (reconcile :505, route :422)
  //  - runner payout    : fires on DELIVERED + runnerId (reconcile :605)
  const hdr = ['placedAt', 'id', 'status', 'ful', 'triggers'].join('  ')
  console.log(hdr)
  console.log('-'.repeat(hdr.length + 40))

  let anyTrigger = 0
  const tally: Record<string, number> = {}
  for (const o of rows) {
    const t: string[] = ['UNACCEPTED@place']
    if (o.readyAt) t.push(o.fulfillmentType === 'HOME_DELIVERY' ? 'UNDELIVERABLE@ready' : 'UNCOLLECTED@ready')
    if (o.completedAt || o.status === 'COMPLETED' || o.status === 'DELIVERED') t.push('VENDOR_PAYOUT@complete')
    if (o.status === 'DELIVERED' && o.runnerId) t.push('RUNNER_PAYOUT@delivered')
    for (const x of t) tally[x] = (tally[x] || 0) + 1
    anyTrigger++
    console.log(
      `${o.placedAt.toISOString()}  ${o.id}  ${o.status.padEnd(9)}  ${o.fulfillmentType.padEnd(13)}  ${t.join(' + ')}`
    )
  }

  console.log(`\nadd() call sites the lifecycle reached, by type:`)
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`)
  console.log(`\norders that reached AT LEAST ONE enqueue trigger: ${anyTrigger} of ${rows.length}`)
  console.log(`orders that placed but reached NO trigger: ${rows.length - anyTrigger}`)

  // Voided ones in the same window, for completeness — voided orders were still
  // real placements at the time and would still have hit the placement enqueue.
  const voidedAfter = await db.order.count({ where: { voidedAt: { not: null }, placedAt: { gte: CUT } } })
  console.log(`\n(voided orders placed on/after cutoff, excluded above: ${voidedAfter})`)

  await db.$disconnect()
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
