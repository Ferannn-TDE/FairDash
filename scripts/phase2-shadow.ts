/**
 * Phase 2 — shadow pass: aggregator COMPLETED/CANCELLED vs W4's today (READ-ONLY).
 *
 * Run:  npx tsx scripts/phase2-shadow.ts
 *
 * Phase 2 will move the COMPLETED and CANCELLED master writes from W4
 * (vendor-status route :172/:190) into the aggregator. Before any write
 * authority, enumerate EVERY divergence between "what W4 decides today" and
 * "what the aggregator would decide" on real orders — most should agree, plus
 * the un-strandings (W4's bug), and we must surface any case where W4 completes
 * an order the aggregator would NOT (or vice versa).
 *
 * Writes nothing.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import { deriveMasterStatus, canAdvance, type MasterStatus, type FulfillmentType } from '../lib/reconcile-order-status'

const NON_TERMINAL: MasterStatus[] = ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']

// W4's EXACT decision logic, copied from vendor-status/route.ts :169-192.
// It runs on every PATCH and writes master only in these two branches.
function w4Decision(rows: string[]): 'COMPLETED' | 'CANCELLED' | 'NONE' {
  if (rows.length === 0) return 'NONE'
  const allDeclined = rows.every(s => s === 'DECLINED')
  const allTerminal = rows.every(s => ['COMPLETED', 'DECLINED'].includes(s)) // NOTE: omits REFUNDED
  if (allDeclined) return 'CANCELLED'
  if (allTerminal) return 'COMPLETED'
  return 'NONE' // W4 leaves master unchanged
}

type Cat =
  | 'AGREE_COMPLETE' | 'AGREE_CANCEL'
  | 'AGG_FIXES_STRAND'          // W4 freezes (bug) / never ran; agg writes COMPLETED — the un-strandings
  | 'DISAGREE_DELIVERY_COMPLETE'// W4 would COMPLETE a delivery order; agg keeps it pre-DELIVERED — behavior change
  | 'DISAGREE_OTHER'            // any other W4-acts-vs-agg mismatch — scrutinize
  | 'BOTH_HOLD'                 // neither W4 nor agg moves it to a terminal here

async function main() {
  console.log('\n[phase2-shadow] READ-ONLY — comparing W4 vs aggregator on COMPLETED/CANCELLED.\n')

  const orders = await db.order.findMany({
    where: { status: { in: NON_TERMINAL as never }, voidedAt: null },
    select: {
      id: true, status: true, fulfillmentType: true, runnerId: true, deliveryProofPath: true,
      vendorOrderStatuses: { select: { status: true } },
    },
  })

  const tally: Record<Cat, number> = {
    AGREE_COMPLETE: 0, AGREE_CANCEL: 0, AGG_FIXES_STRAND: 0,
    DISAGREE_DELIVERY_COMPLETE: 0, DISAGREE_OTHER: 0, BOTH_HOLD: 0,
  }
  const examples: Record<string, string[]> = {}
  const keep = (k: string, line: string, max = 12) => { (examples[k] ??= []).length < max && examples[k].push(line) }

  for (const o of orders) {
    const rows = o.vendorOrderStatuses.map(v => v.status)
    if (rows.length === 0) continue // no per-vendor truth — not Phase 2's concern (placement owns)

    const w4 = w4Decision(rows)
    const { derived } = deriveMasterStatus({
      fulfillmentType: o.fulfillmentType as FulfillmentType,
      vendorStatuses: o.vendorOrderStatuses,
      runnerId: o.runnerId, deliveryProofPath: o.deliveryProofPath,
    })
    const isDelivery = o.fulfillmentType === 'HOME_DELIVERY' || o.fulfillmentType === 'CURBSIDE'
    const line = `${o.id} type=${o.fulfillmentType} stored=${o.status} w4=${w4} agg=${derived} vendors=[${rows.join(',')}]`

    let cat: Cat
    if (w4 === 'COMPLETED' && derived === 'COMPLETED') cat = 'AGREE_COMPLETE'
    else if (w4 === 'CANCELLED' && derived === 'CANCELLED') cat = 'AGREE_CANCEL'
    else if (w4 === 'COMPLETED' && isDelivery && derived !== 'COMPLETED') cat = 'DISAGREE_DELIVERY_COMPLETE'
    else if (w4 === 'NONE' && derived === 'COMPLETED') cat = 'AGG_FIXES_STRAND'
    else if (w4 !== 'NONE' && w4 !== derived) cat = 'DISAGREE_OTHER'
    else cat = 'BOTH_HOLD'

    tally[cat]++
    if (cat !== 'BOTH_HOLD') keep(cat, line)

    // Money-safety cross-check on every COMPLETED/CANCELLED the aggregator would write.
    if ((derived === 'COMPLETED' || derived === 'CANCELLED')) {
      const adv = canAdvance(o.status as MasterStatus, derived)
      if (!adv) keep('AGG_WRITE_BLOCKED_BY_GUARD', line) // would the guard actually allow the write?
    }
  }

  console.log('Categories (live, non-terminal orders with vendor rows):')
  for (const k of Object.keys(tally) as Cat[]) console.log(`  ${k.padEnd(28)} ${tally[k]}`)

  for (const cat of ['DISAGREE_DELIVERY_COMPLETE', 'DISAGREE_OTHER', 'AGG_FIXES_STRAND', 'AGREE_COMPLETE', 'AGREE_CANCEL', 'AGG_WRITE_BLOCKED_BY_GUARD']) {
    if (examples[cat]?.length) {
      console.log(`\n── ${cat} (showing ${examples[cat].length}) ──`)
      examples[cat].forEach(l => console.log('  ' + l))
    }
  }

  console.log('\n' + '─'.repeat(78))
  const dangerous = tally.DISAGREE_OTHER + tally.DISAGREE_DELIVERY_COMPLETE
  if (tally.DISAGREE_DELIVERY_COMPLETE > 0) {
    console.log(`⚠ ${tally.DISAGREE_DELIVERY_COMPLETE} delivery order(s) W4 would COMPLETE that the aggregator keeps pre-DELIVERED.`)
    console.log(`  This is the intended model (delivery completes via runner DELIVERED, not vendor) — but it IS a`)
    console.log(`  behavior change. Review the list above before write authority.`)
  }
  if (tally.DISAGREE_OTHER > 0) {
    console.log(`✗ ${tally.DISAGREE_OTHER} UNEXPECTED W4-vs-aggregator disagreement(s) — inspect before Phase 2.`)
  }
  if (dangerous === 0) {
    console.log('✓ No disagreements: aggregator matches W4 everywhere it acts, plus the un-strandings W4 misses.')
  }
  console.log('─'.repeat(78) + '\n')

  await db.$disconnect()
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
