/**
 * TRANSFER-EXISTENCE AUDIT — hand-runnable. Does every stored transfer id exist in Stripe?
 *
 * Deliberately NOT a reconciler pattern: it needs the network, and the 60s sweep has no network
 * dependency today. A Stripe outage must not look like a sweep failure. Nothing this finds is
 * 60-second-urgent — a ledger/Stripe divergence is a reporting error; the money has already
 * moved or it hasn't.
 *
 * Run:  npx tsx scripts/transfer-existence-audit.ts [eventId]
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { checkTransferExistence, ACKNOWLEDGED_MISSING_TRANSFERS } from '../lib/transfer-existence'

async function main() {
  const eventId = process.argv[2]
  const r = await checkTransferExistence(eventId ? { eventId } : {})
  console.log(`\nStripe transfers seen : ${r.stripeTransfersSeen}`)
  console.log(`rows scanned          : ${r.scanned}`)
  console.log(`resolve in Stripe     : ${r.ok}`)
  console.log(`suppressed (declared) : ${r.suppressed.length}  — ${ACKNOWLEDGED_MISSING_TRANSFERS.reason}`)
  console.log(`UNDECLARED MISSING    : ${r.missing.length}`)
  for (const m of r.missing) {
    console.log(`  ✗ ${m.leg} ${m.ref}  ${m.transferId}  ${m.amountCents}¢  event ${m.eventId}`)
  }
  if (r.shapeDisagreements.length) {
    console.log(`\n⚠ SHAPE/EXISTENCE DISAGREEMENT (${r.shapeDisagreements.length}) — a finding in itself:`)
    for (const d of r.shapeDisagreements) console.log(`  ${d.leg} ${d.ref} ${d.transferId} missing=${d.missing} shortShaped=${d.shortShaped}`)
  } else {
    console.log(`\nshape/existence agree on all ${r.scanned} rows (corroboration only)`)
  }
  process.exit(r.missing.length === 0 ? 0 : 1)
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
