/**
 * Phase 4 — shadow pass: W3 (runner) + W7 (worker timeouts) vs the aggregator.
 * READ-ONLY.
 *
 * Run:  npx tsx scripts/phase4-shadow.ts
 *
 * Two kinds of write to converge:
 *   • W3 runner (RUNNER_COLLECTED / DELIVERED) — DERIVABLE from the persistent
 *     runner-state columns (runnerId, curbsidePhotoUrl) the aggregator already
 *     reads. So these are DERIVED, not asserted — same pattern as W4. We confirm
 *     the derivation matches live runner-state orders.
 *   • W7 timeouts (UNCOLLECTED / UNDELIVERABLE / accept-CANCELLED) — time/operator
 *     driven, NO column to derive from → truly ASSERTED terminal overrides (like
 *     cancel-intent). They show as BENIGN_OVERRIDE and the guard protects them.
 *
 * Also hunts for the W5-class latent guard bug: an unguarded master write whose
 * stored state shows a race already happened (e.g. runnerId set on a timed-out
 * order = a runner resurrected a terminal one, which canAdvance would refuse).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '../lib/db'
import { deriveMasterStatus, canAdvance, type MasterStatus, type FulfillmentType } from '../lib/reconcile-order-status'

async function main() {
  console.log('\n[phase4-shadow] READ-ONLY — W3 runner + W7 timeouts vs aggregator.\n')

  const RUNNER_STATES: MasterStatus[] = ['RUNNER_COLLECTED', 'DELIVERED']
  const TIMEOUT_STATES: MasterStatus[] = ['UNCOLLECTED', 'UNDELIVERABLE']

  const orders = await db.order.findMany({
    where: { voidedAt: null, status: { in: [...RUNNER_STATES, ...TIMEOUT_STATES] as never } },
    select: {
      id: true, status: true, fulfillmentType: true, runnerId: true,
      curbsidePhotoUrl: true, deliveryFee: true, tip: true,
      runnerEarning: { select: { id: true } },
      organizerEarning: { select: { id: true } },
      vendorOrderStatuses: { select: { status: true } },
    },
  })

  let runnerAgree = 0, runnerMismatch = 0, timeoutBenign = 0, timeoutAnomaly = 0
  let deliveredNoEarning = 0, latentRace = 0, benignLegacy = 0
  const ex: Record<string, string[]> = {}
  const keep = (k: string, l: string, m = 10) => { (ex[k] ??= []).length < m && ex[k].push(l) }

  for (const o of orders) {
    const rows = o.vendorOrderStatuses.map(v => v.status)
    const derived = deriveMasterStatus({
      fulfillmentType: o.fulfillmentType as FulfillmentType,
      vendorStatuses: o.vendorOrderStatuses,
      runnerId: o.runnerId, curbsidePhotoUrl: o.curbsidePhotoUrl,
    }).derived
    const line = `${o.id} stored=${o.status} derived=${derived} runner=${o.runnerId ? 'Y' : '-'} photo=${o.curbsidePhotoUrl ? 'Y' : '-'} vendors=[${rows.join(',')}]`

    if (RUNNER_STATES.includes(o.status as MasterStatus)) {
      // W3 transitions should be DERIVED from runner-state columns — EXCEPT legacy
      // no-rows orders, where the aggregator correctly abstains (no jurisdiction),
      // and the guard (terminal-absorbing) protects them anyway.
      if (derived === o.status) runnerAgree++
      else if (derived === 'SKIP' && rows.length === 0) { benignLegacy++; keep('BENIGN_LEGACY_NO_ROWS', line) }
      else { runnerMismatch++; keep('RUNNER_MISMATCH', line) }
      // Money-critical: a DELIVERED order with a fee/tip must have earnings recorded.
      if (o.status === 'DELIVERED' && ((o.deliveryFee ?? 0) > 0 || (o.tip ?? 0) > 0) && !o.runnerEarning) {
        deliveredNoEarning++; keep('DELIVERED_NO_EARNING', line)
      }
    } else {
      // W7 terminals — not derivable; should be BENIGN_OVERRIDE (guard protects).
      const guardWouldChange = canAdvance(o.status as MasterStatus, derived === 'SKIP' ? 'READY' : derived as MasterStatus)
      if (!guardWouldChange) timeoutBenign++
      else { timeoutAnomaly++; keep('TIMEOUT_ANOMALY', line) }
      // Latent-race evidence: a runner is assigned on a timed-out order.
      if (o.runnerId) { latentRace++; keep('LATENT_RACE_runnerId_on_timeout', line) }
    }
  }

  console.log(`Runner-state orders (RUNNER_COLLECTED/DELIVERED): ${orders.filter(o => RUNNER_STATES.includes(o.status as MasterStatus)).length}`)
  console.log(`  aggregator DERIVES the same:      ${runnerAgree}`)
  console.log(`  benign legacy no-rows (abstain):  ${benignLegacy}`)
  console.log(`  GENUINE mismatch (a finding):     ${runnerMismatch}`)
  console.log(`  DELIVERED w/ fee/tip but NO earning recorded: ${deliveredNoEarning}`)
  console.log(`\nTimeout-state orders (UNCOLLECTED/UNDELIVERABLE): ${orders.filter(o => TIMEOUT_STATES.includes(o.status as MasterStatus)).length}`)
  console.log(`  benign override (guard refuses to change): ${timeoutBenign}`)
  console.log(`  anomaly (guard WOULD change — investigate): ${timeoutAnomaly}`)
  console.log(`  latent-race evidence (runnerId on timed-out order): ${latentRace}`)

  for (const k of ['RUNNER_MISMATCH', 'DELIVERED_NO_EARNING', 'TIMEOUT_ANOMALY', 'LATENT_RACE_runnerId_on_timeout']) {
    if (ex[k]?.length) { console.log(`\n── ${k} (${ex[k].length}) ──`); ex[k].forEach(l => console.log('  ' + l)) }
  }

  console.log('\n' + '─'.repeat(78))
  const bad = runnerMismatch + timeoutAnomaly + deliveredNoEarning
  if (bad === 0) {
    console.log('✓ Runner transitions derive correctly; timeouts are benign overrides the guard protects;')
    console.log('  every DELIVERED order with a fee/tip already has earnings recorded.')
  } else {
    console.log(`⚠ ${bad} item(s) to inspect (runner mismatch / timeout anomaly / missing earning).`)
  }
  console.log('─'.repeat(78) + '\n')
  await db.$disconnect()
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1) })
