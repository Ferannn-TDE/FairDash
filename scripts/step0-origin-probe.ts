/**
 * Step 0 — can the DB distinguish prod-originated orders from local-originated ones?
 *
 * READ-ONLY. No writes, no Stripe calls, no Redis.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const total = await db.order.count()
  const live = await db.order.count({ where: { voidedAt: null } })
  const voided = total - live

  console.log(`orders: total=${total} non-voided=${live} voided=${voided}`)

  const paidPayouts = await db.payout.count()
  console.log(`payout rows: ${paidPayouts}`)

  // ProcessedWebhookEvent — written ONLY by the deployed webhook route.
  const wh = await db.processedWebhookEvent.count()
  const whFirst = await db.processedWebhookEvent.findFirst({ orderBy: { processedAt: 'asc' } })
  const whLast = await db.processedWebhookEvent.findFirst({ orderBy: { processedAt: 'desc' } })
  console.log(`\nProcessedWebhookEvent: ${wh}`)
  if (wh) {
    console.log(`  first=${whFirst!.processedAt.toISOString()}  last=${whLast!.processedAt.toISOString()}`)
  }

  // Non-voided orders by day + whether a Stripe PI is attached.
  const rows = await db.order.findMany({
    where: { voidedAt: null },
    select: { id: true, placedAt: true, stripePaymentIntentId: true, status: true, total: true },
    orderBy: { placedAt: 'asc' },
  })
  const byDay: Record<string, { n: number; withPI: number }> = {}
  for (const o of rows) {
    const d = o.placedAt.toISOString().slice(0, 10)
    byDay[d] ??= { n: 0, withPI: 0 }
    byDay[d].n++
    if (o.stripePaymentIntentId) byDay[d].withPI++
  }
  console.log(`\nnon-voided orders by placedAt day (n / with stripePaymentIntentId):`)
  for (const [d, v] of Object.entries(byDay)) console.log(`  ${d}  n=${v.n}  withPI=${v.withPI}`)

  console.log(`\noldest non-voided order: ${rows[0]?.placedAt.toISOString()} (${rows[0]?.id})`)
  console.log(`newest non-voided order: ${rows[rows.length - 1]?.placedAt.toISOString()} (${rows[rows.length - 1]?.id})`)

  const allOldest = await db.order.findFirst({ orderBy: { placedAt: 'asc' }, select: { id: true, placedAt: true } })
  const allNewest = await db.order.findFirst({ orderBy: { placedAt: 'desc' }, select: { id: true, placedAt: true } })
  console.log(`oldest order overall:      ${allOldest?.placedAt.toISOString()} (${allOldest?.id})`)
  console.log(`newest order overall:      ${allNewest?.placedAt.toISOString()} (${allNewest?.id})`)

  // Distinct customers on non-voided orders — email shape is circumstantial only.
  const custIds = [...new Set(rows.map(r => r.id))].length
  const customers = await db.order.findMany({
    where: { voidedAt: null },
    select: { customer: { select: { email: true } } },
    distinct: ['customerId'],
  })
  const domains: Record<string, number> = {}
  for (const c of customers) {
    const dom = c.customer.email.split('@')[1] ?? '(none)'
    domains[dom] = (domains[dom] || 0) + 1
  }
  console.log(`\ndistinct customers on non-voided orders: ${customers.length} (${custIds} order ids)`)
  console.log(`customer email domains: ${JSON.stringify(domains)}`)

  await db.$disconnect()
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
