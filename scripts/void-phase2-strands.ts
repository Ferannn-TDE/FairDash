/**
 * Void the 10 INSPECTED & CLASSIFIED Phase-2-scope strands (test-mode dev orders
 * that W4's REFUND-omitting allTerminal froze at PLACED). sk_test → no real money;
 * voiding stops them showing as stranded. Same marker pattern as
 * scripts/void-out-of-model-orders.ts. Idempotent. No payout, no Stripe call.
 *
 *   npx tsx scripts/void-phase2-strands.ts            # dry-run (default)
 *   npx tsx scripts/void-phase2-strands.ts --apply    # write the markers
 *
 * GUARDRAIL: scoped to the EXACT classified id set below — never a broad query.
 * Each id is re-verified to still match the classification before any write; if
 * the voidable set is not exactly these (minus any already voided), it ABORTS.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import { deriveMasterStatus, type FulfillmentType } from '../lib/reconcile-order-status'

const DEV_EMAIL = 'feranmidyro@gmail.com'
const VOID_REASON = 'phase2_w4_refund_strand_testmode'
const NON_TERMINAL = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']

// The exact set inspected & classified in the prior read-only pass. Void ONLY these.
const CLASSIFIED_IDS = [
  'cmpzxu0sh000110pliob0azct',
  'cmpzy6w020001gyvaedyxkd54',
  'cmpzy6ze9000dgyva8c2np0cw',
  'cmq0c60gf00012icnrmby6a15',
  'cmq0c9yaj0001s919opmw1zqo',
  'cmq0ca4fv000fs919p3fjbcns',
  'cmq0dysvf00011b13evyakyoa',
  'cmq0etmjr000h97xif8tw2q1s',
  'cmq0etxhq000143c7ilx4e18h',
  'cmq0eu2xo000f43c7mj2atocm',
]

async function main() {
  const apply = process.argv.includes('--apply')

  const orders = await db.order.findMany({
    where: { id: { in: CLASSIFIED_IDS } },
    select: {
      id: true, status: true, fulfillmentType: true, voidedAt: true,
      customer: { select: { email: true } },
      vendorOrderStatuses: { select: { vendorId: true, status: true } },
    },
  })

  const found = new Set(orders.map(o => o.id))
  const missing = CLASSIFIED_IDS.filter(id => !found.has(id))

  const voidable: string[] = []
  const alreadyVoided: string[] = []
  const mismatched: string[] = []

  for (const o of orders) {
    if (o.voidedAt) { alreadyVoided.push(o.id); continue }
    const isDev = o.customer?.email === DEV_EMAIL
    const nonTerminal = NON_TERMINAL.includes(o.status as string)
    const derived = deriveMasterStatus({
      fulfillmentType: o.fulfillmentType as FulfillmentType,
      vendorStatuses: o.vendorOrderStatuses,
    }).derived
    if (isDev && nonTerminal && derived === 'COMPLETED') voidable.push(o.id)
    else mismatched.push(`${o.id} (dev=${isDev} status=${o.status} derived=${derived})`)
  }

  console.log(`\nClassified set: ${CLASSIFIED_IDS.length}`)
  console.log(`  found in DB:        ${orders.length}`)
  console.log(`  already voided:     ${alreadyVoided.length}`)
  console.log(`  voidable now:       ${voidable.length}`)
  if (missing.length)    console.log(`  MISSING (not found): ${missing.join(', ')}`)
  if (mismatched.length) console.log(`  MISMATCH (won't touch): ${mismatched.join(' | ')}`)

  // GUARDRAIL: every classified id must be accounted for as voidable-or-already-voided,
  // and nothing outside the classified set is ever in scope.
  if (missing.length || mismatched.length) {
    console.log(`\nABORT — the live set no longer matches the classification exactly. Re-inspect before voiding.\n`)
    await db.$disconnect(); process.exit(1)
  }
  if (voidable.length + alreadyVoided.length !== CLASSIFIED_IDS.length) {
    console.log(`\nABORT — accounted ${voidable.length + alreadyVoided.length} ≠ classified ${CLASSIFIED_IDS.length}.\n`)
    await db.$disconnect(); process.exit(1)
  }

  if (!apply) {
    console.log(`\nDRY-RUN — nothing written. Would void ${voidable.length}. Re-run with --apply.\n`)
    await db.$disconnect(); return
  }

  const res = await db.order.updateMany({
    where: { id: { in: voidable }, voidedAt: null }, // scoped to the verified set + idempotent
    data: { voidedAt: new Date(), voidReason: VOID_REASON },
  })
  console.log(`\nAPPLIED: voided ${res.count} order(s). voidReason='${VOID_REASON}'.`)
  console.log(`No payout enqueued, no Stripe call, no totals changed, no rows deleted.\n`)
  await db.$disconnect()
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
