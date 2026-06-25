/**
 * Phase 3 — shadow pass: W5 (customer cancel) CANCELLED decision vs the shared
 * aggregator (READ-ONLY).
 *
 * Run:  npx tsx scripts/phase3-shadow.ts
 *
 * W5 (app/api/orders/[id]/cancel/route.ts:98-112) flips master → CANCELLED when
 * every portion is terminal and none completed — i.e. every portion ∈
 * {DECLINED, REFUNDED, CANCELLED}. The shared aggregator agrees on all-DECLINED
 * but ABSTAINS on any-REFUNDED (lossy money: can't tell cancel-refund from
 * completed-then-refund from status alone). W5 is safe to cancel there because it
 * has explicit customer-cancel INTENT that the status-only derivation lacks.
 *
 * Enumerate every divergence so we can decide the migration (thread cancel-intent
 * into the aggregator as a caller-asserted terminal override). Writes nothing.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import { deriveMasterStatus, canAdvance, type MasterStatus, type FulfillmentType } from '../lib/reconcile-order-status'

// W5's exact decision, copied from cancel/route.ts:99-102.
function w5Decision(rows: string[]): 'CANCELLED' | 'NONE' {
  if (rows.length === 0) return 'NONE'
  const allTerminal = rows.every(s => ['DECLINED', 'REFUNDED', 'CANCELLED', 'COMPLETED'].includes(s))
  const noneCompleted = rows.every(s => s !== 'COMPLETED')
  return allTerminal && noneCompleted ? 'CANCELLED' : 'NONE'
}

type Cat =
  | 'AGREE_CANCEL'          // W5 CANCELLED, agg CANCELLED (all declined)
  | 'DIVERGE_REFUNDED'      // W5 CANCELLED, agg abstains (any refunded) — needs cancel-intent
  | 'DIVERGE_OTHER'         // any other W5-acts-vs-agg mismatch — scrutinize
  | 'W5_NONE'              // W5 wouldn't cancel — not its concern

async function main() {
  console.log('\n[phase3-shadow] READ-ONLY — W5 cancel decision vs shared aggregator.\n')

  const orders = await db.order.findMany({
    where: { voidedAt: null },
    select: {
      id: true, status: true, fulfillmentType: true, runnerId: true, curbsidePhotoUrl: true,
      vendorOrderStatuses: { select: { status: true } },
    },
  })

  const tally: Record<Cat, number> = { AGREE_CANCEL: 0, DIVERGE_REFUNDED: 0, DIVERGE_OTHER: 0, W5_NONE: 0 }
  const examples: Record<string, string[]> = {}
  const keep = (k: string, l: string, max = 12) => { (examples[k] ??= []).length < max && examples[k].push(l) }

  for (const o of orders) {
    const rows = o.vendorOrderStatuses.map(v => v.status)
    if (rows.length === 0) continue
    const w5 = w5Decision(rows)
    if (w5 === 'NONE') { tally.W5_NONE++; continue }

    const { derived } = deriveMasterStatus({
      fulfillmentType: o.fulfillmentType as FulfillmentType,
      vendorStatuses: o.vendorOrderStatuses,
      runnerId: o.runnerId, curbsidePhotoUrl: o.curbsidePhotoUrl,
    })
    const line = `${o.id} stored=${o.status} w5=CANCELLED agg=${derived} vendors=[${rows.join(',')}]` +
      ` guardAllows=${canAdvance(o.status as MasterStatus, 'CANCELLED')}`

    let cat: Cat
    if (derived === 'CANCELLED') cat = 'AGREE_CANCEL'
    else if (derived === 'SKIP' && rows.some(s => s === 'REFUNDED')) cat = 'DIVERGE_REFUNDED'
    else cat = 'DIVERGE_OTHER'
    tally[cat]++
    if (cat !== 'AGREE_CANCEL') keep(cat, line)
    else keep('AGREE_CANCEL', line)
  }

  console.log('Categories (non-voided orders with vendor rows, where W5 would CANCEL):')
  for (const k of ['AGREE_CANCEL', 'DIVERGE_REFUNDED', 'DIVERGE_OTHER'] as Cat[]) console.log(`  ${k.padEnd(18)} ${tally[k]}`)
  console.log(`  (W5 would not cancel: ${tally.W5_NONE})`)

  for (const cat of ['DIVERGE_OTHER', 'DIVERGE_REFUNDED', 'AGREE_CANCEL']) {
    if (examples[cat]?.length) {
      console.log(`\n── ${cat} (showing ${examples[cat].length}) ──`)
      examples[cat].forEach(l => console.log('  ' + l))
    }
  }

  console.log('\n' + '─'.repeat(78))
  if (tally.DIVERGE_OTHER > 0) {
    console.log(`✗ ${tally.DIVERGE_OTHER} UNEXPECTED W5-vs-aggregator disagreement(s) — inspect before Phase 3.`)
  } else {
    console.log(`✓ Only expected divergence: W5 cancels all-refunded orders (intent), aggregator abstains (status-only).`)
    console.log(`  ${tally.DIVERGE_REFUNDED} order(s) need cancel-INTENT threaded into the aggregator (terminal override).`)
    console.log(`  ${tally.AGREE_CANCEL} all-declined order(s) already agree.`)
  }
  console.log('─'.repeat(78) + '\n')

  await db.$disconnect()
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
