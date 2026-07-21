/** Void the 2 stuck delivery-walkthrough test orders — remediation receipt.
 *
 *  #WVRDERFI (cmrmix3ey0007dkqswvrderfi) + #8DBXU1FR (cmrmltq0z000mdkqs8dbxu1fr): created
 *  2026-07-15 during the runner-delivery walkthrough, stuck in RUNNER_COLLECTED for days,
 *  never delivered (no deliveryProofPath, no VendorEarning/RunnerEarning — accrual keys on
 *  DELIVERED, which they never reached). Test-mode Stripe charges, test customers.
 *
 *  Resolution = VOID (voidedAt), the codebase's designated "excluded from reconciliation —
 *  test data" marker (see the Order.voidedAt schema comment). Chosen over cancel+refund because
 *  there is no real money (test charges) and no earnings to unwind — a Stripe refund would be
 *  theater. FLAG-ONLY: sets voidedAt + voidReason on these 2 ids; no money fields, no Stripe,
 *  no deletes. Reversible (unset voidedAt). Money-neutral.
 *
 *  WHY NOW: ahead of Commit 2's U4 strand clocks. Left as-is, both would read false
 *  CLAIMED_NOT_COLLECTED the moment the clocks light up (RUNNER_COLLECTED + collectedAt null).
 *  Voided, the reconciler — and U4's clocks, which filter voidedAt: null — skip them, so the
 *  strand surface is born with zero standing strands. The same clean birth Pattern U got.
 *
 *  Idempotent: re-run voids 0 rows. Deliberate, reviewed prod op (Italian Fest is protected;
 *  this update is BY ID and flag-only). Precedent: scripts/clear-legacy-failed-flags.ts.
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } })

const IDS = ['cmrmix3ey0007dkqswvrderfi', 'cmrmltq0z000mdkqs8dbxu1fr']
const REASON = 'delivery-walkthrough test order (2026-07-15), stuck RUNNER_COLLECTED, never delivered — excluded from reconciliation ahead of U4 strand clocks (test data, not a real customer)'

const snap = () => p.order.findMany({ where: { id: { in: IDS } }, select: { id: true, status: true, voidedAt: true }, orderBy: { id: 'asc' } })

async function main() {
  const before = await snap()
  console.log('── BEFORE ──')
  before.forEach(o => console.log(`  ${o.id}  status=${o.status}  voidedAt=${o.voidedAt}`))

  const wereOpen = before.filter(o => o.voidedAt == null).length
  console.log(`\n${wereOpen} of ${IDS.length} not yet voided (baseline; expected 2).`)

  const res = await p.order.updateMany({
    where: { id: { in: IDS }, voidedAt: null },
    data: { voidedAt: new Date(), voidReason: REASON },
  })
  console.log(`Voided ${res.count} order(s) (flag-only: voidedAt + voidReason).`)

  const after = await snap()
  console.log('\n── AFTER ──')
  after.forEach(o => console.log(`  ${o.id}  voidedAt=${o.voidedAt ? 'set' : 'null'}`))

  const stillOpen = after.filter(o => o.voidedAt == null).length
  const ok = wereOpen === 2 && stillOpen === 0
  console.log(`\n── POSITIVE CONTROL ──`)
  console.log(`  not-voided before = ${wereOpen}  (expected 2)  ${wereOpen === 2 ? '✅' : '❌'}`)
  console.log(`  voided this run   = ${res.count}`)
  console.log(`  not-voided after  = ${stillOpen}  (expected 0)  ${stillOpen === 0 ? '✅' : '❌'}`)
  console.log(ok ? '\n✅ Both walkthrough orders excluded. U4 clocks will skip them (voidedAt: null filter).' : '\n❌ investigate')
}
main().catch(e => { console.error('💥', e); process.exit(1) }).finally(() => p.$disconnect())
