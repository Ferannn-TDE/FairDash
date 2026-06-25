/**
 * Void the 2 INSPECTED fully-refunded non-terminal stragglers (Pattern-M-flagged,
 * same test-mode dev lineage as the 10 Phase-2 strands). sk_test → no real money.
 * Same marker pattern + guardrail as scripts/void-phase2-strands.ts. Idempotent.
 *
 *   npx tsx scripts/void-refunded-stragglers.ts            # dry-run (default)
 *   npx tsx scripts/void-refunded-stragglers.ts --apply    # write the markers
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from '../lib/db'

const DEV_EMAIL = 'feranmidyro@gmail.com'
const VOID_REASON = 'fully_refunded_nonterminal_testmode'
const NON_TERMINAL = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'RUNNER_COLLECTED']
const CLASSIFIED_IDS = ['cmpzy74d0000sgyvardjnyn5u', 'cmq0etid5000197xii3d4finn']

async function main() {
  const apply = process.argv.includes('--apply')
  const orders = await db.order.findMany({
    where: { id: { in: CLASSIFIED_IDS } },
    select: { id: true, status: true, voidedAt: true, customer: { select: { email: true } }, vendorOrderStatuses: { select: { status: true } } },
  })
  const missing = CLASSIFIED_IDS.filter(id => !orders.some(o => o.id === id))

  const voidable: string[] = []
  const mismatched: string[] = []
  let alreadyVoided = 0
  for (const o of orders) {
    if (o.voidedAt) { alreadyVoided++; continue }
    const rows = o.vendorOrderStatuses.map(v => v.status)
    const isDev = o.customer?.email === DEV_EMAIL
    const nonTerminal = NON_TERMINAL.includes(o.status as string)
    const allRefunded = rows.length > 0 && rows.every(s => s === 'REFUNDED')
    if (isDev && nonTerminal && allRefunded) voidable.push(o.id)
    else mismatched.push(`${o.id} (dev=${isDev} status=${o.status} rows=[${rows.join(',')}])`)
  }

  console.log(`\nClassified: ${CLASSIFIED_IDS.length}  found=${orders.length}  alreadyVoided=${alreadyVoided}  voidable=${voidable.length}`)
  if (missing.length) console.log(`  MISSING: ${missing.join(', ')}`)
  if (mismatched.length) console.log(`  MISMATCH (won't touch): ${mismatched.join(' | ')}`)
  if (missing.length || mismatched.length || voidable.length + alreadyVoided !== CLASSIFIED_IDS.length) {
    console.log(`\nABORT — live set no longer matches the classification exactly.\n`); await db.$disconnect(); process.exit(1)
  }
  if (!apply) { console.log(`\nDRY-RUN — would void ${voidable.length}. Re-run with --apply.\n`); await db.$disconnect(); return }

  const res = await db.order.updateMany({ where: { id: { in: voidable }, voidedAt: null }, data: { voidedAt: new Date(), voidReason: VOID_REASON } })
  console.log(`\nAPPLIED: voided ${res.count}. voidReason='${VOID_REASON}'. No payout, no Stripe, no deletes.\n`)
  await db.$disconnect()
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
