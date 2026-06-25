/**
 * Manual single-shot reconciliation sweep — for testing the backstop without
 * waiting for the recurring worker job.
 *
 *   npx tsx scripts/run-reconcile.ts            # dry-run (default — no repairs)
 *   npx tsx scripts/run-reconcile.ts --live     # actually repair
 *   npx tsx scripts/run-reconcile.ts --live --pattern-e   # also ACT on Pattern E
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

async function main() {
  const live = process.argv.includes('--live')
  const patternE = process.argv.includes('--pattern-e')
  const { runReconciliationSweep } = await import('../lib/reconciler.js')
  const { db } = await import('../lib/db.js')

  console.log(`\n=== Reconciliation sweep (${live ? 'LIVE' : 'DRY-RUN'}${patternE ? ', Pattern E ACTING' : ''}) ===\n`)
  const summary = await runReconciliationSweep({
    dryRun: !live,
    patternEEnabled: patternE,
  })

  console.log('\n──────── PER-RUN SUMMARY ────────')
  console.log(JSON.stringify(summary, null, 2))
  console.log('─────────────────────────────────\n')

  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
